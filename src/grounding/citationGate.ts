// ============================================
// Citation Gate — Binary grounding enforcement
//
// Rule: Every functional claim MUST have a citation.
// No heuristics. No confidence scores. Binary pass/fail.
// ============================================

import { logger } from "../lib/logger.js";
import type {
  DraftAnswer,
  GroundedAnswer,
  GroundedClaim,
  CitationGateResult,
  EvidencePack,
  ConfidenceLevel,
} from "../evidence/types.js";

/**
 * Apply the citation gate to a draft answer.
 *
 * Rules:
 * 1. Every claim with functional language MUST have citations
 * 2. Claims without citations are DROPPED
 * 3. If all claims are dropped, the answer FAILS
 * 4. Confidence is determined by evidence source, not heuristics
 */
export function applyCitationGate(
  draft: DraftAnswer,
  evidence: EvidencePack
): CitationGateResult {
  const droppedClaims: string[] = [];
  const groundedClaims: GroundedClaim[] = [];

  // Validate each claim
  for (const claim of draft.claims) {
    if (isFunctionalClaim(claim.text)) {
      // Functional claim MUST have citation
      if (claim.citations.length === 0) {
        droppedClaims.push(claim.text);
        logger.warn("Dropped uncited functional claim", {
          stage: "grounding",
          claim: claim.text.slice(0, 80),
        });
        continue;
      }

      // Validate citations reference actual evidence
      const validCitations = claim.citations.filter((c) =>
        isValidCitation(c.ref, evidence)
      );

      if (validCitations.length === 0) {
        droppedClaims.push(claim.text);
        logger.warn("Dropped claim with invalid citations", {
          stage: "grounding",
          claim: claim.text.slice(0, 80),
          invalidRefs: claim.citations.map((c) => c.ref),
        });
        continue;
      }

      groundedClaims.push({
        text: claim.text,
        citations: validCitations,
      });
    } else {
      // Non-functional claim (explanatory) - allowed without citation
      groundedClaims.push({
        text: claim.text,
        citations: claim.citations,
      });
    }
  }

  // Gate decision
  if (groundedClaims.length === 0 && draft.claims.length > 0) {
    // All claims dropped - answer fails
    logger.warn("Citation gate FAILED - all claims dropped", {
      stage: "grounding",
      originalClaimCount: draft.claims.length,
      droppedCount: droppedClaims.length,
    });

    return {
      passed: false,
      reason: "No claims could be grounded in available evidence.",
      droppedClaims,
    };
  }

  // Determine confidence from evidence source
  const confidence = determineConfidence(evidence, groundedClaims);

  const answer: GroundedAnswer = {
    summary: draft.summary,
    claims: groundedClaims,
    confidence,
    hasAmbiguity: false, // V1: No ambiguity detection
    internalNotes: draft.internalNotes,
  };

  logger.info("Citation gate PASSED", {
    stage: "grounding",
    groundedClaimCount: groundedClaims.length,
    droppedClaimCount: droppedClaims.length,
    confidence,
  });

  return {
    passed: true,
    answer,
  };
}

/**
 * Check if a claim contains functional language.
 *
 * Functional = "does", "happens", "writes", "emits", "retries", etc.
 * These MUST be cited. Explanatory language can pass without citation.
 */
function isFunctionalClaim(text: string): boolean {
  const functionalPatterns = [
    /\b(does|do|did)\b/i,
    /\b(happens|happen|happened)\b/i,
    /\b(writes?|wrote|written)\b/i,
    /\b(reads?|read)\b/i,
    /\b(emits?|emitted)\b/i,
    /\b(triggers?|triggered)\b/i,
    /\b(calls?|called)\b/i,
    /\b(sends?|sent)\b/i,
    /\b(creates?|created)\b/i,
    /\b(deletes?|deleted)\b/i,
    /\b(updates?|updated)\b/i,
    /\b(retries?|retried)\b/i,
    /\b(processes?|processed)\b/i,
    /\b(stores?|stored)\b/i,
    /\b(persists?|persisted)\b/i,
    /\b(syncs?|synced|synchronizes?)\b/i,
    /\b(validates?|validated)\b/i,
    /\b(calculates?|calculated)\b/i,
    /\b(automatically)\b/i,
    /\b(always|never)\b/i,
  ];

  return functionalPatterns.some((pattern) => pattern.test(text));
}

/**
 * Check if a citation reference is valid against evidence.
 */
function isValidCitation(ref: string, evidence: EvidencePack): boolean {
  // Check against docs
  for (const doc of evidence.docs) {
    if (
      doc.source === ref ||
      doc.metadata.path === ref ||
      doc.id === ref
    ) {
      return true;
    }
  }

  // Check against Slack threads
  for (const thread of evidence.slackThreads) {
    if (
      thread.permalink === ref ||
      thread.id === ref
    ) {
      return true;
    }
  }

  // Check by citation number (e.g., "[1]" -> first evidence item)
  const numMatch = ref.match(/^\[?(\d+)\]?$/);
  if (numMatch) {
    const index = parseInt(numMatch[1]!, 10) - 1;
    const totalEvidence = evidence.docs.length + evidence.slackThreads.length;
    return index >= 0 && index < totalEvidence;
  }

  return false;
}

/**
 * Determine confidence level based on evidence source.
 * No heuristics - purely evidence-based.
 */
function determineConfidence(
  evidence: EvidencePack,
  claims: GroundedClaim[]
): ConfidenceLevel {
  // No evidence at all
  if (evidence.docs.length === 0 && evidence.slackThreads.length === 0) {
    return "needs_clarification";
  }

  // Check if claims cite repo docs (stronger) vs Slack (weaker)
  let hasRepoCitation = false;
  let hasSlackCitation = false;

  for (const claim of claims) {
    for (const citation of claim.citations) {
      // Check if citation points to repo doc
      const doc = evidence.docs.find(
        (d) => d.source === citation.ref || d.id === citation.ref || d.metadata.path === citation.ref
      );
      if (doc && doc.metadata.sourceType === "repo") {
        hasRepoCitation = true;
      }

      // Check if citation points to Slack
      const thread = evidence.slackThreads.find(
        (t) => t.permalink === citation.ref || t.id === citation.ref
      );
      if (thread) {
        hasSlackCitation = true;
      }
    }
  }

  // Repo citations = confirmed from implementation
  if (hasRepoCitation) {
    return "confirmed_implementation";
  }

  // Slack citations only = confirmed from docs (weaker)
  if (hasSlackCitation) {
    return "confirmed_docs";
  }

  // Fallback
  return "confirmed_docs";
}

/**
 * Build citation footer for display.
 */
export function buildCitationFooter(
  answer: GroundedAnswer,
  evidence: EvidencePack
): string {
  const sources = new Set<string>();

  for (const claim of answer.claims) {
    for (const citation of claim.citations) {
      sources.add(citation.label ?? citation.ref);
    }
  }

  if (sources.size === 0) {
    return "";
  }

  const sourceList = Array.from(sources).slice(0, 5).join(", ");
  const confidenceText = getConfidenceText(answer.confidence);

  return `${confidenceText} | Sources: ${sourceList}`;
}

/**
 * Get human-readable confidence text.
 */
function getConfidenceText(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case "confirmed_implementation":
      return "Confirmed from implementation";
    case "confirmed_docs":
      return "Confirmed from docs";
    case "needs_clarification":
      return "Needs clarification";
  }
}
