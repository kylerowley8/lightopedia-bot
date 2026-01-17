// ============================================
// Router Heuristics — Deterministic classification
// ============================================

import {
  Mode,
  MODE_SIGNALS,
  FOLLOWUP_SIGNALS,
  HEURISTIC_CONFIDENCE_THRESHOLD,
} from "./types.js";

/**
 * Heuristic match result.
 */
export type HeuristicMatch = {
  mode: Mode;
  confidence: number;
  matchedPatterns: string[];
};

/**
 * Classify a question using heuristics only.
 * Returns null if confidence is below threshold (requires LLM).
 *
 * V1 priority order:
 * 1. Follow-up detection (if in thread)
 * 2. Out-of-scope detection (deep behavior questions)
 * 3. In-scope mode classification
 */
export function classifyWithHeuristics(
  question: string,
  hasThreadHistory: boolean
): HeuristicMatch | null {
  const normalizedQuestion = question.toLowerCase().trim();

  // Check for follow-up signals first (if in thread)
  if (hasThreadHistory) {
    const followupMatch = matchFollowupSignals(normalizedQuestion);
    if (followupMatch) {
      return {
        mode: "followup",
        confidence: followupMatch.confidence,
        matchedPatterns: followupMatch.patterns,
      };
    }
  }

  // Check for out-of-scope patterns FIRST (V1 boundary)
  const outOfScopePatterns = MODE_SIGNALS.out_of_scope;
  const outOfScopeMatch = matchPatterns(normalizedQuestion, outOfScopePatterns);
  if (outOfScopeMatch.score >= 2) {
    // Strong signal for out-of-scope
    return {
      mode: "out_of_scope",
      confidence: 0.85,
      matchedPatterns: outOfScopeMatch.matched,
    };
  }

  // Score each in-scope mode by pattern matches
  const scores: Array<{ mode: Mode; score: number; patterns: string[] }> = [];

  for (const [mode, patterns] of Object.entries(MODE_SIGNALS)) {
    // Skip meta-modes
    if (mode === "followup" || mode === "clarify" || mode === "out_of_scope") continue;

    const matchResult = matchPatterns(normalizedQuestion, patterns);
    if (matchResult.score > 0) {
      scores.push({
        mode: mode as Mode,
        score: matchResult.score,
        patterns: matchResult.matched,
      });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // No matches
  if (scores.length === 0) {
    return null;
  }

  const best = scores[0]!;
  const second = scores[1];

  // Calculate confidence based on score gap
  let confidence: number;
  if (!second) {
    // Only one mode matched
    confidence = Math.min(0.9, 0.5 + best.score * 0.1);
  } else {
    // Multiple modes matched — confidence based on gap
    const gap = best.score - second.score;
    confidence = Math.min(0.9, 0.4 + gap * 0.15);
  }

  // Below threshold — need LLM
  if (confidence < HEURISTIC_CONFIDENCE_THRESHOLD) {
    return null;
  }

  return {
    mode: best.mode,
    confidence,
    matchedPatterns: best.patterns,
  };
}

/**
 * Match patterns against question.
 */
function matchPatterns(
  question: string,
  patterns: string[]
): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(question)) {
        matched.push(pattern);
        score += 1;
      }
    } catch {
      // Invalid regex, try literal match
      if (question.includes(pattern)) {
        matched.push(pattern);
        score += 1;
      }
    }
  }

  return { score, matched };
}

/**
 * Check for follow-up signals.
 */
function matchFollowupSignals(
  question: string
): { confidence: number; patterns: string[] } | null {
  const matched: string[] = [];

  for (const signal of FOLLOWUP_SIGNALS) {
    if (signal.test(question)) {
      matched.push(signal.source);
    }
  }

  if (matched.length === 0) {
    return null;
  }

  // Short questions in threads are high-confidence follow-ups
  const isShort = question.length < 30;
  const confidence = isShort ? 0.85 : 0.7;

  return { confidence, patterns: matched };
}

/**
 * Extract query hints from a question.
 * These are entities, keywords, or phrases useful for retrieval.
 */
export function extractQueryHints(question: string): string[] {
  const hints: string[] = [];
  const normalizedQuestion = question.toLowerCase();

  // Extract quoted phrases
  const quoteMatches = question.match(/"([^"]+)"/g);
  if (quoteMatches) {
    hints.push(...quoteMatches.map((m) => m.replace(/"/g, "")));
  }

  // Extract camelCase/PascalCase identifiers (likely class/function names)
  const identifierMatches = question.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
  if (identifierMatches) {
    hints.push(...identifierMatches);
  }

  // Extract snake_case identifiers
  const snakeMatches = question.match(/\b[a-z]+(?:_[a-z]+)+\b/g);
  if (snakeMatches) {
    hints.push(...snakeMatches);
  }

  // Extract technical terms
  const techTerms = [
    "invoice", "contract", "payment", "subscription", "billing",
    "ledger", "journal", "entry", "account", "customer",
    "api", "endpoint", "webhook", "event", "sync", "integration",
    "salesforce", "stripe", "quickbooks",
  ];
  for (const term of techTerms) {
    if (normalizedQuestion.includes(term)) {
      hints.push(term);
    }
  }

  // Deduplicate and return
  return [...new Set(hints)];
}

/**
 * Detect pronouns that need resolution from thread context.
 */
export function detectPronouns(question: string): string[] {
  const pronouns: string[] = [];
  const pronounPatterns = [
    { pattern: /\b(it|its)\b/gi, pronoun: "it" },
    { pattern: /\b(that|those)\b/gi, pronoun: "that" },
    { pattern: /\b(this|these)\b/gi, pronoun: "this" },
    { pattern: /\b(they|them|their)\b/gi, pronoun: "they" },
  ];

  for (const { pattern, pronoun } of pronounPatterns) {
    if (pattern.test(question)) {
      pronouns.push(pronoun);
    }
  }

  return pronouns;
}

/**
 * Check if a question is likely ambiguous.
 */
export function isAmbiguous(question: string): boolean {
  const normalizedQuestion = question.toLowerCase();

  // Very short questions are often ambiguous
  if (question.length < 15) {
    return true;
  }

  // Questions with multiple OR conditions
  if (/\bor\b/.test(normalizedQuestion) && normalizedQuestion.includes("?")) {
    return true;
  }

  // Questions that are just a noun phrase
  if (!/\b(what|how|why|when|where|can|does|is|are)\b/i.test(question)) {
    return true;
  }

  return false;
}
