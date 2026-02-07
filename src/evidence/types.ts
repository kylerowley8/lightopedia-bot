// ============================================
// Evidence Types — Single type system for Lightopedia
// Help-articles are the single source of truth.
// ============================================

// ============================================
// Versioning & Indexing Metadata
// ============================================

/**
 * Versioning metadata stored with every chunk.
 * Enables replay, drift detection, and audit.
 */
export type IndexMetadata = {
  /** Repository slug (e.g., "light-space/help-articles") */
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
};

/**
 * An article chunk from the help-articles repo.
 */
export type Article = {
  /** Unique chunk ID (for citation reference) */
  id: string;

  /** File path (e.g., "getting-started/invoicing.md") */
  path: string;

  /** Section heading if available */
  section?: string;

  /** Human-readable title extracted from article */
  title?: string;

  /** Text content */
  content: string;

  /** Similarity score from retrieval */
  score: number;

  /** Repository slug */
  repoSlug: string;

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
 * Retrieval metadata for debugging and replay.
 */
export type RetrievalMeta = {
  /** Version of retrieval program used */
  version: string;
  /** Index run ID used */
  indexRunId: string;
  /** Total articles searched */
  totalSearched: number;
  /** Query variations used */
  queriesUsed: string[];
};

/**
 * Complete evidence package for a query.
 * Single source: help articles.
 */
export type EvidencePack = {
  /** Help article evidence */
  articles: Article[];

  /** User-provided attachments (optional) */
  attachments?: AttachmentEvidence[];

  /** Retrieval metadata for replay/debugging */
  retrievalMeta: RetrievalMeta;
};

/**
 * A citation reference to evidence.
 */
export type Citation = {
  /** Evidence type */
  type: "article" | "attachment";

  /** Reference identifier (article path, etc.) */
  ref: string;

  /** Human-readable label for display */
  label?: string;
};

/**
 * Confidence levels for grounded answers.
 */
export type ConfidenceLevel =
  | "confirmed"              // Grounded in help articles
  | "needs_clarification";   // Insufficient evidence

/**
 * A fully grounded answer ready for rendering.
 * Validated by the citation gate at the summary/detailedAnswer level.
 */
export type GroundedAnswer = {
  /** One-sentence summary (customer-ready) */
  summary: string;

  /** Detailed answer shown when user clicks "More details" */
  detailedAnswer?: string;

  /** Confidence based on evidence source */
  confidence: ConfidenceLevel;

  /** Whether ambiguity was detected */
  hasAmbiguity: boolean;

  /** Internal notes for follow-up (optional) */
  internalNotes?: string;
};

/**
 * Draft answer before citation gate.
 */
export type DraftAnswer = {
  summary: string;
  detailedAnswer?: string;
  suggestedConfidence: ConfidenceLevel;
  internalNotes?: string;
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
export const RETRIEVAL_VERSION = "retrieval.v2.0";

/**
 * Empty evidence pack factory.
 */
export function createEmptyEvidencePack(indexRunId: string): EvidencePack {
  return {
    articles: [],
    attachments: [],
    retrievalMeta: {
      version: RETRIEVAL_VERSION,
      indexRunId,
      totalSearched: 0,
      queriesUsed: [],
    },
  };
}

// ============================================
// Retrieval Types
// ============================================

/** A retrieved chunk from the vector database */
export interface RetrievedChunk {
  chunkId: string;
  content: string;
  similarity: number;
  metadata: ChunkMetadata;
}

/** Metadata stored with each chunk */
export interface ChunkMetadata {
  source: string;
  documentId?: string;
  chunkIndex?: number;
  heading?: string;
  commitSha?: string;
  filePath?: string;
}

