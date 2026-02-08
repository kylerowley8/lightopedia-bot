// ============================================
// Agent Tools — Tool definitions + execution handlers
// Four tools: knowledge_base, fetch_articles, search_articles, escalate_to_human
// ============================================

import type { ChatCompletionTool } from "openai/resources/chat/completions.js";
import { fetchKBHierarchy, githubBlobToRaw } from "../retrieval/manifest.js";
import { searchArticlesBySimilarity } from "../retrieval/search.js";
import { logger } from "../lib/logger.js";

// ============================================
// Configuration
// ============================================

const FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v1";

// ============================================
// Tool Definitions (OpenAI function calling schema)
// ============================================

export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "knowledge_base",
      description:
        "Get the complete Light knowledge base article hierarchy. Returns a structured table of contents of all 136 help articles organized by topic (getting started, org setup, bank reconciliation, GL, AR, AP, expenses, revenue, reporting, integrations, AI, security, troubleshooting). Use this first for any Light product question to see what articles exist, then use fetch_articles to get the full content of relevant articles.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_articles",
      description:
        "Fetch the full content of multiple knowledge base articles by URL. Use this after getting the KB hierarchy to fetch all relevant articles at once. CRITICAL: Call this exactly ONCE with ALL relevant URLs — never split across multiple calls. Maximum 15 articles per call.",
      parameters: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of article URLs from the hierarchy to fetch (e.g., ['https://github.com/light-space/help-articles/blob/main/articles/08-expense-management/8-11-virtual-cards.md']). Maximum 15 URLs.",
            maxItems: 15,
          },
        },
        required: ["urls"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_articles",
      description:
        "Search help articles by semantic similarity. Use this when you can't find relevant articles by title in the knowledge base hierarchy, or when the user's question uses different terminology than the article titles. This searches the full content of all articles using AI embeddings. Returns the most relevant articles with similarity scores.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural language search query describing what you're looking for. Be specific and include key concepts from the user's question.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Create a structured support ticket draft for the user to review. IMPORTANT: Only use this AFTER trying both knowledge_base AND search_articles — never escalate without searching first. Use when: user explicitly asks for human help, expresses frustration after multiple exchanges, or you cannot find an answer in the documentation.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short title summarizing the issue (max 100 chars)",
          },
          requestType: {
            type: "string",
            enum: ["feature_request", "bug_report", "support_needed", "documentation_gap"],
            description: "Type of escalation",
          },
          problemStatement: {
            type: "string",
            description: "Clear description of what the user needs and why articles couldn't help",
          },
        },
        required: ["title", "requestType", "problemStatement"],
      },
    },
  },
];

// ============================================
// Tool Execution Handlers
// ============================================

export interface ToolResult {
  content: string;
  /** Article URLs that were fetched (for citation validation) */
  fetchedUrls?: string[];
  /** Article content for two-phase synthesis */
  articles?: Array<{ title: string; url: string; content: string }>;
  /** Escalation ticket draft (for rendering) */
  escalation?: EscalationDraft;
}

export interface EscalationDraft {
  title: string;
  requestType: string;
  problemStatement: string;
}

/**
 * Execute a tool call and return the result.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  requestId: string
): Promise<ToolResult> {
  switch (toolName) {
    case "knowledge_base":
      return executeKnowledgeBase(requestId);
    case "list_articles":
      // Backward compat — alias to knowledge_base
      return executeKnowledgeBase(requestId);
    case "fetch_articles":
      return executeFetchArticles(args, requestId);
    case "escalate_to_human":
      return executeEscalateToHuman(args, requestId);
    case "search_articles":
      return executeSearchArticles(args, requestId);
    default:
      logger.warn("Unknown tool called", {
        stage: "pipeline",
        requestId,
        toolName,
      });
      return { content: `Unknown tool: ${toolName}` };
  }
}

// ============================================
// Individual Tool Handlers
// ============================================

async function executeKnowledgeBase(requestId: string): Promise<ToolResult> {
  logger.info("Executing knowledge_base", { stage: "pipeline", requestId });

  const hierarchy = await fetchKBHierarchy();

  if (!hierarchy) {
    return { content: "Failed to fetch knowledge base hierarchy." };
  }

  logger.info("knowledge_base complete", {
    stage: "pipeline",
    requestId,
    length: hierarchy.length,
  });

  return { content: hierarchy };
}

async function executeFetchArticles(
  args: Record<string, unknown>,
  requestId: string
): Promise<ToolResult> {
  const urls = (args["urls"] as string[] | undefined) ?? (args["paths"] as string[] | undefined) ?? [];

  if (urls.length === 0) {
    return { content: "No article URLs provided." };
  }

  if (urls.length > 15) {
    return { content: "Maximum 15 articles per fetch. Please reduce your selection." };
  }

  logger.info("Executing fetch_articles", {
    stage: "pipeline",
    requestId,
    count: urls.length,
  });

  // Fetch all articles in parallel
  const articlePromises = urls.map((url) => fetchArticle(url));
  const articles = await Promise.all(articlePromises);

  const successful = articles.filter((a) => a.content.length > 0);

  if (successful.length === 0) {
    return {
      content: "No articles could be fetched. The URLs may be incorrect.",
      fetchedUrls: [],
      articles: [],
    };
  }

  // Format articles for the LLM
  const sections = successful.map((article, i) => {
    return `=== Article ${i + 1}: ${article.title} ===\nSource: ${article.url}\n\n${article.content}`;
  });

  const content = `Fetched ${successful.length} articles:\n\n${sections.join("\n\n---\n\n")}`;

  logger.info("fetch_articles complete", {
    stage: "pipeline",
    requestId,
    fetchedCount: successful.length,
  });

  return {
    content,
    fetchedUrls: successful.map((a) => a.url),
    articles: successful,
  };
}

async function executeEscalateToHuman(
  args: Record<string, unknown>,
  requestId: string
): Promise<ToolResult> {
  const title = (args["title"] as string) ?? "Support request";
  const requestType = (args["requestType"] as string) ?? "support_needed";
  const problemStatement = (args["problemStatement"] as string) ?? "";

  logger.info("Executing escalate_to_human", {
    stage: "pipeline",
    requestId,
    title,
    requestType,
  });

  const escalation: EscalationDraft = {
    title,
    requestType,
    problemStatement,
  };

  const content = [
    "I've prepared an escalation ticket draft:",
    "",
    `*Title:* ${title}`,
    `*Type:* ${requestType.replace(/_/g, " ")}`,
    `*Details:* ${problemStatement}`,
    "",
    "A team member will review this. You can also submit it to Linear for tracking.",
  ].join("\n");

  return { content, escalation };
}

async function executeSearchArticles(
  args: Record<string, unknown>,
  requestId: string
): Promise<ToolResult> {
  const query = (args["query"] as string) ?? "";

  if (!query) {
    return { content: "No search query provided." };
  }

  logger.info("Executing search_articles", {
    stage: "pipeline",
    requestId,
    query: query.slice(0, 80),
  });

  const searchResults = await searchArticlesBySimilarity(query, 8);

  if (searchResults.length === 0) {
    return {
      content: "No relevant articles found for this search query.",
      fetchedUrls: [],
      articles: [],
    };
  }

  // Format results with content and similarity scores
  const sections = searchResults.map((article, i) => {
    const label = article.title || article.path;
    const score = (article.score * 100).toFixed(0);
    return `=== Result ${i + 1}: ${label} (${article.path}) [${score}% match] ===\n\n${article.content}`;
  });

  const content = `Found ${searchResults.length} relevant articles:\n\n${sections.join("\n\n---\n\n")}`;

  logger.info("search_articles complete", {
    stage: "pipeline",
    requestId,
    resultCount: searchResults.length,
    topScore: searchResults[0]?.score,
  });

  return {
    content,
    fetchedUrls: searchResults.map((a) => a.path),
    articles: searchResults.map((a) => ({
      title: a.title ?? a.path,
      url: a.path,
      content: a.content,
    })),
  };
}

// ============================================
// Article Fetching (Firecrawl + GitHub raw fallback)
// ============================================

interface FetchedArticle {
  title: string;
  url: string;
  content: string;
}

/**
 * Fetch a single article by URL.
 * Tries Firecrawl first (live scraping), falls back to GitHub raw.
 */
async function fetchArticle(url: string): Promise<FetchedArticle> {
  const firecrawlKey = process.env["FIRECRAWL_API_KEY"];

  // Normalize URL — ensure it's a full URL
  let targetUrl = url;
  if (!targetUrl.startsWith("http")) {
    targetUrl = `https://help.light.inc/${url.replace(/^\//, "")}`;
  }

  // Try Firecrawl first (if configured)
  if (firecrawlKey) {
    try {
      // Convert GitHub blob URL to help.light.inc URL for Firecrawl
      let scrapeUrl = targetUrl;
      if (targetUrl.includes("github.com/light-space/help-articles")) {
        // Extract article slug from GitHub URL
        const match = targetUrl.match(/\/articles\/[^/]+\/[\d-]+(.+)\.md$/);
        if (match) {
          scrapeUrl = `https://help.light.inc/knowledge/${match[1]}`;
        }
      }

      logger.info("Fetching article via Firecrawl", {
        stage: "pipeline",
        url: scrapeUrl,
      });

      const response = await fetch(`${FIRECRAWL_API_BASE}/scrape`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: scrapeUrl,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          data?: { markdown?: string; metadata?: { title?: string } };
          markdown?: string;
          metadata?: { title?: string };
        };
        const content = data.data?.markdown ?? data.markdown ?? "";
        const title = data.data?.metadata?.title ?? data.metadata?.title ?? "Help Article";

        if (content.length > 100) {
          logger.info("Firecrawl article fetched", {
            stage: "pipeline",
            title,
            length: content.length,
          });
          return { content, title, url: scrapeUrl };
        }
      }
    } catch (err) {
      logger.warn("Firecrawl fetch failed, trying GitHub raw", {
        stage: "pipeline",
        url: targetUrl,
        error: err,
      });
    }
  }

  // Fallback: GitHub raw content
  try {
    let rawUrl = targetUrl;
    if (targetUrl.includes("github.com/light-space/help-articles/blob/main/")) {
      rawUrl = githubBlobToRaw(targetUrl);
    }

    logger.info("Fetching article from GitHub raw", {
      stage: "pipeline",
      url: rawUrl,
    });

    const response = await fetch(rawUrl, {
      headers: { "User-Agent": "Lightopedia-Bot" },
    });

    if (response.ok) {
      const content = await response.text();

      // Extract title from markdown content
      let title =
        targetUrl
          .split("/")
          .pop()
          ?.replace(/\.md$/, "")
          .replace(/[\d-]+/, "")
          .replace(/-/g, " ") ?? "Article";
      const titleMatch = content.match(/^#\s+(.+)$/m) ?? content.match(/title:\s*["']?(.+?)["']?\s*$/m);
      if (titleMatch) {
        title = titleMatch[1]!;
      }

      logger.info("GitHub article fetched", {
        stage: "pipeline",
        title,
        length: content.length,
      });

      return { content, title, url: targetUrl };
    }
  } catch (err) {
    logger.warn("GitHub raw fetch failed", {
      stage: "pipeline",
      url: targetUrl,
      error: err,
    });
  }

  return { content: "", title: "", url: targetUrl };
}
