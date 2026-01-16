import OpenAI from "openai";
import { RetrievalResult, formatSources } from "../retrieval/retrieve.js";
import { supabase } from "../db/supabase.js";
import { LIGHTOPEDIA_SYSTEM_PROMPT, RUNTIME_DIRECTIVES } from "../prompts/lightopediaSystem.js";
import crypto from "crypto";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LOW_CONFIDENCE_RESPONSE = `I don't see this covered in the current docs or code.

If this is something you think Light should support, the best next step is to submit a **Feature Request** so the Product team can review it.

**How to submit a feature request:**
1. Hover over this message
2. Click **"…" → "Create Issue in Linear"**
3. Select **Product Team** (not Product Delivery Team)
4. Choose the **Feature Request** template

Feature requests are reviewed by the Product team during regular triage (10am and 2pm UK time).`;

export interface AnswerResult {
  requestId: string;
  answer: string;
  isConfident: boolean;
  chunkIds: string[];
  avgSimilarity: number;
  latencyMs: number;
}

export async function generateAnswer(
  question: string,
  retrieval: RetrievalResult,
  userId: string,
  slackContext: { teamId?: string; channelId?: string; threadTs?: string }
): Promise<AnswerResult> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  const chunkIds = retrieval.chunks.map((c) => c.chunk_id);

  // Log the request
  console.log(
    JSON.stringify({
      event: "question",
      requestId,
      userId,
      question: question.slice(0, 100),
      chunkCount: retrieval.chunks.length,
      avgSimilarity: retrieval.avgSimilarity.toFixed(3),
      isConfident: retrieval.isConfident,
      ...slackContext,
    })
  );

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

    return {
      requestId,
      answer: `${LOW_CONFIDENCE_RESPONSE}\n\n_Request ID: ${requestId}_`,
      isConfident: false,
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

  // Build user message with proper structure
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

  await logQA({
    requestId,
    question,
    answer: rawAnswer,
    chunkIds,
    confidence: "high",
    latencyMs,
    slackContext,
  });

  console.log(
    JSON.stringify({
      event: "answer",
      requestId,
      latencyMs,
      answerLength: rawAnswer.length,
    })
  );

  return {
    requestId,
    answer,
    isConfident: true,
    chunkIds,
    avgSimilarity: retrieval.avgSimilarity,
    latencyMs,
  };
}

async function logQA(params: {
  requestId: string;
  question: string;
  answer: string;
  chunkIds: string[];
  confidence: string;
  latencyMs: number;
  slackContext: { teamId?: string; channelId?: string; threadTs?: string };
}) {
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
    console.error("Failed to log QA:", err);
  }
}
