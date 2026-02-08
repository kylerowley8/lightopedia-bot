// ============================================
// Retrieval — Fetch articles by path + semantic search
// ============================================

import { supabase } from "../db/supabase.js";
import { logger } from "../lib/logger.js";
import { embedQuery } from "./embeddings.js";
import type { Article } from "../evidence/types.js";
import { RETRIEVAL_VERSION } from "../evidence/types.js";

// ============================================
// Fetch Articles by Path (for fetch_articles tool)
// ============================================

interface DocsRow {
  id: string;
  content: string;
  metadata: Record<string, string | undefined> | null;
}

/**
 * Fetch full article content by file paths.
 * Groups chunks by path and assembles them into complete articles.
 * Used by the fetch_articles agent tool.
 */
export async function fetchArticlesByPath(paths: string[]): Promise<Article[]> {
  if (paths.length === 0) return [];

  logger.info("Fetching articles by path", {
    stage: "retrieval",
    paths,
  });

  // Query all chunks that match any of the given paths
  // Supabase metadata is JSONB, so we filter with an OR across paths
  const { data, error } = await supabase
    .from("docs")
    .select("id, content, metadata")
    .or(
      paths
        .map((p) => `metadata->>path.eq.${p}`)
        .join(",")
    )
    .order("id", { ascending: true });

  if (error) {
    logger.error("Failed to fetch articles by path", {
      stage: "retrieval",
      error: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as DocsRow[];

  // Group chunks by path, concatenating content
  const pathGroups = new Map<string, { chunks: DocsRow[]; meta: Record<string, string | undefined> }>();

  for (const row of rows) {
    const meta = row.metadata ?? {};
    const path = meta["path"] ?? meta["source"] ?? "unknown";

    const group = pathGroups.get(path);
    if (group) {
      group.chunks.push(row);
    } else {
      pathGroups.set(path, { chunks: [row], meta });
    }
  }

  // Build Article[] with assembled content
  const articles: Article[] = [];

  for (const [path, { chunks, meta }] of pathGroups) {
    const content = chunks.map((c) => c.content).join("\n\n");
    const title = meta["title"] ?? extractTitleFromPath(path);

    articles.push({
      id: chunks[0]!.id,
      path,
      section: meta["section"],
      title,
      content,
      score: 1.0, // Direct fetch, no relevance scoring
      repoSlug: meta["repo_slug"] ?? "light-space/help-articles",
      metadata: {
        path,
        indexedAt: meta["indexed_at"] ?? new Date().toISOString(),
        indexRunId: meta["index_run_id"] ?? "direct-fetch",
        retrievalProgramVersion: RETRIEVAL_VERSION,
        repoSlug: meta["repo_slug"] ?? "light-space/help-articles",
        commitSha: meta["commit_sha"],
      },
    });
  }

  logger.info("Articles fetched by path", {
    stage: "retrieval",
    requestedPaths: paths.length,
    foundArticles: articles.length,
  });

  return articles;
}

// ============================================
// Semantic Search (for search_articles tool)
// ============================================

interface MatchDocsRow {
  id: string;
  content: string;
  metadata: Record<string, string | undefined> | null;
  similarity: number;
}

const MIN_SIMILARITY = 0.15;

/**
 * Search articles by semantic similarity using vector embeddings.
 * Embeds the query, calls match_docs RPC, groups chunks by path.
 * Used as a fallback when title-based browsing misses relevant articles.
 */
export async function searchArticlesBySimilarity(
  query: string,
  maxResults: number = 8
): Promise<Article[]> {
  logger.info("Searching articles by similarity", {
    stage: "retrieval",
    query: query.slice(0, 80),
  });

  const queryEmbedding = await embedQuery(query);

  const { data, error } = await supabase.rpc("match_docs", {
    query_embedding: queryEmbedding,
    match_count: maxResults * 4, // fetch extra chunks to group by path
  });

  if (error) {
    logger.error("Semantic search failed", {
      stage: "retrieval",
      error: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as MatchDocsRow[];

  // Filter by minimum similarity
  const filtered = rows.filter((r) => r.similarity >= MIN_SIMILARITY);

  // Group chunks by path, keeping best similarity score
  const pathGroups = new Map<
    string,
    { chunks: MatchDocsRow[]; meta: Record<string, string | undefined>; bestScore: number }
  >();

  for (const row of filtered) {
    const meta = row.metadata ?? {};
    const path = meta["path"] ?? meta["source"] ?? "unknown";

    const group = pathGroups.get(path);
    if (group) {
      group.chunks.push(row);
      group.bestScore = Math.max(group.bestScore, row.similarity);
    } else {
      pathGroups.set(path, { chunks: [row], meta, bestScore: row.similarity });
    }
  }

  // Build articles, sorted by best score, limited to maxResults
  const sorted = [...pathGroups.entries()]
    .sort((a, b) => b[1].bestScore - a[1].bestScore)
    .slice(0, maxResults);

  const articles: Article[] = sorted.map(([path, { chunks, meta, bestScore }]) => {
    const content = chunks.map((c) => c.content).join("\n\n");
    const title = meta["title"] ?? extractTitleFromPath(path);

    return {
      id: chunks[0]!.id,
      path,
      section: meta["section"],
      title,
      content,
      score: bestScore,
      repoSlug: meta["repo_slug"] ?? "light-space/help-articles",
      metadata: {
        path,
        indexedAt: meta["indexed_at"] ?? new Date().toISOString(),
        indexRunId: meta["index_run_id"] ?? "semantic-search",
        retrievalProgramVersion: RETRIEVAL_VERSION,
        repoSlug: meta["repo_slug"] ?? "light-space/help-articles",
        commitSha: meta["commit_sha"],
      },
    };
  });

  logger.info("Semantic search complete", {
    stage: "retrieval",
    query: query.slice(0, 80),
    totalChunks: rows.length,
    filteredChunks: filtered.length,
    uniqueArticles: articles.length,
  });

  return articles;
}

// ============================================
// Utilities
// ============================================

/**
 * Extract a human-readable title from a file path.
 * e.g., "getting-started/invoicing.md" -> "Invoicing"
 */
function extractTitleFromPath(path: string): string {
  if (!path) return "Help Article";
  const filename = path.split("/").pop() ?? path;
  const name = filename.replace(/\.(md|mdx)$/i, "");
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
