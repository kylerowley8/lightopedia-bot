import OpenAI from "openai";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { RetrievedChunk } from "../types/index.js";

// ============================================
// LLM-based Reranker
// Scores chunk relevance after initial retrieval
// ============================================

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/** Reranked chunk with additional scoring */
export interface RankedChunk extends RetrievedChunk {
  /** LLM-assigned relevance score (0-10) */
  relevanceScore: number;
  /** Original vector similarity score */
  vectorSimilarity: number;
  /** Combined score for final ranking */
  combinedScore: number;
}

/** Weight for combining vector and relevance scores */
const VECTOR_WEIGHT = 0.3;
const RELEVANCE_WEIGHT = 0.7;

/** Minimum relevance score to keep a chunk */
const MIN_RELEVANCE_SCORE = 3;

const RERANK_PROMPT = `You are a relevance judge for a Q&A system about Light, a finance/accounting platform.

Score how relevant each text chunk is to answering the given question.
Output ONLY a JSON array of scores, one per chunk, in order.

Scoring guide:
- 10: Directly answers the question with specific details
- 7-9: Highly relevant, contains key information for the answer
- 4-6: Somewhat relevant, provides useful context
- 1-3: Tangentially related, might help but not directly
- 0: Completely irrelevant

Consider:
- Does the chunk mention concepts from the question?
- Does it explain HOW something works (not just that it exists)?
- Would this help a sales engineer answer a customer question?

Output format: [score1, score2, score3, ...]
Output ONLY the JSON array, no other text.`;

/**
 * Rerank retrieved chunks using LLM-based relevance scoring.
 * Returns chunks sorted by combined score (vector similarity + relevance).
 */
export async function rerankChunks(
  question: string,
  chunks: RetrievedChunk[]
): Promise<RankedChunk[]> {
  if (chunks.length === 0) {
    return [];
  }

  // For very few chunks, skip reranking overhead
  if (chunks.length <= 2) {
    return chunks.map((chunk) => ({
      ...chunk,
      relevanceScore: 7, // Assume decent relevance for small sets
      vectorSimilarity: chunk.similarity,
      combinedScore: chunk.similarity,
    }));
  }

  try {
    // Build the content for reranking
    const chunksText = chunks
      .map((c, i) => `[Chunk ${i + 1}]\n${c.content.slice(0, 400)}`)
      .join("\n\n---\n\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: RERANK_PROMPT },
        {
          role: "user",
          content: `QUESTION: ${question}\n\nCHUNKS TO SCORE:\n${chunksText}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const rawOutput = response.choices[0]?.message?.content || "[]";
    const scores = parseScores(rawOutput, chunks.length);

    // Combine scores and create ranked chunks
    const rankedChunks: RankedChunk[] = chunks.map((chunk, i) => {
      const relevanceScore = scores[i] ?? 5;
      const normalizedRelevance = relevanceScore / 10; // Normalize to 0-1
      const combinedScore =
        VECTOR_WEIGHT * chunk.similarity + RELEVANCE_WEIGHT * normalizedRelevance;

      return {
        ...chunk,
        relevanceScore,
        vectorSimilarity: chunk.similarity,
        combinedScore,
      };
    });

    // Sort by combined score descending
    rankedChunks.sort((a, b) => b.combinedScore - a.combinedScore);

    // Filter out very low relevance chunks
    const filteredChunks = rankedChunks.filter(
      (c) => c.relevanceScore >= MIN_RELEVANCE_SCORE
    );

    logger.debug("Reranking complete", {
      stage: "retrieve",
      inputCount: chunks.length,
      outputCount: filteredChunks.length,
      topScore: filteredChunks[0]?.combinedScore.toFixed(3),
      avgRelevance:
        filteredChunks.length > 0
          ? (
              filteredChunks.reduce((sum, c) => sum + c.relevanceScore, 0) /
              filteredChunks.length
            ).toFixed(1)
          : "0",
    });

    return filteredChunks;
  } catch (err) {
    logger.warn("Reranking failed, using original order", {
      stage: "retrieve",
      error: err,
    });

    // Fallback: return original chunks with default scores
    return chunks.map((chunk) => ({
      ...chunk,
      relevanceScore: 5,
      vectorSimilarity: chunk.similarity,
      combinedScore: chunk.similarity,
    }));
  }
}

/**
 * Parse LLM output into array of scores.
 * Handles various output formats and validates scores.
 */
function parseScores(output: string, expectedCount: number): number[] {
  try {
    // Try to extract JSON array from response
    const match = output.match(/\[[\d\s,\.]+\]/);
    if (!match) {
      return new Array(expectedCount).fill(5);
    }

    const parsed = JSON.parse(match[0]) as unknown[];
    const scores = parsed.map((v) => {
      const num = typeof v === "number" ? v : parseFloat(String(v));
      return isNaN(num) ? 5 : Math.max(0, Math.min(10, num));
    });

    // Pad or trim to expected count
    while (scores.length < expectedCount) scores.push(5);
    return scores.slice(0, expectedCount);
  } catch {
    return new Array(expectedCount).fill(5);
  }
}

/**
 * Calculate keyword match boost for a chunk.
 * Returns a boost factor (0-0.2) based on exact/partial matches.
 */
export function calculateKeywordBoost(question: string, content: string): number {
  const questionLower = question.toLowerCase();
  const contentLower = content.toLowerCase();

  // Extract meaningful keywords (3+ chars, not common words)
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "have", "been", "were", "they",
    "this", "that", "with", "from", "what", "how", "does", "light", "about",
  ]);

  const keywords = questionLower
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  if (keywords.length === 0) return 0;

  // Count matches
  let exactMatches = 0;
  let partialMatches = 0;

  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) {
      exactMatches++;
    } else {
      // Check for partial matches (e.g., "billing" matches "bill")
      const stem = keyword.slice(0, Math.max(4, keyword.length - 2));
      if (contentLower.includes(stem)) {
        partialMatches++;
      }
    }
  }

  // Calculate boost (max 0.2)
  const matchRatio = (exactMatches + partialMatches * 0.5) / keywords.length;
  return Math.min(0.2, matchRatio * 0.25);
}
