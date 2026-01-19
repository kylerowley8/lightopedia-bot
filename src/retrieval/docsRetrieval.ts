// ============================================
// V3 Retrieval — Code > Docs > Slack hierarchy
// ============================================

import { supabase } from "../db/supabase.js";
import { embedQuery } from "./embeddings.js";
import { logger } from "../lib/logger.js";
import {
  type DocChunk,
  type CodeChunk,
  type SlackThread,
  type EvidencePack,
  type IndexMetadata,
  RETRIEVAL_VERSION,
  createEmptyEvidencePack,
} from "../evidence/types.js";
import type { RouteDecision } from "../router/types.js";
import crypto from "crypto";

// ============================================
// Configuration
// ============================================

const MIN_SIMILARITY = 0.2;
const MAX_CODE_RESULTS = 6;  // V3: Code is primary evidence
const MAX_DOC_RESULTS = 6;
const MAX_SLACK_RESULTS = 4;
const VECTOR_TIMEOUT_MS = 5000;

// ============================================
// Main Retrieval Function
// ============================================

/**
 * Retrieve evidence for a question.
 *
 * V3 retrieval strategy (Code > Docs > Slack):
 * 1. Expand query using hints from router
 * 2. Search all sources (code, docs, Slack) in parallel
 * 3. Separate code chunks from doc chunks
 * 4. Build EvidencePack with hierarchical evidence
 */
export async function retrieveDocs(
  question: string,
  route: RouteDecision
): Promise<EvidencePack> {
  const indexRunId = crypto.randomUUID();
  const pack = createEmptyEvidencePack(indexRunId);

  logger.info("Starting V3 retrieval", {
    stage: "retrieval",
    mode: route.mode,
    question: question.slice(0, 80),
    queryHints: route.queryHints,
  });

  // Build search queries from question and hints
  const queries = buildSearchQueries(question, route.queryHints);
  pack.retrievalMeta.queriesUsed = queries;

  // Search all sources in parallel
  const [allDocsResults, slackResults] = await Promise.all([
    searchDocs(queries, MAX_CODE_RESULTS + MAX_DOC_RESULTS),
    searchSlackThreads(queries, MAX_SLACK_RESULTS),
  ]);

  // Separate code chunks from doc chunks based on source_type
  const codeChunks: CodeChunk[] = [];
  const docChunks: DocChunk[] = [];

  for (const result of allDocsResults) {
    if (result.metadata.sourceType === "code") {
      codeChunks.push(transformToCodeChunk(result));
    } else {
      docChunks.push(result);
    }
  }

  // Apply limits
  pack.codeChunks = codeChunks.slice(0, MAX_CODE_RESULTS);
  pack.docs = docChunks.slice(0, MAX_DOC_RESULTS);
  pack.slackThreads = slackResults;
  pack.retrievalMeta.totalSearched =
    pack.codeChunks.length + pack.docs.length + pack.slackThreads.length;

  logger.info("V3 retrieval complete", {
    stage: "retrieval",
    codeCount: pack.codeChunks.length,
    docCount: pack.docs.length,
    slackCount: pack.slackThreads.length,
    topCodeSimilarity: pack.codeChunks[0]?.similarity?.toFixed(3),
    topDocSimilarity: pack.docs[0]?.similarity?.toFixed(3),
  });

  return pack;
}

/**
 * Transform a DocChunk (with code metadata) to a CodeChunk.
 */
function transformToCodeChunk(doc: DocChunk): CodeChunk {
  const meta = doc.metadata as any; // Extended metadata from code indexer
  return {
    id: doc.id,
    path: meta.path || doc.source,
    symbols: meta.symbols || [],
    startLine: meta.start_line || 0,
    endLine: meta.end_line || 0,
    chunkType: meta.chunk_type || "block",
    content: doc.content,
    similarity: doc.similarity,
    metadata: doc.metadata,
  };
}

// ============================================
// Query Building
// ============================================

/**
 * Build search queries from question and router hints.
 */
function buildSearchQueries(question: string, hints: string[]): string[] {
  const queries: string[] = [question];

  // Add hint-augmented queries
  for (const hint of hints.slice(0, 3)) {
    if (!question.toLowerCase().includes(hint.toLowerCase())) {
      queries.push(`${question} ${hint}`);
    }
  }

  // Add integration-specific queries for better matching
  for (const hint of hints) {
    const lowerHint = hint.toLowerCase();

    // Integration terms get special treatment
    if (INTEGRATION_TERMS.includes(lowerHint)) {
      queries.push(`${hint} integration`);
      queries.push(`Light ${hint}`);
      queries.push(`${hint} sync`);
    }

    // Entity hints
    if (isEntityHint(hint)) {
      queries.push(`Light ${hint}`);
    }
  }

  return [...new Set(queries)].slice(0, 7);
}

/**
 * Known integration terms that need special query expansion.
 */
const INTEGRATION_TERMS = [
  "salesforce", "stripe", "chargebee", "avalara", "finch",
  "banking", "ledger", "workflow", "api", "oauth"
];

/**
 * Check if a hint looks like an entity name.
 */
function isEntityHint(hint: string): boolean {
  // PascalCase or specific terms
  return /^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/.test(hint) ||
    ["invoice", "contract", "payment", "subscription", "ledger", "journal"].includes(hint.toLowerCase());
}

// ============================================
// Docs Search
// ============================================

interface DbDocMetadata {
  source?: string;
  section?: string;
  source_type?: string;
  repo_slug?: string;
  path?: string;
  commit_sha?: string;
  indexed_at?: string;
  index_run_id?: string;
  retrieval_program_version?: string;
}

interface DbDocRow {
  id: string;
  content: string;
  metadata: DbDocMetadata | null;
  similarity: number;
}

/**
 * Search documentation chunks.
 */
async function searchDocs(queries: string[], limit: number): Promise<DocChunk[]> {
  const chunkMap = new Map<string, DocChunk>();

  // Generate embeddings for all queries in parallel
  const embeddings = await Promise.all(queries.map(embedQuery));

  // Search with each embedding in parallel
  const searchPromises = embeddings.map((embedding, i) =>
    executeDocSearch(queries[i]!, embedding, limit)
  );

  const results = await Promise.all(searchPromises);

  // Merge results, keeping highest similarity per chunk
  for (const result of results) {
    if (!result) continue;
    for (const row of result) {
      const existing = chunkMap.get(row.id);
      if (!existing || row.similarity > existing.similarity) {
        chunkMap.set(row.id, transformDocRow(row));
      }
    }
  }

  // Sort by similarity and filter
  return Array.from(chunkMap.values())
    .filter((c) => c.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Execute a single doc search with timeout.
 */
async function executeDocSearch(
  query: string,
  embedding: number[],
  limit: number
): Promise<DbDocRow[] | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), VECTOR_TIMEOUT_MS);
  });

  const searchPromise = supabase.rpc("match_docs", {
    query_embedding: embedding,
    match_count: limit,
  });

  const result = await Promise.race([searchPromise, timeoutPromise]);

  if (result === null) {
    logger.warn("Doc search timed out", {
      stage: "retrieval",
      query: query.slice(0, 50),
    });
    return null;
  }

  if (result.error) {
    logger.error("Doc search failed", {
      stage: "retrieval",
      error: result.error.message,
    });
    return null;
  }

  return (result.data ?? []) as DbDocRow[];
}

/**
 * Transform database row to DocChunk.
 */
function transformDocRow(row: DbDocRow): DocChunk {
  const meta: DbDocMetadata = row.metadata ?? {};

  return {
    id: row.id,
    source: meta.source ?? meta.path ?? "unknown",
    section: meta.section,
    content: row.content,
    similarity: row.similarity,
    metadata: {
      sourceType: (meta.source_type as "repo" | "slack") ?? "repo",
      repoSlug: meta.repo_slug,
      path: meta.path ?? meta.source ?? "",
      commitSha: meta.commit_sha,
      indexedAt: meta.indexed_at ?? new Date().toISOString(),
      indexRunId: meta.index_run_id ?? "unknown",
      retrievalProgramVersion: meta.retrieval_program_version ?? RETRIEVAL_VERSION,
    },
  };
}

// ============================================
// Slack Thread Search
// ============================================

interface DbSlackRow {
  id: string;
  content: string;
  metadata: {
    permalink?: string;
    topic?: string;
    channel?: string;
    indexed_at?: string;
    index_run_id?: string;
  } | null;
  similarity: number;
}

/**
 * Search curated Slack threads from #lightopedia.
 */
async function searchSlackThreads(queries: string[], limit: number): Promise<SlackThread[]> {
  const threadMap = new Map<string, SlackThread>();

  // Generate embeddings for queries
  const embeddings = await Promise.all(queries.map(embedQuery));

  // Search with each embedding
  const searchPromises = embeddings.map((embedding, i) =>
    executeSlackSearch(queries[i]!, embedding, limit)
  );

  const results = await Promise.all(searchPromises);

  // Merge results
  for (const result of results) {
    if (!result) continue;
    for (const row of result) {
      const existing = threadMap.get(row.id);
      if (!existing || row.similarity > existing.similarity) {
        threadMap.set(row.id, transformSlackRow(row));
      }
    }
  }

  return Array.from(threadMap.values())
    .filter((t) => t.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Execute a single Slack search with timeout.
 */
async function executeSlackSearch(
  query: string,
  embedding: number[],
  limit: number
): Promise<DbSlackRow[] | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), VECTOR_TIMEOUT_MS);
  });

  const searchPromise = supabase.rpc("match_slack_threads", {
    query_embedding: embedding,
    match_count: limit,
  });

  const result = await Promise.race([searchPromise, timeoutPromise]);

  if (result === null) {
    logger.warn("Slack search timed out", {
      stage: "retrieval",
      query: query.slice(0, 50),
    });
    return null;
  }

  if (result.error) {
    // Slack search is optional - don't fail retrieval
    logger.warn("Slack search failed", {
      stage: "retrieval",
      error: result.error.message,
    });
    return null;
  }

  return (result.data ?? []) as DbSlackRow[];
}

/**
 * Transform database row to SlackThread.
 */
function transformSlackRow(row: DbSlackRow): SlackThread {
  const meta = row.metadata ?? {};

  return {
    id: row.id,
    permalink: meta.permalink ?? "",
    topic: meta.topic ?? "Lightopedia thread",
    content: row.content,
    similarity: row.similarity,
    metadata: {
      sourceType: "slack",
      path: meta.permalink ?? "",
      indexedAt: meta.indexed_at ?? new Date().toISOString(),
      indexRunId: meta.index_run_id ?? "unknown",
      retrievalProgramVersion: RETRIEVAL_VERSION,
      slackPermalink: meta.permalink,
    },
  };
}
