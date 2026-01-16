import OpenAI from "openai";
import { config } from "../config/env.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const MODEL = "text-embedding-3-large";
const DIMENSIONS = 1536; // Truncate to match schema

export async function embedQuery(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: MODEL,
    input: text,
    dimensions: DIMENSIONS,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error("No embedding returned from OpenAI");
  }
  return embedding;
}

export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await openai.embeddings.create({
    model: MODEL,
    input: texts,
    dimensions: DIMENSIONS,
  });
  return response.data.map((d) => d.embedding);
}
