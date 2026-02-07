// ============================================
// Embeddings — OpenAI embedding generation
// Used by indexer to create vector embeddings for docs
// ============================================

import { openai } from "../llm/client.js";

export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate embedding vector for a text string.
 * Used by the indexer to create vectors for document chunks.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0]!.embedding;
}

/**
 * Generate embeddings for multiple text chunks in batch.
 * Used by the indexer to create vectors for document chunks.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, 8000));

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data.map((d) => d.embedding);
}
