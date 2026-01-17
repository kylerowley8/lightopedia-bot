import OpenAI from "openai";
import crypto from "crypto";
import { config } from "../config/env.js";
import { logger, createRequestLogger } from "../lib/logger.js";
import { supabase } from "../db/supabase.js";
import {
  LIGHTOPEDIA_SYSTEM_PROMPT,
  JSON_OUTPUT_PROMPT,
  RUNTIME_DIRECTIVES,
  missingContextFallback,
} from "../prompts/lightopediaSystem.js";
import {
  renderAnswer,
  renderPlainText,
  renderFallbackMessage,
  renderClarifyingQuestion,
  type SlackMessage,
  type ClarifyingOption,
} from "../slack/renderAnswer.js";
import {
  parseAnswerPayloadWithDetails,
  buildSources,
  validateCitations,
  type AnswerPayload,
} from "../types/answer.js";
import type { RetrievalResult, SlackContext, ConfidenceLevel, ConversationHistory } from "../types/index.js";
import { formatConversationContext } from "../slack/threadHistory.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/** Maximum retries for JSON parsing failures */
const MAX_PARSE_RETRIES = 1;

export interface GenerateResult {
  requestId: string;
  slackMessage: SlackMessage;
  payload: AnswerPayload | null;
  isConfident: boolean;
  confidence: ConfidenceLevel;
  chunkIds: string[];
  avgSimilarity: number;
  latencyMs: number;
}

export async function generateAnswer(
  question: string,
  retrieval: RetrievalResult,
  userId: string,
  slackContext: Partial<SlackContext>,
  conversationHistory?: ConversationHistory
): Promise<GenerateResult> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = createRequestLogger(requestId, "synthesize");
  const startTime = Date.now();

  const chunkIds = retrieval.chunks.map((c) => c.chunkId);

  log.info("Starting answer generation", {
    userId,
    questionPreview: question.slice(0, 100),
    chunkCount: retrieval.chunks.length,
    avgSimilarity: retrieval.avgSimilarity.toFixed(3),
    isConfident: retrieval.isConfident,
    isFollowUp: conversationHistory?.isFollowUp ?? false,
    historyLength: conversationHistory?.messages.length ?? 0,
    ...slackContext,
  });

  // Handle low-confidence retrieval
  if (!retrieval.isConfident) {
    const latencyMs = Date.now() - startTime;

    // Try to generate clarifying options from the chunks we have
    const clarifyingOptions = generateClarifyingOptions(question, retrieval);

    if (clarifyingOptions.length > 0) {
      // We found potential topics - ask user to clarify
      const introText = "I found a few different topics this might relate to. Which one are you asking about?";

      log.info("Returning clarifying question", {
        latencyMs,
        optionCount: clarifyingOptions.length,
        chunkCount: retrieval.chunks.length,
      });

      const clarifyPayload = {
        summary: "Clarifying question presented to user",
        bullets: [],
        sources: [],
        confidence: "low" as const,
      };

      await logQA({
        requestId,
        question,
        payload: clarifyPayload,
        chunkIds,
        confidence: "low",
        latencyMs,
        slackContext,
      });

      return {
        requestId,
        slackMessage: renderClarifyingQuestion(introText, clarifyingOptions, requestId),
        payload: clarifyPayload,
        isConfident: false,
        confidence: "low",
        chunkIds,
        avgSimilarity: retrieval.avgSimilarity,
        latencyMs,
      };
    }

    // No clarifying options - return standard fallback
    const fallbackText = missingContextFallback(requestId);
    const fallbackPayload = {
      summary: "I don't see this answered in the current docs or code I have indexed.",
      bullets: [],
      sources: [],
      confidence: "low" as const,
    };

    await logQA({
      requestId,
      question,
      payload: fallbackPayload,
      chunkIds,
      confidence: "low",
      latencyMs,
      slackContext,
    });

    log.info("Returned fallback response (no confident context)", {
      latencyMs,
      chunkCount: retrieval.chunks.length,
      avgSimilarity: retrieval.avgSimilarity.toFixed(3),
    });

    return {
      requestId,
      slackMessage: renderFallbackMessage(fallbackText),
      payload: fallbackPayload,
      isConfident: false,
      confidence: "low",
      chunkIds,
      avgSimilarity: retrieval.avgSimilarity,
      latencyMs,
    };
  }

  // Build context with source attribution
  const sources = buildSources(retrieval.chunks);
  const context = retrieval.chunks
    .map((c, i) => {
      const source = c.metadata.source || "unknown";
      return `[#${i + 1}] ${source}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  // Include conversation history for follow-up questions
  const conversationContext = conversationHistory
    ? formatConversationContext(conversationHistory)
    : "";

  const userMessage = conversationContext
    ? `${conversationContext}

QUESTION:
${question}

CONTEXT (use as the only source of truth):
${context}`
    : `QUESTION:
${question}

CONTEXT (use as the only source of truth):
${context}`;

  // Request structured JSON output with retry on parse failure
  let payload: AnswerPayload | null = null;
  let rawAnswer = "";
  let parseAttempts = 0;

  while (!payload && parseAttempts <= MAX_PARSE_RETRIES) {
    parseAttempts++;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: LIGHTOPEDIA_SYSTEM_PROMPT },
        { role: "system", content: JSON_OUTPUT_PROMPT },
        { role: "system", content: RUNTIME_DIRECTIVES },
        { role: "user", content: userMessage },
      ],
      temperature: parseAttempts === 1 ? 0.3 : 0.2, // Lower temp on retry
      max_tokens: 1000,
    });

    rawAnswer = response.choices[0]?.message?.content || "";
    const parseResult = parseAnswerPayloadWithDetails(rawAnswer);

    if (parseResult.success && parseResult.payload) {
      payload = parseResult.payload;
    } else if (parseAttempts <= MAX_PARSE_RETRIES) {
      log.warn("JSON parse failed, retrying", {
        attempt: parseAttempts,
        error: parseResult.error,
        rawLength: rawAnswer.length,
      });
    }
  }

  const latencyMs = Date.now() - startTime;
  let slackMessage: SlackMessage;

  if (payload) {
    // Enrich sources with proper data from retrieval
    payload = {
      ...payload,
      sources: sources.map((s, i) => ({
        ...s,
        id: i + 1,
      })),
    };

    // Validate citations
    const citationCheck = validateCitations(payload);

    // HARD CITATION GATE: If no bullets have citations, reject the answer entirely
    // This ensures we never return ungrounded answers
    const totalCitations = payload.bullets.reduce((sum, b) => sum + b.citations.length, 0);
    if (totalCitations === 0 && payload.bullets.length > 0) {
      log.warn("Citation gate triggered - no citations found, returning fallback", {
        bulletCount: payload.bullets.length,
        latencyMs,
      });

      const fallbackText = missingContextFallback(requestId);
      const fallbackPayload = {
        summary: "I couldn't ground this answer in the available sources.",
        bullets: [],
        sources: [],
        confidence: "low" as const,
      };

      await logQA({
        requestId,
        question,
        payload: fallbackPayload,
        chunkIds,
        confidence: "low",
        latencyMs,
        slackContext,
      });

      return {
        requestId,
        slackMessage: renderFallbackMessage(fallbackText),
        payload: fallbackPayload,
        isConfident: false,
        confidence: "low",
        chunkIds,
        avgSimilarity: retrieval.avgSimilarity,
        latencyMs,
      };
    }

    // Downgrade confidence for partially uncited answers
    if (!citationCheck.isValid && payload.confidence === "high") {
      log.warn("Downgrading confidence due to uncited bullets", {
        uncitedCount: citationCheck.uncitedCount,
      });
      payload.confidence = "medium";
    }

    // Apply composite confidence scoring
    payload.confidence = calculateCompositeConfidence(
      payload.confidence,
      retrieval.avgSimilarity,
      sources.length,
      citationCheck.isValid
    );

    slackMessage = renderAnswer(payload, requestId);
    log.info("Generated structured answer", {
      latencyMs,
      confidence: payload.confidence,
      bulletCount: payload.bullets.length,
      totalCitations,
      parseAttempts,
    });
  } else {
    // Fallback to plain text if JSON parsing fails after retries
    log.warn("Failed to parse structured output after retries, using plain text fallback", {
      rawLength: rawAnswer.length,
      parseAttempts,
    });

    slackMessage = renderPlainText(rawAnswer, requestId, sources);
    payload = {
      summary: rawAnswer.slice(0, 200),
      bullets: [],
      sources,
      confidence: calculateCompositeConfidence("medium", retrieval.avgSimilarity, sources.length, false),
    };
  }

  const confidence = payload.confidence;

  await logQA({
    requestId,
    question,
    payload,
    chunkIds,
    confidence,
    latencyMs,
    slackContext,
  });

  return {
    requestId,
    slackMessage,
    payload,
    isConfident: confidence !== "low",
    confidence,
    chunkIds,
    avgSimilarity: retrieval.avgSimilarity,
    latencyMs,
  };
}

interface LogQAParams {
  requestId: string;
  question: string;
  payload: AnswerPayload;
  chunkIds: string[];
  confidence: ConfidenceLevel;
  latencyMs: number;
  slackContext: Partial<SlackContext>;
}

async function logQA(params: LogQAParams): Promise<void> {
  try {
    await supabase.from("qa_logs").insert({
      slack_team_id: params.slackContext.teamId,
      slack_channel_id: params.slackContext.channelId,
      slack_thread_ts: params.slackContext.threadTs,
      question: params.question,
      answer: JSON.stringify(params.payload),
      citations: params.chunkIds,
      confidence: params.confidence,
      latency_ms: params.latencyMs,
    });
  } catch (err) {
    logger.error("Failed to log QA", { stage: "synthesize", requestId: params.requestId, error: err });
  }
}

// ============================================
// Helper Functions
// ============================================


/** Calculate composite confidence from multiple signals */
function calculateCompositeConfidence(
  modelConfidence: ConfidenceLevel,
  avgSimilarity: number,
  sourceCount: number,
  allCited: boolean
): ConfidenceLevel {
  // Model says low → always low
  if (modelConfidence === "low") {
    return "low";
  }

  // Strong retrieval + good citations + model confident → high
  if (
    modelConfidence === "high" &&
    avgSimilarity >= 0.55 &&
    sourceCount >= 2 &&
    allCited
  ) {
    return "high";
  }

  // Model says high but weak signals → downgrade to medium
  if (modelConfidence === "high") {
    if (avgSimilarity < 0.5 || sourceCount < 2 || !allCited) {
      return "medium";
    }
  }

  // Model says medium → keep medium unless very strong signals
  if (modelConfidence === "medium") {
    // Could upgrade to high if retrieval is very strong
    if (avgSimilarity >= 0.7 && sourceCount >= 3 && allCited) {
      return "high";
    }
    return "medium";
  }

  return modelConfidence;
}

/**
 * Generate clarifying options from retrieval results.
 * Analyzes the chunks to find distinct topics/areas that the question might relate to.
 * Returns empty array if no meaningful options can be generated.
 */
function generateClarifyingOptions(
  question: string,
  retrieval: RetrievalResult
): ClarifyingOption[] {
  // Need at least 2 chunks with different sources to generate options
  if (retrieval.chunks.length < 2) {
    return [];
  }

  // Group chunks by their source area/module
  const topicGroups = new Map<string, { label: string; sources: Set<string>; count: number }>();

  for (const chunk of retrieval.chunks) {
    const source = chunk.metadata.source || "";

    // Extract meaningful topic from source path
    // e.g., "light-space/light/billing/Invoice.kt" -> "billing"
    // e.g., "light-space/light/accounting/ledger/Entry.kt" -> "accounting"
    const topic = extractTopicFromSource(source);
    if (!topic) continue;

    const existing = topicGroups.get(topic);
    if (existing) {
      existing.sources.add(source);
      existing.count++;
    } else {
      topicGroups.set(topic, {
        label: formatTopicLabel(topic),
        sources: new Set([source]),
        count: 1,
      });
    }
  }

  // Only generate options if we have multiple distinct topics
  if (topicGroups.size < 2) {
    return [];
  }

  // Sort by count and take top options
  const sortedTopics = Array.from(topicGroups.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 4);

  return sortedTopics.map(([topic, data]) => ({
    label: data.label,
    value: `${question} (specifically about ${topic})`,
  }));
}

/**
 * Extract a topic/module name from a source path.
 * Returns null if no meaningful topic can be extracted.
 */
function extractTopicFromSource(source: string): string | null {
  const parts = source.split("/");

  // Skip very short paths
  if (parts.length < 3) return null;

  // For code files, look for module/package names
  // Pattern: repo/project/module/submodule/file.ext
  // We want "module" or "module/submodule"

  // Skip first two parts (typically "org/repo" or "repo/project")
  const moduleParts = parts.slice(2, -1);

  if (moduleParts.length === 0) return null;

  // Return first meaningful directory
  const topic = moduleParts[0];

  // Skip generic directories
  const genericDirs = ["src", "main", "java", "kotlin", "ts", "js", "lib", "utils", "common", "shared"];
  if (!topic || genericDirs.includes(topic.toLowerCase())) {
    return moduleParts[1] || null;
  }

  return topic;
}

/**
 * Format a topic name into a readable label.
 */
function formatTopicLabel(topic: string): string {
  // Convert snake_case or kebab-case to Title Case
  return topic
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
