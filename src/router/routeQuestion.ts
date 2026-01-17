// ============================================
// Router — Policy selector (never answers questions)
// ============================================

import {
  type Mode,
  type RouteDecision,
  type RouterInput,
  DEFAULT_MODE,
} from "./types.js";
import {
  classifyWithHeuristics,
  extractQueryHints,
  detectPronouns,
  isAmbiguous,
} from "./heuristics.js";
import { classifyWithLLM } from "../llm/routerLLM.js";
import { logger } from "../lib/logger.js";

/**
 * Route a question to the appropriate retrieval mode.
 *
 * The router is a POLICY SELECTOR:
 * - It chooses which deterministic program to run
 * - It NEVER answers questions
 * - It NEVER reads code
 */
export async function routeQuestion(input: RouterInput): Promise<RouteDecision> {
  const { question, threadHistory, attachmentHints } = input;
  const hasThreadHistory = (threadHistory?.length ?? 0) > 0;

  logger.info("Routing question", {
    stage: "router",
    questionPreview: question.slice(0, 80),
    hasThreadHistory,
    hasAttachments: (attachmentHints?.length ?? 0) > 0,
  });

  // Step 1: Try heuristic classification first
  const heuristicResult = classifyWithHeuristics(question, hasThreadHistory);

  if (heuristicResult && heuristicResult.confidence >= 0.7) {
    logger.info("Heuristic classification succeeded", {
      stage: "router",
      mode: heuristicResult.mode,
      confidence: heuristicResult.confidence.toFixed(2),
      patterns: heuristicResult.matchedPatterns,
    });

    return buildRouteDecision(
      heuristicResult.mode,
      heuristicResult.confidence >= 0.85 ? "high" : "medium",
      question,
      threadHistory
    );
  }

  // Step 2: Heuristics insufficient — check for obvious ambiguity
  if (isAmbiguous(question)) {
    logger.info("Question is ambiguous, requesting clarification", {
      stage: "router",
      question: question.slice(0, 80),
    });

    return {
      mode: "clarify",
      confidence: "high",
      queryHints: extractQueryHints(question),
      missingInfo: ["Please provide more context about what you're trying to do."],
    };
  }

  // Step 3: Use LLM for classification
  try {
    const llmResult = await classifyWithLLM(question, threadHistory);

    logger.info("LLM classification result", {
      stage: "router",
      mode: llmResult.mode,
      confidence: llmResult.confidence,
    });

    return buildRouteDecision(
      llmResult.mode,
      llmResult.confidence,
      question,
      threadHistory
    );
  } catch (err) {
    logger.error("LLM classification failed, using default", {
      stage: "router",
      error: err,
    });

    // Fallback to default mode
    return buildRouteDecision(DEFAULT_MODE, "low", question, threadHistory);
  }
}

/**
 * Build a complete RouteDecision with query hints and context.
 */
function buildRouteDecision(
  mode: Mode,
  confidence: "high" | "medium" | "low",
  question: string,
  threadHistory?: RouterInput["threadHistory"]
): RouteDecision {
  const queryHints = extractQueryHints(question);
  const pronouns = detectPronouns(question);

  const decision: RouteDecision = {
    mode,
    confidence,
    queryHints,
  };

  // Add follow-up context if needed
  if (mode === "followup" && threadHistory && threadHistory.length > 0) {
    const lastAssistantMessage = threadHistory
      .filter((m) => m.role === "assistant")
      .pop();

    decision.followupContext = {
      previousTopic: extractTopicFromMessage(lastAssistantMessage?.content ?? ""),
      resolvedPronouns: resolvePronouns(pronouns, threadHistory),
    };
  }

  // Add clarification info if needed
  if (mode === "clarify") {
    decision.missingInfo = generateClarificationNeeds(question);
  }

  return decision;
}

/**
 * Extract the main topic from a previous message.
 */
function extractTopicFromMessage(content: string): string {
  // Simple extraction: take first sentence or first 100 chars
  const firstSentence = content.match(/^[^.!?]+[.!?]/);
  if (firstSentence) {
    return firstSentence[0].slice(0, 100);
  }
  return content.slice(0, 100);
}

/**
 * Resolve pronouns using thread history.
 */
function resolvePronouns(
  pronouns: string[],
  threadHistory: RouterInput["threadHistory"]
): Record<string, string> {
  const resolved: Record<string, string> = {};

  if (!threadHistory || threadHistory.length === 0 || pronouns.length === 0) {
    return resolved;
  }

  // Look for noun phrases in recent messages
  const recentContent = threadHistory
    .slice(-4)
    .map((m) => m.content)
    .join(" ");

  // Extract capitalized terms (likely entities)
  const entities = recentContent.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  const uniqueEntities = [...new Set(entities)].slice(0, 3);

  // Simple heuristic: map "it/this/that" to most recent entity
  if (uniqueEntities.length > 0) {
    for (const pronoun of pronouns) {
      if (pronoun === "it" || pronoun === "this" || pronoun === "that") {
        resolved[pronoun] = uniqueEntities[0]!;
      }
    }
  }

  return resolved;
}

/**
 * Generate clarification needs for ambiguous questions.
 */
function generateClarificationNeeds(question: string): string[] {
  const needs: string[] = [];
  const normalizedQuestion = question.toLowerCase();

  // Generic clarifications based on question patterns
  if (question.length < 20) {
    needs.push("Could you provide more details about your question?");
  }

  if (!normalizedQuestion.includes("light")) {
    needs.push("Are you asking about a specific Light feature or workflow?");
  }

  if (normalizedQuestion.includes("or")) {
    needs.push("Which option are you specifically asking about?");
  }

  // Default clarification
  if (needs.length === 0) {
    needs.push("Could you clarify what aspect of Light you're asking about?");
  }

  return needs;
}
