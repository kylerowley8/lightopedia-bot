// ============================================
// Evidence Types — Core data structures for Lightopedia V1
// V1 is DOCS-FIRST. Code tracing is out of scope.
// ============================================

// ============================================
// Versioning & Indexing Metadata
// ============================================

/**
 * Source type for indexed content.
 */
export type SourceType = "repo" | "slack" | "code";

/**
 * Versioning metadata stored with every chunk.
 * Enables replay, drift detection, and audit.
 */
export type IndexMetadata = {
  /** Source type */
  sourceType: SourceType;

  /** Repository slug (e.g., "light-space/light") */
  repoSlug?: string;

  /** File path within repo */
  path: string;

  /** Git commit SHA at index time */
  commitSha?: string;

  /** When this chunk was indexed */
  indexedAt: string;

  /** UUID for this index run */
  indexRunId: string;

  /** Retrieval program version for replay */
  retrievalProgramVersion: string;

  /** Slack thread permalink (for slack source) */
  slackPermalink?: string;
};

/**
 * A chunk of documentation (markdown, notion, etc.)
 */
export type DocChunk = {
  /** Unique chunk ID (for citation reference) */
  id: string;

  /** Source identifier (e.g., "docs/billing.md") */
  source: string;

  /** Section heading if available */
  section?: string;

  /** Text content */
  content: string;

  /** Similarity score from retrieval */
  similarity: number;

  /** Versioning metadata */
  metadata: IndexMetadata;
};

/**
 * A chunk of source code (Kotlin, TypeScript).
 * V3: Code is ground truth for implementation behavior.
 */
export type CodeChunk = {
  /** Unique chunk ID */
  id: string;

  /** File path (e.g., "src/billing/InvoiceService.kt") */
  path: string;

  /** Symbols in this chunk (class/function names) */
  symbols: string[];

  /** Line range */
  startLine: number;
  endLine: number;

  /** Chunk type */
  chunkType: "class" | "function" | "module" | "block";

  /** Code content */
  content: string;

  /** Similarity score */
  similarity: number;

  /** Versioning metadata */
  metadata: IndexMetadata;
};

/**
 * A curated Slack thread from #lightopedia.
 * Secondary evidence source for V1.
 */
export type SlackThread = {
  /** Unique thread ID */
  id: string;

  /** Thread permalink */
  permalink: string;

  /** Thread topic/title (first message summary) */
  topic: string;

  /** Combined thread content */
  content: string;

  /** Similarity score from retrieval */
  similarity: number;

  /** Versioning metadata */
  metadata: IndexMetadata;
};

/**
 * Evidence extracted from user-provided attachments.
 */
export type AttachmentEvidence = {
  /** Attachment type */
  type: "image" | "log" | "pdf";

  /** Text extracted via OCR/parsing */
  extractedText: string;

  /** Identifiers found (error codes, endpoints, IDs) */
  identifiers: string[];

  /** Original Slack file ID for reference */
  slackFileId?: string;
};

/**
 * Complete evidence package for a query.
 * V3 hierarchy: Code > Docs > Slack
 * Code is ground truth, Docs are commitments, Slack is guidance.
 */
export type EvidencePack = {
  /** Source code evidence - ground truth for implementation (V3 primary) */
  codeChunks: CodeChunk[];

  /** Documentation evidence - customer commitments */
  docs: DocChunk[];

  /** Curated Slack threads from #lightopedia - internal guidance */
  slackThreads: SlackThread[];

  /** User-provided attachments (optional) */
  attachments?: AttachmentEvidence[];

  /** Retrieval metadata for replay/debugging */
  retrievalMeta: {
    /** Version of retrieval program used */
    version: string;
    /** Index run ID used */
    indexRunId: string;
    /** Total chunks searched */
    totalSearched: number;
    /** Query variations used */
    queriesUsed: string[];
  };
};

/**
 * A claim with its supporting citations.
 * Every claim MUST have at least one citation (enforced by citation gate).
 */
export type GroundedClaim = {
  /** The claim text (no jargon for non-technical view) */
  text: string;

  /** Citations supporting this claim */
  citations: Citation[];
};

/**
 * A citation reference to evidence.
 */
export type Citation = {
  /** Evidence type */
  type: "code" | "docs" | "attachment";

  /** Reference identifier (file path, doc source, etc.) */
  ref: string;

  /** Human-readable label for display */
  label?: string;
};

/**
 * Confidence levels for grounded answers.
 * No heuristics — purely based on evidence source.
 */
export type ConfidenceLevel =
  | "confirmed_implementation"  // Grounded in code
  | "confirmed_docs"            // Grounded in documentation
  | "needs_clarification";      // Insufficient evidence

/**
 * V3 Answer structure - sales-safe, non-promissory format.
 * Follows the enforced Slack template structure.
 */
export type V3Answer = {
  /** 1 sentence direct answer with appropriate framing */
  shortAnswer: string;

  /** How Light models/thinks about this (1-2 sentences) */
  conceptualModel: string;

  /** Operational steps - how it works in practice */
  howItWorks: string[];

  /** Explicit boundaries - what Light does vs does not */
  boundaries: {
    whatLightDoes: string[];
    whatLightDoesNot: string[];
  };

  /** One reusable line for customer conversations */
  salesSummary: string;

  /** Citation references (evidence indices) */
  citations: string[];
};

/**
 * A fully grounded answer ready for rendering.
 * All claims have citations (enforced by citation gate).
 */
export type GroundedAnswer = {
  /** One-sentence summary (customer-ready) */
  summary: string;

  /** Supporting claims with citations */
  claims: GroundedClaim[];

  /** Confidence based on evidence source */
  confidence: ConfidenceLevel;

  /** Whether ambiguity was detected (triggers trace buttons) */
  hasAmbiguity: boolean;

  /** Internal notes for follow-up (optional) */
  internalNotes?: string;

  /** V3 structured answer (when available) */
  v3?: V3Answer;
};

/**
 * Draft answer before citation gate.
 * May contain ungrounded claims that will be filtered.
 */
export type DraftAnswer = {
  summary: string;
  claims: Array<{
    text: string;
    citations: Citation[];
  }>;
  suggestedConfidence: ConfidenceLevel;
  internalNotes?: string;
  v3?: V3Answer;
};

// ============================================
// Utility types
// ============================================

/**
 * Result of the citation gate.
 */
export type CitationGateResult =
  | { passed: true; answer: GroundedAnswer }
  | { passed: false; reason: string; droppedClaims: string[] };

/**
 * Current retrieval program version.
 * Bump when retrieval logic changes.
 */
export const RETRIEVAL_VERSION = "retrieval.v1.0";

/**
 * Empty evidence pack factory.
 */
export function createEmptyEvidencePack(indexRunId: string): EvidencePack {
  return {
    codeChunks: [],
    docs: [],
    slackThreads: [],
    attachments: [],
    retrievalMeta: {
      version: RETRIEVAL_VERSION,
      indexRunId,
      totalSearched: 0,
      queriesUsed: [],
    },
  };
}
