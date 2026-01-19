// ============================================
// LLM Synthesis — Generate answers from evidence
// ============================================

import { generateCompletion, parseJsonResponse, SYNTHESIS_MODEL } from "./client.js";
import { buildSynthesisPrompt, buildUserMessage } from "./prompts.js";
import { buildContextString } from "../evidence/buildEvidencePack.js";
import { logger } from "../lib/logger.js";
import type { DraftAnswer, EvidencePack, Citation, V3Answer } from "../evidence/types.js";
import type { Mode, RouteDecision } from "../router/types.js";
import { enforceForbiddenPhrases } from "../grounding/forbiddenPhrases.js";

/**
 * V3 Raw LLM response structure.
 */
interface LLMResponseV3 {
  shortAnswer: string;
  conceptualModel: string;
  howItWorks: string[];
  boundaries: {
    whatLightDoes: string[];
    whatLightDoesNot: string[];
  };
  salesSummary: string;
  citations: string[];
}

/**
 * Legacy LLM response structure (for fallback).
 */
interface LLMResponseLegacy {
  summary: string;
  claims: Array<{
    text: string;
    citations: string[];
  }>;
  internalNotes?: string;
  clarifyingQuestion?: string;
}

/**
 * Default empty V3 response.
 */
const EMPTY_RESPONSE_V3: LLMResponseV3 = {
  shortAnswer: "",
  conceptualModel: "",
  howItWorks: [],
  boundaries: { whatLightDoes: [], whatLightDoesNot: [] },
  salesSummary: "",
  citations: [],
};

/**
 * Synthesize an answer from evidence.
 *
 * The LLM's job is to EXPLAIN the retrieved evidence.
 * It does NOT search, it does NOT invent.
 */
export async function synthesizeAnswer(
  question: string,
  evidence: EvidencePack,
  route: RouteDecision,
  threadContext?: string
): Promise<DraftAnswer> {
  const mode = route.mode;

  logger.info("Starting synthesis", {
    stage: "synthesize",
    mode,
    codeCount: evidence.codeChunks.length,
    docCount: evidence.docs.length,
    slackCount: evidence.slackThreads.length,
  });

  // Build context from evidence
  const context = buildContextString(evidence);

  // Handle out-of-scope mode
  if (mode === "out_of_scope") {
    return {
      summary: "This question asks about implementation details that I don't have indexed yet.",
      claims: [],
      suggestedConfidence: "needs_clarification",
      internalNotes: "Out of scope for V1. Consider submitting to Linear.",
    };
  }

  // Handle clarify mode
  if (mode === "clarify") {
    return {
      summary: "I need a bit more context to help you with this.",
      claims: [],
      suggestedConfidence: "needs_clarification",
      internalNotes: route.missingInfo?.join(", "),
    };
  }

  // Handle no evidence
  if (evidence.codeChunks.length === 0 && evidence.docs.length === 0 && evidence.slackThreads.length === 0) {
    return {
      summary: "I couldn't find information about this in the codebase or docs I have indexed.",
      claims: [],
      suggestedConfidence: "needs_clarification",
    };
  }

  // Build prompts
  const systemPrompt = buildSynthesisPrompt(mode);
  const userMessage = buildUserMessage(question, context, threadContext);

  // Generate completion
  const rawResponse = await generateCompletion(systemPrompt, userMessage, {
    model: SYNTHESIS_MODEL,
    temperature: 0.3,
    maxTokens: 1000,
    jsonMode: true,
  });

  // Parse V3 response
  const parsed = parseJsonResponse<LLMResponseV3>(rawResponse, EMPTY_RESPONSE_V3);

  // Transform to DraftAnswer with V3 structure
  const draft = transformToDraftV3(parsed, evidence);

  logger.info("Synthesis complete", {
    stage: "synthesize",
    hasShortAnswer: !!draft.v3?.shortAnswer,
    hasBoundaries: (draft.v3?.boundaries.whatLightDoes.length ?? 0) > 0,
  });

  return draft;
}

/**
 * Transform V3 LLM response to DraftAnswer.
 */
function transformToDraftV3(
  response: LLMResponseV3,
  evidence: EvidencePack
): DraftAnswer {
  // Build V3 answer structure
  const rawV3Answer: V3Answer = {
    shortAnswer: response.shortAnswer || "",
    conceptualModel: response.conceptualModel || "",
    howItWorks: response.howItWorks || [],
    boundaries: {
      whatLightDoes: response.boundaries?.whatLightDoes || [],
      whatLightDoesNot: response.boundaries?.whatLightDoesNot || [],
    },
    salesSummary: response.salesSummary || "",
    citations: response.citations || [],
  };

  // Apply V3 guardrails - enforce forbidden phrases
  const v3Answer = enforceForbiddenPhrases(rawV3Answer);

  // Build legacy claims from V3 structure for backward compatibility
  const claims: Array<{ text: string; citations: Citation[] }> = [];

  // Add conceptual model as a claim if present
  if (v3Answer.conceptualModel) {
    claims.push({
      text: v3Answer.conceptualModel,
      citations: v3Answer.citations.map((ref) => resolveCitation(ref, evidence)),
    });
  }

  // Add howItWorks steps as claims
  for (const step of v3Answer.howItWorks) {
    claims.push({
      text: step,
      citations: v3Answer.citations.map((ref) => resolveCitation(ref, evidence)),
    });
  }

  return {
    summary: v3Answer.shortAnswer || "I found some relevant information.",
    claims,
    suggestedConfidence: v3Answer.shortAnswer ? "confirmed_docs" : "needs_clarification",
    v3: v3Answer,
  };
}

/**
 * Resolve a citation reference to a Citation object.
 */
function resolveCitation(ref: string, evidence: EvidencePack): Citation {
  // Try to parse as number (e.g., "1", "[1]", "#1")
  const numMatch = ref.match(/\[?#?(\d+)\]?/);
  if (numMatch) {
    const index = parseInt(numMatch[1]!, 10) - 1;

    // Check docs first
    if (index >= 0 && index < evidence.docs.length) {
      const doc = evidence.docs[index]!;
      return {
        type: "docs",
        ref: doc.id,
        label: doc.source,
      };
    }

    // Check Slack threads
    const slackIndex = index - evidence.docs.length;
    if (slackIndex >= 0 && slackIndex < evidence.slackThreads.length) {
      const thread = evidence.slackThreads[slackIndex]!;
      return {
        type: "docs", // Slack is also docs for V1
        ref: thread.id,
        label: `Slack: ${thread.topic.slice(0, 30)}`,
      };
    }
  }

  // Fallback to string ref
  return {
    type: "docs",
    ref,
    label: ref,
  };
}
