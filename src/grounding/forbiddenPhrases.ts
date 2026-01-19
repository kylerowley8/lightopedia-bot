// ============================================
// Forbidden Phrases — V3 Guardrail Enforcement
// Ensures no over-promising language slips through
// ============================================

import { logger } from "../lib/logger.js";
import type { V3Answer } from "../evidence/types.js";

/**
 * Phrases that are FORBIDDEN unless docs explicitly support them.
 * These imply guarantees that the platform may not deliver.
 */
export const FORBIDDEN_PHRASES = [
  "automatically",
  "out of the box",
  "out-of-the-box",
  "no setup required",
  "fully handles",
  "fully automated",
  "self-serve without support",
  "self-service without",
  "guaranteed",
  "seamlessly",
  "seamless",
  "effortlessly",
  "effortless",
  "zero configuration",
  "works instantly",
  "no manual steps",
  "handles all cases",
  "supports all",
  "always works",
  "never fails",
] as const;

/**
 * Safe alternatives for forbidden phrases.
 */
const SAFE_ALTERNATIVES: Record<string, string> = {
  automatically: "is designed to",
  "out of the box": "with configuration",
  "out-of-the-box": "with configuration",
  "no setup required": "with some setup",
  "fully handles": "supports handling",
  "fully automated": "supports automation for",
  seamlessly: "with proper integration",
  seamless: "streamlined",
  effortlessly: "with configuration",
  effortless: "straightforward",
  guaranteed: "designed to",
  "zero configuration": "minimal configuration",
  "works instantly": "works after setup",
  "no manual steps": "minimal manual steps",
  "handles all cases": "handles common cases",
  "supports all": "supports many",
};

/**
 * Result of forbidden phrase check.
 */
export interface ForbiddenPhraseResult {
  /** Whether any forbidden phrases were found */
  hasForbidden: boolean;
  /** List of forbidden phrases found */
  found: string[];
  /** Cleaned text with forbidden phrases replaced */
  cleanedText?: string;
}

/**
 * Check text for forbidden phrases.
 */
export function checkForbiddenPhrases(text: string): ForbiddenPhraseResult {
  const lowerText = text.toLowerCase();
  const found: string[] = [];

  for (const phrase of FORBIDDEN_PHRASES) {
    if (lowerText.includes(phrase.toLowerCase())) {
      found.push(phrase);
    }
  }

  if (found.length === 0) {
    return { hasForbidden: false, found: [] };
  }

  // Clean the text by replacing forbidden phrases
  let cleanedText = text;
  for (const phrase of found) {
    const replacement = SAFE_ALTERNATIVES[phrase.toLowerCase()] || "supports";
    const regex = new RegExp(phrase, "gi");
    cleanedText = cleanedText.replace(regex, replacement);
  }

  return {
    hasForbidden: true,
    found,
    cleanedText,
  };
}

/**
 * Check and clean a V3 answer for forbidden phrases.
 * Returns the cleaned answer and logs any violations.
 */
export function enforceForbiddenPhrases(answer: V3Answer): V3Answer {
  const violations: string[] = [];
  const cleaned: V3Answer = { ...answer };

  // Check shortAnswer
  const shortCheck = checkForbiddenPhrases(answer.shortAnswer);
  if (shortCheck.hasForbidden) {
    violations.push(...shortCheck.found);
    cleaned.shortAnswer = shortCheck.cleanedText || answer.shortAnswer;
  }

  // Check conceptualModel
  const modelCheck = checkForbiddenPhrases(answer.conceptualModel);
  if (modelCheck.hasForbidden) {
    violations.push(...modelCheck.found);
    cleaned.conceptualModel = modelCheck.cleanedText || answer.conceptualModel;
  }

  // Check howItWorks
  cleaned.howItWorks = answer.howItWorks.map((step) => {
    const stepCheck = checkForbiddenPhrases(step);
    if (stepCheck.hasForbidden) {
      violations.push(...stepCheck.found);
      return stepCheck.cleanedText || step;
    }
    return step;
  });

  // Check boundaries
  cleaned.boundaries = {
    whatLightDoes: answer.boundaries.whatLightDoes.map((item) => {
      const itemCheck = checkForbiddenPhrases(item);
      if (itemCheck.hasForbidden) {
        violations.push(...itemCheck.found);
        return itemCheck.cleanedText || item;
      }
      return item;
    }),
    whatLightDoesNot: answer.boundaries.whatLightDoesNot,
  };

  // Check salesSummary
  const summaryCheck = checkForbiddenPhrases(answer.salesSummary);
  if (summaryCheck.hasForbidden) {
    violations.push(...summaryCheck.found);
    cleaned.salesSummary = summaryCheck.cleanedText || answer.salesSummary;
  }

  // Log violations if any
  if (violations.length > 0) {
    logger.warn("Forbidden phrases detected and replaced", {
      stage: "guardrails",
      violations: [...new Set(violations)],
    });
  }

  return cleaned;
}
