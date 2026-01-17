// ============================================
// Router Types — Policy selection contracts
// V1 is DOCS-FIRST. Code tracing is out of scope.
// ============================================

/**
 * Current router version.
 * Bump when classification logic changes.
 */
export const ROUTER_VERSION = "router.v1.0";

/**
 * Routing modes for V1.
 * Each mode selects a specific retrieval program.
 * Router is a policy selector — it never answers questions.
 *
 * NOTE: behavior_code_first is OUT OF SCOPE for V1.
 * All modes use docs-first retrieval.
 */
export type Mode =
  | "capability_docs"       // "Can Light do X" → search docs (PRIMARY)
  | "enablement_sales"      // "How should I explain X" → sales enablement
  | "onboarding_howto"      // "How do I configure X" → step-by-step guides
  | "followup"              // Continuation of previous thread
  | "clarify"               // Ambiguous, need more info
  | "out_of_scope";         // Deep behavior/code questions → explain limitation

/**
 * Router output.
 * Strict JSON structure — no prose, no answers.
 */
export type RouteDecision = {
  /** Selected mode */
  mode: Mode;

  /** Router confidence in classification */
  confidence: "high" | "medium" | "low";

  /**
   * Query hints for retrieval.
   * Extracted entities, keywords, or reformulated queries.
   */
  queryHints: string[];

  /**
   * Information needed for clarification.
   * Present when mode is "clarify".
   */
  missingInfo?: string[];

  /**
   * Follow-up context.
   * Present when mode is "followup".
   */
  followupContext?: {
    previousTopic: string;
    resolvedPronouns: Record<string, string>;
  };
};

/**
 * Input to the router.
 * Preprocessed from raw Slack input.
 */
export type RouterInput = {
  /** User's question text */
  question: string;

  /** Thread history if available */
  threadHistory?: ThreadMessage[];

  /** Extracted attachment info if available */
  attachmentHints?: string[];

  /** Channel context (DM vs channel) */
  channelType: "dm" | "channel";
};

/**
 * A message in thread history.
 */
export type ThreadMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

// ============================================
// Router heuristic patterns
// ============================================

/**
 * Signal patterns for mode classification.
 * Heuristics are applied first; LLM only for ambiguous cases.
 *
 * V1: Deep behavior questions are OUT OF SCOPE.
 */
export const MODE_SIGNALS: Record<Mode, string[]> = {
  capability_docs: [
    "can light",
    "does light support",
    "does light have",
    "is it possible",
    "is there a way",
    "do you support",
    "feature",
    "capability",
    "available",
    "what is",
    "what are",
    "explain",
    "overview",
    "concept",
    "model",
    "integration",
    "salesforce",
    "stripe",
    "quickbooks",
  ],
  enablement_sales: [
    "how should i explain",
    "how do i explain",
    "what should i say",
    "what should i tell",
    "how to pitch",
    "how to position",
    "positioning",
    "messaging",
    "talk track",
    "customer question",
    "prospect ask",
    "objection",
    "competitor",
    "differentiate",
  ],
  onboarding_howto: [
    "how do i configure",
    "how do i set up",
    "how do i enable",
    "how to create",
    "how to add",
    "step by step",
    "walkthrough",
    "tutorial",
    "getting started",
    "guide",
  ],
  followup: [
    // Detected via thread context, not keyword
  ],
  clarify: [
    // Detected when ambiguous or insufficient info
  ],
  out_of_scope: [
    // Deep behavior questions - detected and routed to explanation
    "what happens when",
    "what happens if",
    "where is the code",
    "where does.*write",
    "why did.*fail",
    "why does.*error",
    "how is.*calculated",
    "how is.*processed",
    "retry logic",
    "queue",
    "cache",
    "runtime",
    "specific customer",
    "specific invoice",
    "this invoice",
    "my customer",
  ],
};

/**
 * Patterns that indicate a follow-up question.
 */
export const FOLLOWUP_SIGNALS = [
  /^(what about|how about|and|but|also)\b/i,
  /^(it|that|this|they|them)\b/i,
  /^(why|how|when|where)\?$/i,
  /^.{1,20}$/,  // Very short messages are likely follow-ups
];

// ============================================
// Constants
// ============================================

/**
 * Default mode when heuristics don't match and LLM is uncertain.
 */
export const DEFAULT_MODE: Mode = "capability_docs";

/**
 * Minimum confidence to skip LLM classification.
 */
export const HEURISTIC_CONFIDENCE_THRESHOLD = 0.7;
