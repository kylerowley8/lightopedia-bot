// ============================================
// LLM Synthesis — Generate answers from evidence
// ============================================

import { generateCompletion, parseJsonResponse, SYNTHESIS_MODEL } from "./client.js";
import { buildSynthesisPrompt, buildUserMessage } from "./prompts.js";
import { buildContextString } from "../evidence/buildEvidencePack.js";
import { logger } from "../lib/logger.js";
import type { DraftAnswer, EvidencePack, Citation } from "../evidence/types.js";
import type { Mode, RouteDecision } from "../router/types.js";

/**
 * Raw LLM response structure.
 */
interface LLMResponse {
  summary: string;
  claims: Array<{
    text: string;
    citations: string[];
  }>;
  internalNotes?: string;
  clarifyingQuestion?: string;
}

/**
 * Default empty response.
 */
const EMPTY_RESPONSE: LLMResponse = {
  summary: "",
  claims: [],
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
  if (evidence.docs.length === 0 && evidence.slackThreads.length === 0) {
    return {
      summary: "I couldn't find information about this in the docs I have indexed.",
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
    maxTokens: 800,
    jsonMode: true,
  });

  // Parse response
  const parsed = parseJsonResponse<LLMResponse>(rawResponse, EMPTY_RESPONSE);

  // Transform to DraftAnswer
  const draft = transformToDraft(parsed, evidence);

  logger.info("Synthesis complete", {
    stage: "synthesize",
    claimCount: draft.claims.length,
    hasSummary: !!draft.summary,
  });

  return draft;
}

/**
 * Transform LLM response to DraftAnswer.
 */
function transformToDraft(
  response: LLMResponse,
  evidence: EvidencePack
): DraftAnswer {
  const claims = response.claims.map((claim) => ({
    text: claim.text,
    citations: claim.citations.map((ref) => resolveCitation(ref, evidence)),
  }));

  return {
    summary: response.summary || "I found some relevant information.",
    claims,
    suggestedConfidence: claims.length > 0 ? "confirmed_docs" : "needs_clarification",
    internalNotes: response.internalNotes,
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
