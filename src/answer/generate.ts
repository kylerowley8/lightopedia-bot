import OpenAI from "openai";
import crypto from "crypto";
import { config } from "../config/env.js";
import { logger, createRequestLogger } from "../lib/logger.js";
import { supabase } from "../db/supabase.js";
import {
  LIGHTOPEDIA_SYSTEM_PROMPT,
  JSON_OUTPUT_PROMPT,
  RUNTIME_DIRECTIVES,
  getLowConfidenceMessage,
  type LowConfidenceReason,
} from "../prompts/lightopediaSystem.js";
import {
  renderAnswer,
  renderLowConfidenceResponse,
  renderPlainText,
  type SlackMessage,
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

  // Handle low-confidence retrieval with context-specific messages
  if (!retrieval.isConfident) {
    const latencyMs = Date.now() - startTime;

    // Determine reason for low confidence
    const reason = determineLowConfidenceReason(retrieval);
    const lowConfMessage = getLowConfidenceMessage(reason);

    await logQA({
      requestId,
      question,
      payload: lowConfMessage,
      chunkIds,
      confidence: "low",
      latencyMs,
      slackContext,
    });

    log.info("Returned low-confidence response", { latencyMs, reason });

    return {
      requestId,
      slackMessage: renderLowConfidenceResponse(requestId, lowConfMessage),
      payload: lowConfMessage,
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

    // Validate citations and adjust confidence if needed
    const citationCheck = validateCitations(payload);
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

/** Determine why retrieval confidence is low */
function determineLowConfidenceReason(retrieval: RetrievalResult): LowConfidenceReason {
  // No chunks found at all
  if (retrieval.chunks.length === 0) {
    return "no_results";
  }

  // Chunks found but very low similarity
  if (retrieval.avgSimilarity < 0.45) {
    return "low_similarity";
  }

  // Check for low relevance after reranking (if available)
  const firstChunk = retrieval.chunks[0];
  if (firstChunk && "relevanceScore" in firstChunk) {
    const avgRelevance =
      retrieval.chunks.reduce((sum, c) => sum + ((c as { relevanceScore?: number }).relevanceScore ?? 5), 0) /
      retrieval.chunks.length;
    if (avgRelevance < 4) {
      return "low_relevance";
    }
  }

  // Default to low similarity if we can't determine specific reason
  return "low_similarity";
}

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
