// ============================================
// LLM-based Router Classification
// Only used when heuristics are insufficient
// ============================================

import OpenAI from "openai";
import { config } from "../config/env.js";
import { type Mode, type RouterInput } from "../router/types.js";
import { logger } from "../lib/logger.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * LLM classification result.
 */
export type LLMClassificationResult = {
  mode: Mode;
  confidence: "high" | "medium" | "low";
};

/**
 * Classify a question using LLM when heuristics fail.
 *
 * The LLM is ONLY used for classification.
 * It does NOT answer the question.
 * It does NOT read code.
 */
export async function classifyWithLLM(
  question: string,
  threadHistory?: RouterInput["threadHistory"]
): Promise<LLMClassificationResult> {
  const systemPrompt = buildClassificationPrompt();
  const userMessage = buildUserMessage(question, threadHistory);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",  // Fast, cheap model for classification
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: 100,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(content) as { mode?: string; confidence?: string };

    const mode = validateMode(parsed.mode);
    const confidence = validateConfidence(parsed.confidence);

    return { mode, confidence };
  } catch (err) {
    logger.warn("Failed to parse LLM classification response", {
      stage: "router",
      content,
      error: err,
    });

    // Default fallback
    return { mode: "capability_docs", confidence: "low" };
  }
}

/**
 * Build the classification system prompt.
 * V1: Docs-first, code tracing is out of scope.
 */
function buildClassificationPrompt(): string {
  return `You are a question classifier for Lightopedia, an internal Q&A system for the Light platform.

Your ONLY job is to classify questions into one of these modes:

- "capability_docs": Questions about what Light can or cannot do, concepts, integrations
  Examples: "Can Light do X?", "Does Light support Y?", "What is a contract in Light?", "How does the Salesforce integration work?"

- "enablement_sales": Questions about how to explain or position Light to customers
  Examples: "How should I explain X to a customer?", "What's the pitch for Y?", "How do I handle this objection?"

- "onboarding_howto": Questions about how to configure or use Light
  Examples: "How do I set up X?", "How do I configure Y?", "Step by step guide for Z"

- "followup": Continuation of a previous conversation
  Examples: Short messages like "what about X?", pronoun-heavy messages like "how does that work?"

- "clarify": The question is too vague or ambiguous to classify
  Examples: Single words, unclear context

- "out_of_scope": Questions about deep implementation behavior, code internals, or customer-specific data
  Examples: "What happens when invoice.markPaid() is called?", "Where is the retry logic?", "Why did this customer's invoice fail?"

Respond with JSON only:
{
  "mode": "<one of the modes above>",
  "confidence": "high" | "medium" | "low"
}

IMPORTANT:
- You are ONLY classifying. Do NOT answer the question.
- If a question asks about internal code behavior, runtime details, or specific customer data, classify as "out_of_scope".
- Use "clarify" only when the question is genuinely unclear.
- Default to "capability_docs" for general conceptual questions.`;
}

/**
 * Build the user message with optional thread context.
 */
function buildUserMessage(
  question: string,
  threadHistory?: RouterInput["threadHistory"]
): string {
  if (!threadHistory || threadHistory.length === 0) {
    return `Question: ${question}`;
  }

  const historyText = threadHistory
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 200)}`)
    .join("\n");

  return `Thread context:\n${historyText}\n\nCurrent question: ${question}`;
}

/**
 * Validate and normalize mode.
 */
function validateMode(mode: string | undefined): Mode {
  const validModes: Mode[] = [
    "capability_docs",
    "enablement_sales",
    "onboarding_howto",
    "followup",
    "clarify",
    "out_of_scope",
  ];

  if (mode && validModes.includes(mode as Mode)) {
    return mode as Mode;
  }

  return "capability_docs";
}

/**
 * Validate and normalize confidence.
 */
function validateConfidence(
  confidence: string | undefined
): "high" | "medium" | "low" {
  if (confidence === "high" || confidence === "medium" || confidence === "low") {
    return confidence;
  }
  return "medium";
}
