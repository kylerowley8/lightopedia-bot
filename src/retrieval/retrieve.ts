import { supabase } from "../db/supabase.js";
import { embedQuery } from "./embeddings.js";
import { expandQuery } from "./expandQuery.js";
import { logger } from "../lib/logger.js";
import type { RetrievedChunk, RetrievalResult, ChunkMetadata } from "../types/index.js";

// Re-export types for backward compatibility
export type { RetrievedChunk, RetrievalResult };

const MIN_SIMILARITY = 0.42;
const MIN_CHUNKS_FOR_CONFIDENCE = 1;
const MIN_TOKENS_FOR_CONFIDENCE = 30;

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

  logger.info("Retrieval complete", {
    stage: "retrieve",
    queriesUsed: queries.length,
    totalFound: allChunks.length,
    topChunkSimilarity: topChunks[0]?.similarity?.toFixed(3),
  });

  // Filter by minimum similarity
  const relevantChunks = topChunks.filter((c) => c.similarity >= MIN_SIMILARITY);

  // Estimate tokens (rough: 4 chars = 1 token)
  const totalTokens = relevantChunks.reduce((sum, c) => sum + Math.ceil(c.content.length / 4), 0);

  const avgSimilarity =
    relevantChunks.length > 0
      ? relevantChunks.reduce((sum, c) => sum + c.similarity, 0) / relevantChunks.length
      : 0;

  const isConfident =
    relevantChunks.length >= MIN_CHUNKS_FOR_CONFIDENCE &&
    totalTokens >= MIN_TOKENS_FOR_CONFIDENCE &&
    avgSimilarity >= MIN_SIMILARITY;

  return {
    chunks: relevantChunks,
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
