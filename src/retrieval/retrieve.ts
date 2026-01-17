import { supabase } from "../db/supabase.js";
import { embedQuery } from "./embeddings.js";
import { expandQuery } from "./expandQuery.js";
import { rerankChunks, calculateKeywordBoost, type RankedChunk } from "./rerank.js";
import { keywordSearch, mergeSearchResults } from "./keywordSearch.js";
import { logger } from "../lib/logger.js";
import type { RetrievedChunk, RetrievalResult, ChunkMetadata } from "../types/index.js";

// Re-export types for backward compatibility
export type { RetrievedChunk, RetrievalResult, RankedChunk };

const MIN_SIMILARITY = 0.42;
const MIN_CHUNKS_FOR_CONFIDENCE = 1;
const MIN_TOKENS_FOR_CONFIDENCE = 30;
/** Minimum average relevance score after reranking */
const MIN_AVG_RELEVANCE = 4;
/** Timeout for each vector RPC call in ms */
const VECTOR_RPC_TIMEOUT_MS = 5000;

interface DbChunkRow {
  id: string;
  content: string;
  metadata: ChunkMetadata | null;
  similarity: number;
}

interface VectorSearchResult {
  chunks: RetrievedChunk[];
  queries: string[];
  timedOut: number;
  failed: number;
}

/**
 * Execute a single vector search with timeout.
 * Returns null on timeout or error.
 */
async function executeVectorQuery(
  query: string,
  embedding: number[],
  matchCount: number
): Promise<{ query: string; rows: DbChunkRow[]; durationMs: number } | null> {
  const startTime = Date.now();

  // Create a timeout promise
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), VECTOR_RPC_TIMEOUT_MS);
  });

  // Create the RPC promise - pass embedding as array directly, not as string
  const rpcPromise = supabase.rpc("match_chunks", {
    query_embedding: embedding, // Pass as number[] array, not string
    match_count: matchCount,
  });

  // Race between timeout and RPC
  const result = await Promise.race([rpcPromise, timeoutPromise]);
  const durationMs = Date.now() - startTime;

  // Timeout occurred
  if (result === null) {
    logger.warn("match_chunks RPC timed out", {
      stage: "retrieve",
      query: query.slice(0, 50),
      durationMs,
      timeoutMs: VECTOR_RPC_TIMEOUT_MS,
    });
    return null;
  }

  const { data, error } = result;

  if (error) {
    logger.error("match_chunks RPC failed", {
      stage: "retrieve",
      query: query.slice(0, 50),
      durationMs,
      errorMessage: error.message,
      errorCode: error.code,
      errorDetails: error.details,
      errorHint: error.hint,
    });
    return null;
  }

  return {
    query,
    rows: (data ?? []) as DbChunkRow[],
    durationMs,
  };
}

/**
 * Vector search using embeddings.
 * Expands the query, generates embeddings in parallel, and searches in parallel.
 */
async function vectorSearch(question: string, matchCount: number): Promise<VectorSearchResult> {
  const queries = await expandQuery(question);

  // Generate all embeddings in parallel
  const embeddingPromises = queries.map((q) => embedQuery(q));
  const embeddings = await Promise.all(embeddingPromises);

  // Execute all vector searches in parallel with Promise.allSettled
  const searchPromises = queries.map((query, i) =>
    executeVectorQuery(query, embeddings[i]!, matchCount)
  );
  const searchResults = await Promise.allSettled(searchPromises);

  // Merge results, tracking failures
  const chunkMap = new Map<string, RetrievedChunk>();
  let timedOut = 0;
  let failed = 0;
  const durations: number[] = [];

  for (const result of searchResults) {
    if (result.status === "rejected") {
      failed++;
      continue;
    }

    const value = result.value;
    if (value === null) {
      timedOut++;
      continue;
    }

    durations.push(value.durationMs);

    for (const row of value.rows) {
      const existing = chunkMap.get(row.id);
      if (!existing || row.similarity > existing.similarity) {
        chunkMap.set(row.id, {
          chunkId: row.id,
          content: row.content,
          metadata: {
            source: row.metadata?.source ?? "unknown",
            documentId: row.metadata?.documentId,
            chunkIndex: row.metadata?.chunkIndex,
          },
          similarity: row.similarity,
        });
      }
    }
  }

  const results = Array.from(chunkMap.values());
  results.sort((a, b) => b.similarity - a.similarity);

  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  logger.info("Vector search complete", {
    stage: "retrieve",
    queriesUsed: queries.length,
    successful: queries.length - timedOut - failed,
    timedOut,
    failed,
    totalFound: results.length,
    avgDurationMs: avgDuration,
    topSimilarity: results[0]?.similarity?.toFixed(3),
  });

  return { chunks: results, queries, timedOut, failed };
}

export async function retrieveContext(question: string, matchCount = 8): Promise<RetrievalResult> {
  // Run vector search and keyword search in parallel
  const [vectorResult, keywordResults] = await Promise.all([
    vectorSearch(question, matchCount),
    keywordSearch(question, matchCount),
  ]);

  const { chunks: vectorChunks, queries, timedOut, failed } = vectorResult;

  logger.info("Query expansion complete", {
    stage: "retrieve",
    original: question.slice(0, 80),
    variationCount: queries.length - 1,
  });

  // Determine if vector search is degraded (all failed/timed out)
  const vectorDegraded = vectorChunks.length === 0 && (timedOut > 0 || failed > 0);

  // Merge vector and keyword results (hybrid search)
  // If vector is degraded, rely more heavily on keyword results
  let mergedChunks: RetrievedChunk[];
  if (vectorDegraded && keywordResults.length > 0) {
    // Vector failed - use keyword results with boosted similarity scores
    logger.warn("Vector search degraded, falling back to keyword-only", {
      stage: "retrieve",
      timedOut,
      failed,
      keywordResults: keywordResults.length,
    });
    // Boost keyword results so they pass similarity threshold
    mergedChunks = keywordResults.map((chunk) => ({
      ...chunk,
      similarity: Math.max(chunk.similarity, MIN_SIMILARITY + 0.05),
    }));
  } else {
    mergedChunks = mergeSearchResults(vectorChunks, keywordResults, 0.7, 0.3);
  }

  // Take top results after merging
  const topChunks = mergedChunks.slice(0, matchCount * 2); // Take more for reranking

  // Filter by minimum similarity
  const filteredChunks = topChunks.filter((c) => c.similarity >= MIN_SIMILARITY);

  logger.info("Hybrid search complete", {
    stage: "retrieve",
    vectorResults: vectorChunks.length,
    vectorDegraded,
    keywordResults: keywordResults.length,
    mergedTotal: mergedChunks.length,
    afterFilter: filteredChunks.length,
    topSimilarity: filteredChunks[0]?.similarity?.toFixed(3),
  });

  // Skip reranking if no chunks found
  if (filteredChunks.length === 0) {
    return {
      chunks: [],
      totalTokens: 0,
      avgSimilarity: 0,
      isConfident: false,
      queriesUsed: queries,
    };
  }

  // Apply keyword boost before reranking
  const boostedChunks = filteredChunks.map((chunk) => {
    const boost = calculateKeywordBoost(question, chunk.content);
    return {
      ...chunk,
      similarity: Math.min(1, chunk.similarity + boost),
    };
  });

  // Rerank chunks using LLM-based relevance scoring
  const rankedChunks = await rerankChunks(question, boostedChunks);

  // Estimate tokens (rough: 4 chars = 1 token)
  const totalTokens = rankedChunks.reduce((sum, c) => sum + Math.ceil(c.content.length / 4), 0);

  // Calculate average scores
  const avgSimilarity =
    rankedChunks.length > 0
      ? rankedChunks.reduce((sum, c) => sum + c.combinedScore, 0) / rankedChunks.length
      : 0;

  const avgRelevance =
    rankedChunks.length > 0
      ? rankedChunks.reduce((sum, c) => sum + c.relevanceScore, 0) / rankedChunks.length
      : 0;

  // Confidence now considers reranking scores
  const isConfident =
    rankedChunks.length >= MIN_CHUNKS_FOR_CONFIDENCE &&
    totalTokens >= MIN_TOKENS_FOR_CONFIDENCE &&
    avgSimilarity >= MIN_SIMILARITY &&
    avgRelevance >= MIN_AVG_RELEVANCE;

  logger.info("Reranking complete", {
    stage: "retrieve",
    inputChunks: filteredChunks.length,
    outputChunks: rankedChunks.length,
    avgRelevance: avgRelevance.toFixed(1),
    avgCombined: avgSimilarity.toFixed(3),
    isConfident,
  });

  return {
    chunks: rankedChunks,
    totalTokens,
    avgSimilarity,
    isConfident,
    queriesUsed: queries,
  };
}

export function formatSources(chunks: RetrievedChunk[]): string {
  const sources = new Set<string>();
  for (const chunk of chunks) {
    const source = chunk.metadata.source || "unknown";
    sources.add(source);
  }
  if (sources.size === 0) return "";
  return `\n\n📚 *Sources:* ${[...sources].join(", ")}`;
}
