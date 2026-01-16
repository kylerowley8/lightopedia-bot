import { supabase } from "../db/supabase.js";
import { embedQuery } from "./embeddings.js";
import { expandQuery } from "./expandQuery.js";

export interface RetrievedChunk {
  chunk_id: string;
  content: string;
  metadata: {
    document_id?: string;
    chunk_index?: number;
    source?: string;
  };
  similarity: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  totalTokens: number;
  avgSimilarity: number;
  isConfident: boolean;
}

const MIN_SIMILARITY = 0.42;
const MIN_CHUNKS_FOR_CONFIDENCE = 1;
const MIN_TOKENS_FOR_CONFIDENCE = 30;

export async function retrieveContext(question: string, matchCount = 8): Promise<RetrievalResult> {
  // Expand the question into multiple search variations
  const queries = await expandQuery(question);

  console.log("query_expansion", {
    original: question.slice(0, 80),
    variations: queries.slice(1),
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
      console.error("match_chunks error for query:", query, error);
      continue;
    }

    console.log("query_search", {
      query: query.slice(0, 50),
      results: data?.length ?? 0,
      topSimilarity: data?.[0]?.similarity?.toFixed(3),
    });

    for (const row of data ?? []) {
      const existing = chunkMap.get(row.chunk_id);
      // Keep the highest similarity score for each chunk
      if (!existing || row.similarity > existing.similarity) {
        chunkMap.set(row.chunk_id, {
          chunk_id: row.chunk_id,
          content: row.content,
          metadata: row.metadata ?? {},
          similarity: row.similarity,
        });
      }
    }
  }

  const allChunks = Array.from(chunkMap.values());

  // Sort by similarity descending and take top matchCount
  allChunks.sort((a, b) => b.similarity - a.similarity);
  const topChunks = allChunks.slice(0, matchCount);

  console.log("retrieval_result", {
    questionPreview: question.slice(0, 80),
    queriesUsed: queries.length,
    totalFound: allChunks.length,
    topChunkSimilarity: topChunks[0]?.similarity,
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
