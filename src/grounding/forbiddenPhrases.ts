// ============================================
// Forbidden Phrases — V3 Guardrail Enforcement
// Ensures no over-promising language slips through
// ============================================

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

