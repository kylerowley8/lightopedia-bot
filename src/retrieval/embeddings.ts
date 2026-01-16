import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "text-embedding-3-large";
const DIMENSIONS = 1536; // Truncate to match schema

export async function embedQuery(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: MODEL,
    input: text,
    dimensions: DIMENSIONS,
  });
  return response.data[0].embedding;
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
