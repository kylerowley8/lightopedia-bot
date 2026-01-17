// ============================================
// LLM Client — OpenAI API wrapper
// ============================================

import OpenAI from "openai";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * LLM model configuration.
 * Pin versions for reproducibility.
 */
export const SYNTHESIS_MODEL = "gpt-4o";
export const FAST_MODEL = "gpt-4o-mini";

/**
 * Generate a completion with structured output.
 */
export async function generateCompletion(
  systemPrompt: string,
  userMessage: string,
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  } = {}
): Promise<string> {
  const {
    model = SYNTHESIS_MODEL,
    temperature = 0.3,
    maxTokens = 1000,
    jsonMode = false,
  } = options;

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature,
      max_tokens: maxTokens,
      ...(jsonMode && { response_format: { type: "json_object" } }),
    });

    return response.choices[0]?.message?.content ?? "";
  } catch (err) {
    logger.error("LLM completion failed", {
      stage: "llm",
      model,
      error: err,
    });
    throw err;
  }
}

/**
 * Parse JSON from LLM response, with fallback.
 */
export function parseJsonResponse<T>(response: string, fallback: T): T {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1]! : response;

    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    logger.warn("Failed to parse LLM JSON response", {
      stage: "llm",
      responsePreview: response.slice(0, 100),
    });
    return fallback;
  }
}
