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
 * Analyze an image using GPT-4V vision.
 * Returns extracted text, UI elements, and context.
 */
export async function analyzeImage(
  imageUrl: string,
  prompt: string,
  options: {
    authHeader?: string;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const { maxTokens = 1000 } = options;

  try {
    // If we have an auth header, we need to fetch and convert to base64
    let imageContent: { type: "image_url"; image_url: { url: string } };

    if (options.authHeader) {
      // Fetch image with auth and convert to base64
      const response = await fetch(imageUrl, {
        headers: { Authorization: options.authHeader },
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";

      logger.info("Fetched image from Slack", {
        stage: "llm",
        contentType,
        status: response.status,
        url: imageUrl.slice(0, 50),
      });

      // Validate it's actually an image
      if (!contentType.startsWith("image/")) {
        const textPreview = await response.text();
        logger.error("Slack returned non-image content", {
          stage: "llm",
          contentType,
          preview: textPreview.slice(0, 200),
        });
        throw new Error(`Slack returned ${contentType} instead of image. Likely auth issue.`);
      }

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      imageContent = {
        type: "image_url",
        image_url: { url: `data:${contentType};base64,${base64}` },
      };
    } else {
      imageContent = {
        type: "image_url",
        image_url: { url: imageUrl },
      };
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            imageContent,
          ],
        },
      ],
      max_tokens: maxTokens,
    });

    return response.choices[0]?.message?.content ?? "";
  } catch (err) {
    logger.error("Image analysis failed", {
      stage: "llm",
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
