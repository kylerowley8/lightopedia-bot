// ============================================
// Embeddings — OpenAI embedding generation
// Pin versions for retrieval determinism.
// ============================================

import OpenAI from "openai";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Embedding model version.
 * PINNED for retrieval determinism - bump carefully.
 */
export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate embedding for a query string.
 */
export async function embedQuery(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // Truncate to model limit
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error("No embedding returned from OpenAI");
    }
    return embedding;
  } catch (err) {
    logger.error("Embedding generation failed", {
      stage: "retrieval",
      textPreview: text.slice(0, 50),
      error: err,
    });
    throw err;
  }
}

/**
 * Generate embeddings for multiple strings in batch.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts.map((t) => t.slice(0, 8000)),
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data.map((d) => d.embedding);
  } catch (err) {
    logger.error("Batch embedding generation failed", {
      stage: "retrieval",
      textCount: texts.length,
      error: err,
    });
    throw err;
  }
}
