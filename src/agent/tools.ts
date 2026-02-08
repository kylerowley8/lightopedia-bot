// ============================================
// Agent Tools — Tool definitions + execution handlers
// Three tools: list_articles, fetch_articles, escalate_to_human
// ============================================

import type { ChatCompletionTool } from "openai/resources/chat/completions.js";
import { generateManifest } from "../retrieval/manifest.js";
import { fetchArticlesByPath, searchArticlesBySimilarity } from "../retrieval/search.js";
import { logger } from "../lib/logger.js";

// ============================================
// Tool Definitions (OpenAI function calling schema)
// ============================================

export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_articles",
      description:
        "List all available help articles. Returns a manifest of article titles, categories, and summaries. Use this first to understand what documentation is available before fetching specific articles.",
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
        "Fetch the full content of specific help articles by their file paths. Use this after browsing the article list to retrieve detailed content for articles relevant to the user's question. Maximum 10 articles per call.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of article file paths to fetch (e.g., ['getting-started/invoicing.md', 'integrations/stripe.md']). Maximum 10 paths.",
            maxItems: 10,
          },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description:
        "Escalate the question to a human when the help articles don't cover the topic, or the user needs hands-on support. Creates a structured ticket draft for the support team. IMPORTANT: Only use this AFTER trying both list_articles AND search_articles — never escalate without searching first.",
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
  {
    type: "function",
    function: {
      name: "search_articles",
      description:
        "Search help articles by semantic similarity. Use this when you can't find relevant articles by title in the manifest, or when the user's question uses different terminology than the article titles. This searches the full content of all articles using AI embeddings. Returns the most relevant articles with similarity scores.",
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
];

// ============================================
// Tool Execution Handlers
// ============================================

export interface ToolResult {
  content: string;
  /** Article paths that were fetched (for citation validation) */
  fetchedPaths?: string[];
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
    case "list_articles":
      return executeListArticles(requestId);
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

async function executeListArticles(requestId: string): Promise<ToolResult> {
  logger.info("Executing list_articles", { stage: "pipeline", requestId });

  const manifest = await generateManifest();

  // Format as compact text for the LLM
  const lines = manifest.map(
    (entry) =>
      `- [${entry.category}] "${entry.title}" (${entry.path}) — ${entry.firstSentence}`
  );

  const content = `Available articles (${manifest.length} total):\n\n${lines.join("\n")}`;

  logger.info("list_articles complete", {
    stage: "pipeline",
    requestId,
    articleCount: manifest.length,
  });

  return { content };
}

async function executeFetchArticles(
  args: Record<string, unknown>,
  requestId: string
): Promise<ToolResult> {
  const paths = (args["paths"] as string[] | undefined) ?? [];

  if (paths.length === 0) {
    return { content: "No article paths provided." };
  }

  if (paths.length > 10) {
    return { content: "Maximum 10 articles per fetch. Please reduce your selection." };
  }

  logger.info("Executing fetch_articles", {
    stage: "pipeline",
    requestId,
    paths,
  });

  const articles = await fetchArticlesByPath(paths);

  if (articles.length === 0) {
    return {
      content: "No articles found for the given paths. The paths may be incorrect.",
      fetchedPaths: [],
    };
  }

  // Format articles with full content
  const sections = articles.map((article, i) => {
    const label = article.title || article.path;
    return `=== Article ${i + 1}: ${label} (${article.path}) ===\n\n${article.content}`;
  });

  const content = sections.join("\n\n---\n\n");

  logger.info("fetch_articles complete", {
    stage: "pipeline",
    requestId,
    fetchedCount: articles.length,
  });

  return {
    content,
    fetchedPaths: articles.map((a) => a.path),
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

  const articles = await searchArticlesBySimilarity(query, 8);

  if (articles.length === 0) {
    return {
      content: "No relevant articles found for this search query.",
      fetchedPaths: [],
    };
  }

  // Format results with content and similarity scores
  const sections = articles.map((article, i) => {
    const label = article.title || article.path;
    const score = (article.score * 100).toFixed(0);
    return `=== Result ${i + 1}: ${label} (${article.path}) [${score}% match] ===\n\n${article.content}`;
  });

  const content = `Found ${articles.length} relevant articles:\n\n${sections.join("\n\n---\n\n")}`;

  logger.info("search_articles complete", {
    stage: "pipeline",
    requestId,
    resultCount: articles.length,
    topScore: articles[0]?.score,
  });

  return {
    content,
    fetchedPaths: articles.map((a) => a.path),
  };
}
