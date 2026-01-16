import OpenAI from "openai";
import crypto from "crypto";
import { config } from "../config/env.js";
import { logger, createRequestLogger } from "../lib/logger.js";
import { supabase } from "../db/supabase.js";
import {
  LIGHTOPEDIA_SYSTEM_PROMPT,
  JSON_OUTPUT_PROMPT,
  RUNTIME_DIRECTIVES,
  LOW_CONFIDENCE_MESSAGE,
} from "../prompts/lightopediaSystem.js";
import {
  renderAnswer,
  renderLowConfidenceResponse,
  renderPlainText,
  type SlackMessage,
} from "../slack/renderAnswer.js";
import { parseAnswerPayload, buildSources, type AnswerPayload } from "../types/answer.js";
import type { RetrievalResult, SlackContext, ConfidenceLevel, ConversationHistory } from "../types/index.js";
import { formatConversationContext } from "../slack/threadHistory.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

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

    await logQA({
      requestId,
      question,
      payload: LOW_CONFIDENCE_MESSAGE,
      chunkIds,
      confidence: "low",
      latencyMs,
      slackContext,
    });

    log.info("Returned low-confidence response", { latencyMs });

    return {
      requestId,
      slackMessage: renderLowConfidenceResponse(requestId),
      payload: LOW_CONFIDENCE_MESSAGE,
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

  // Request structured JSON output
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: LIGHTOPEDIA_SYSTEM_PROMPT },
      { role: "system", content: JSON_OUTPUT_PROMPT },
      { role: "system", content: RUNTIME_DIRECTIVES },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 1000,
  });

  const rawAnswer = response.choices[0]?.message?.content || "";
  const latencyMs = Date.now() - startTime;

  // Parse structured output
  let payload = parseAnswerPayload(rawAnswer);
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

    slackMessage = renderAnswer(payload, requestId);
    log.info("Generated structured answer", {
      latencyMs,
      confidence: payload.confidence,
      bulletCount: payload.bullets.length,
    });
  } else {
    // Fallback to plain text if JSON parsing fails
    log.warn("Failed to parse structured output, using plain text fallback", {
      rawLength: rawAnswer.length,
    });

    slackMessage = renderPlainText(rawAnswer, requestId, sources);
    payload = {
      summary: rawAnswer.slice(0, 200),
      bullets: [],
      sources,
      confidence: retrieval.avgSimilarity >= 0.6 ? "high" : "medium",
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
