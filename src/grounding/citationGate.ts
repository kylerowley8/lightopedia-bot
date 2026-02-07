// ============================================
// Citation Gate — Validates inline citations in answers
//
// Checks that [[n]](path) references in the answer
// correspond to articles that were actually fetched.
// ============================================

import { logger } from "../lib/logger.js";
import type {
  DraftAnswer,
  GroundedAnswer,
  CitationGateResult,
  EvidencePack,
  ConfidenceLevel,
} from "../evidence/types.js";

// ============================================
// Inline Citation Validation (for agentic pipeline)
// ============================================

/**
 * Result of inline citation validation.
 */
export interface InlineCitationResult {
  /** Whether all citations reference valid (fetched) articles */
  isValid: boolean;
  /** Paths that were cited but not in the fetched set */
  invalidPaths: string[];
  /** All unique cited paths */
  citedPaths: string[];
}

/**
 * Validate inline citations in the answer text.
 * Citations must be in format [[n]](article-path).
 * Each path must exist in the set of fetched article paths.
 */
export function validateInlineCitations(
  text: string,
  fetchedPaths: Set<string>
): InlineCitationResult {
  // Match [[n]](path) pattern
  const citationRegex = /\[\[\d+\]\]\(([^)]+)\)/g;
  const citedPaths: string[] = [];
  const invalidPaths: string[] = [];

  let match;
  while ((match = citationRegex.exec(text)) !== null) {
    const path = match[1]!;
    if (!citedPaths.includes(path)) {
      citedPaths.push(path);
    }
    if (!fetchedPaths.has(path) && !invalidPaths.includes(path)) {
      invalidPaths.push(path);
    }
  }

  const isValid = invalidPaths.length === 0;

  if (!isValid) {
    logger.warn("Invalid inline citations found", {
      stage: "grounding",
      invalidPaths,
      citedPaths,
      fetchedPaths: [...fetchedPaths],
    });
  } else if (citedPaths.length > 0) {
    logger.info("Inline citations validated", {
      stage: "grounding",
      citedPaths,
    });
  }

  return { isValid, invalidPaths, citedPaths };
}

// ============================================
// Legacy Citation Gate (kept for backward compat)
// ============================================

/**
 * Apply the citation gate to a draft answer.
 *
 * Checks that functional claims are backed by article evidence.
 * - If functional language found AND articles exist → pass with "confirmed"
 * - If functional language found AND no articles → fail
 * - If no functional claims → pass (explanatory only)
 */
export function applyCitationGate(
  draft: DraftAnswer,
  evidence: EvidencePack
): CitationGateResult {
  const textToCheck = [draft.summary, draft.detailedAnswer ?? ""].join(" ");
  const hasFunctionalLanguage = containsFunctionalLanguage(textToCheck);
  const hasArticles = evidence.articles.length > 0;

  if (hasFunctionalLanguage && !hasArticles) {
    logger.warn("Citation gate FAILED - functional claims without article evidence", {
      stage: "grounding",
    });

    return {
      passed: false,
      reason: "Answer contains functional claims but no article evidence was found.",
      droppedClaims: [],
    };
  }

  const confidence = determineConfidence(evidence);

  const answer: GroundedAnswer = {
    summary: draft.summary,
    detailedAnswer: draft.detailedAnswer,
    confidence,
    hasAmbiguity: false,
    internalNotes: draft.internalNotes,
  };

  logger.info("Citation gate PASSED", {
    stage: "grounding",
    hasFunctionalLanguage,
    articleCount: evidence.articles.length,
    confidence,
  });

  return {
    passed: true,
    answer,
  };
}

/**
 * Check if text contains functional language.
 */
function containsFunctionalLanguage(text: string): boolean {
  const functionalPatterns = [
    /\b(does|do|did)\b/i,
    /\b(happens|happen|happened)\b/i,
    /\b(writes?|wrote|written)\b/i,
    /\b(reads?|read)\b/i,
    /\b(triggers?|triggered)\b/i,
    /\b(calls?|called)\b/i,
    /\b(sends?|sent)\b/i,
    /\b(creates?|created)\b/i,
    /\b(deletes?|deleted)\b/i,
    /\b(updates?|updated)\b/i,
    /\b(processes?|processed)\b/i,
    /\b(stores?|stored)\b/i,
    /\b(syncs?|synced|synchronizes?)\b/i,
    /\b(validates?|validated)\b/i,
    /\b(calculates?|calculated)\b/i,
    /\b(supports?|supported)\b/i,
    /\b(handles?|handled)\b/i,
    /\b(automatically)\b/i,
    /\b(always|never)\b/i,
  ];

  return functionalPatterns.some((pattern) => pattern.test(text));
}

/**
 * Determine confidence level based on evidence.
 */
function determineConfidence(evidence: EvidencePack): ConfidenceLevel {
  if (evidence.articles.length > 0) {
    return "confirmed";
  }
  return "needs_clarification";
}
