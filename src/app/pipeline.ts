// ============================================
// Pipeline — Single orchestration flow
// ============================================

import crypto from "crypto";
import { routeQuestion } from "../router/routeQuestion.js";
import { buildEvidencePack, hasEvidence } from "../evidence/buildEvidencePack.js";
import { synthesizeAnswer } from "../llm/synthesize.js";
import { applyCitationGate, buildCitationFooter } from "../grounding/citationGate.js";
import { logger } from "../lib/logger.js";
import type { RouterInput, ThreadMessage } from "../router/types.js";
import type { SlackInput, PipelineResult, PipelineContext } from "./types.js";
import type { GroundedAnswer } from "../evidence/types.js";
import { getMissingContextMessage, getOutOfScopeMessage } from "../llm/prompts.js";

/**
 * Pipeline configuration.
 */
export const PIPELINE_VERSION = "pipeline.v1.0";

/**
 * Execute the full pipeline for a question.
 *
 * Flow:
 * 1. Preprocess (thread + attachments)
 * 2. Route (policy selection)
 * 3. Retrieve (docs-first)
 * 4. Synthesize (LLM explains evidence)
 * 5. Ground (citation gate)
 * 6. Return result for rendering
 */
export async function executePipeline(
  input: SlackInput,
  threadHistory: ThreadMessage[]
): Promise<PipelineResult> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  const context: PipelineContext = {
    input,
    requestId,
    threadHistory: threadHistory.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    attachmentHints: [],
    startTime,
  };

  logger.info("Pipeline started", {
    stage: "pipeline",
    requestId,
    question: input.text.slice(0, 80),
    hasThread: threadHistory.length > 0,
    hasFiles: (input.files?.length ?? 0) > 0,
  });

  // Step 1: Build router input
  const routerInput: RouterInput = {
    question: input.text,
    threadHistory: context.threadHistory,
    attachmentHints: context.attachmentHints,
    channelType: input.channelType,
  };

  // Step 2: Route
  const route = await routeQuestion(routerInput);

  logger.info("Routing complete", {
    stage: "pipeline",
    requestId,
    mode: route.mode,
    confidence: route.confidence,
  });

  // Step 3: Handle special modes early
  if (route.mode === "out_of_scope") {
    return buildFallbackResult(
      requestId,
      startTime,
      route,
      getOutOfScopeMessage(requestId)
    );
  }

  if (route.mode === "clarify") {
    return buildClarifyResult(
      requestId,
      startTime,
      route
    );
  }

  // Step 4: Retrieve evidence
  const evidence = await buildEvidencePack(input.text, route, input.files);

  logger.info("Evidence retrieved", {
    stage: "pipeline",
    requestId,
    docCount: evidence.docs.length,
    slackCount: evidence.slackThreads.length,
  });

  // Step 5: Handle no evidence
  if (!hasEvidence(evidence)) {
    return buildFallbackResult(
      requestId,
      startTime,
      route,
      getMissingContextMessage(requestId)
    );
  }

  // Step 6: Synthesize
  const threadContext = formatThreadContext(context.threadHistory);
  const draft = await synthesizeAnswer(input.text, evidence, route, threadContext);

  // Step 7: Apply citation gate
  const gateResult = applyCitationGate(draft, evidence);

  if (!gateResult.passed) {
    logger.warn("Citation gate failed", {
      stage: "pipeline",
      requestId,
      reason: gateResult.reason,
      droppedClaims: gateResult.droppedClaims.length,
    });

    return buildFallbackResult(
      requestId,
      startTime,
      route,
      getMissingContextMessage(requestId)
    );
  }

  const latencyMs = Date.now() - startTime;

  logger.info("Pipeline complete", {
    stage: "pipeline",
    requestId,
    latencyMs,
    mode: route.mode,
    confidence: gateResult.answer.confidence,
    claimCount: gateResult.answer.claims.length,
  });

  return {
    route,
    evidence,
    answer: gateResult.answer,
    metadata: {
      requestId,
      latencyMs,
      mode: route.mode,
    },
  };
}

/**
 * Build a fallback result for missing context or errors.
 */
function buildFallbackResult(
  requestId: string,
  startTime: number,
  route: ReturnType<typeof routeQuestion> extends Promise<infer R> ? R : never,
  message: string
): PipelineResult {
  const answer: GroundedAnswer = {
    summary: message,
    claims: [],
    confidence: "needs_clarification",
    hasAmbiguity: false,
  };

  return {
    route,
    evidence: {
      codeChunks: [],
      docs: [],
      slackThreads: [],
      retrievalMeta: {
        version: PIPELINE_VERSION,
        indexRunId: "none",
        totalSearched: 0,
        queriesUsed: [],
      },
    },
    answer,
    metadata: {
      requestId,
      latencyMs: Date.now() - startTime,
      mode: route.mode,
    },
  };
}

/**
 * Build a clarification result.
 */
function buildClarifyResult(
  requestId: string,
  startTime: number,
  route: ReturnType<typeof routeQuestion> extends Promise<infer R> ? R : never
): PipelineResult {
  const clarifyingQuestion = route.missingInfo?.[0] ??
    "Could you provide more context about what you're trying to do?";

  const answer: GroundedAnswer = {
    summary: clarifyingQuestion,
    claims: [],
    confidence: "needs_clarification",
    hasAmbiguity: false,
  };

  return {
    route,
    evidence: {
      codeChunks: [],
      docs: [],
      slackThreads: [],
      retrievalMeta: {
        version: PIPELINE_VERSION,
        indexRunId: "none",
        totalSearched: 0,
        queriesUsed: [],
      },
    },
    answer,
    metadata: {
      requestId,
      latencyMs: Date.now() - startTime,
      mode: route.mode,
    },
  };
}

/**
 * Format thread history for synthesis context.
 */
function formatThreadContext(history: PipelineContext["threadHistory"]): string | undefined {
  if (history.length === 0) {
    return undefined;
  }

  return history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n\n");
}
