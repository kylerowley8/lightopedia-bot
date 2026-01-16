import { supabase } from "../db/supabase.js";
import { embedQuery } from "./embeddings.js";
import { expandQuery } from "./expandQuery.js";
import { rerankChunks, calculateKeywordBoost, type RankedChunk } from "./rerank.js";
import { logger } from "../lib/logger.js";
import type { RetrievedChunk, RetrievalResult, ChunkMetadata } from "../types/index.js";

// Re-export types for backward compatibility
export type { RetrievedChunk, RetrievalResult, RankedChunk };

const MIN_SIMILARITY = 0.42;
const MIN_CHUNKS_FOR_CONFIDENCE = 1;
const MIN_TOKENS_FOR_CONFIDENCE = 30;
/** Minimum average relevance score after reranking */
const MIN_AVG_RELEVANCE = 4;

interface DbChunkRow {
  chunk_id: string;
  content: string;
  metadata: ChunkMetadata | null;
  similarity: number;
}

export async function retrieveContext(question: string, matchCount = 8): Promise<RetrievalResult> {
  // Expand the question into multiple search variations
  const queries = await expandQuery(question);

  logger.info("Query expansion complete", {
    stage: "retrieve",
    original: question.slice(0, 80),
    variationCount: queries.length - 1,
  });

  // Search with each query variation and collect results
  // Use a Map to track best similarity per chunk
  const chunkMap = new Map<string, RetrievedChunk>();

  for (const query of queries) {
    const embedding = await embedQuery(query);
    const embeddingStr = `[${embedding.join(",")}]`;

    const { data, error } = await supabase.rpc("match_chunks", {
      query_embedding: embeddingStr,
      match_count: matchCount,
    });

    if (error) {
      logger.error("match_chunks RPC failed", { stage: "retrieve", query: query.slice(0, 50), error });
      continue;
    }

    const rows = (data ?? []) as DbChunkRow[];

    logger.debug("Query search results", {
      stage: "retrieve",
      query: query.slice(0, 50),
      results: rows.length,
      topSimilarity: rows[0]?.similarity?.toFixed(3),
    });

    for (const row of rows) {
      const existing = chunkMap.get(row.chunk_id);
      // Keep the highest similarity score for each chunk
      if (!existing || row.similarity > existing.similarity) {
        chunkMap.set(row.chunk_id, {
          chunkId: row.chunk_id,
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

  const allChunks = Array.from(chunkMap.values());

  // Sort by similarity descending and take top matchCount
  allChunks.sort((a, b) => b.similarity - a.similarity);
  const topChunks = allChunks.slice(0, matchCount);

  // Filter by minimum similarity before reranking
  const filteredChunks = topChunks.filter((c) => c.similarity >= MIN_SIMILARITY);

  logger.info("Initial retrieval complete", {
    stage: "retrieve",
    queriesUsed: queries.length,
    totalFound: allChunks.length,
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
