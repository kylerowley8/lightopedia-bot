import OpenAI from "openai";
import crypto from "crypto";
import { config } from "../config/env.js";
import { logger, createRequestLogger } from "../lib/logger.js";
import { supabase } from "../db/supabase.js";
import { LIGHTOPEDIA_SYSTEM_PROMPT, RUNTIME_DIRECTIVES } from "../prompts/lightopediaSystem.js";
import { formatSources } from "../retrieval/retrieve.js";
import type { RetrievalResult, SlackContext, AnswerResult, ConfidenceLevel } from "../types/index.js";

// Re-export for backward compatibility
export type { AnswerResult };

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const LOW_CONFIDENCE_RESPONSE = `I don't see this covered in the current docs or code.

If this is something you think Light should support, the best next step is to submit a **Feature Request** so the Product team can review it.

**How to submit a feature request:**
1. Hover over this message
2. Click **"…" → "Create Issue in Linear"**
3. Select **Product Team** (not Product Delivery Team)
4. Choose the **Feature Request** template

Feature requests are reviewed by the Product team during regular triage (10am and 2pm UK time).`;

export async function generateAnswer(
  question: string,
  retrieval: RetrievalResult,
  userId: string,
  slackContext: Partial<SlackContext>
): Promise<AnswerResult> {
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
    ...slackContext,
  });

  if (!retrieval.isConfident) {
    const latencyMs = Date.now() - startTime;

    await logQA({
      requestId,
      question,
      answer: LOW_CONFIDENCE_RESPONSE,
      chunkIds,
      confidence: "low",
      latencyMs,
      slackContext,
    });

    log.info("Returned low-confidence response", { latencyMs });

    return {
      requestId,
      answer: `${LOW_CONFIDENCE_RESPONSE}\n\n_Request ID: ${requestId}_`,
      isConfident: false,
      confidence: "low",
      chunkIds,
      avgSimilarity: retrieval.avgSimilarity,
      latencyMs,
    };
  }

  // Build context with source attribution
  const context = retrieval.chunks
    .map((c, i) => {
      const source = c.metadata.source || "unknown";
      return `[#${i + 1}] ${source}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  const userMessage = `QUESTION:
${question}

CONTEXT (use as the only source of truth):
${context}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: LIGHTOPEDIA_SYSTEM_PROMPT },
      { role: "system", content: RUNTIME_DIRECTIVES },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 1000,
  });

  const rawAnswer = response.choices[0]?.message?.content || "Unable to generate answer.";
  const sources = formatSources(retrieval.chunks);
  const answer = `${rawAnswer}${sources}\n\n_Request ID: ${requestId}_`;

  const latencyMs = Date.now() - startTime;
  const confidence: ConfidenceLevel = retrieval.avgSimilarity >= 0.6 ? "high" : "medium";

  await logQA({
    requestId,
    question,
    answer: rawAnswer,
    chunkIds,
    confidence,
    latencyMs,
    slackContext,
  });

  log.info("Answer generated", {
    latencyMs,
    answerLength: rawAnswer.length,
    confidence,
  });

  return {
    requestId,
    answer,
    isConfident: true,
    confidence,
    chunkIds,
    avgSimilarity: retrieval.avgSimilarity,
    latencyMs,
  };
}

interface LogQAParams {
  requestId: string;
  question: string;
  answer: string;
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
      answer: params.answer,
      citations: params.chunkIds,
      confidence: params.confidence,
      latency_ms: params.latencyMs,
    });
  } catch (err) {
    logger.error("Failed to log QA", { stage: "synthesize", requestId: params.requestId, error: err });
  }
}
