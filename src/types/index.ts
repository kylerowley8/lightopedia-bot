// ============================================
// Core domain types for Lightopedia
// ============================================

/** Slack context for tracking requests */
export interface SlackContext {
  teamId: string;
  channelId: string;
  threadTs: string;
}

/** A message in a conversation thread */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/** Conversation history for context-aware answers */
export interface ConversationHistory {
  messages: ConversationMessage[];
  /** Whether this is a follow-up question in an existing thread */
  isFollowUp: boolean;
}

/** A retrieved chunk from the vector database */
export interface RetrievedChunk {
  chunkId: string;
  content: string;
  similarity: number;
  metadata: ChunkMetadata;
}

/** Source type for retrieval prioritization */
export type SourceType = "code" | "docs" | "notion" | "unknown";

/** Metadata stored with each chunk */
export interface ChunkMetadata {
  source: string;
  sourceType?: SourceType;
  documentId?: string;
  chunkIndex?: number;
  heading?: string;
  commitSha?: string;
  filePath?: string;
  symbols?: string[];
}

/** Retrieval mode indicating source priority */
export type RetrievalMode = "code_only" | "code_then_docs" | "docs_only" | "none";

/** Result of retrieval operation */
export interface RetrievalResult {
  chunks: RetrievedChunk[];
  totalTokens: number;
  avgSimilarity: number;
  isConfident: boolean;
  queriesUsed?: string[];
  /** Which retrieval path was used */
  retrievalMode?: RetrievalMode;
  /** Why confidence is low (for clarifying questions) */
  lowConfidenceReason?: string;
}

/** Confidence level for answers */
export type ConfidenceLevel = "high" | "medium" | "low";

/** Result of answer generation */
export interface AnswerResult {
  requestId: string;
  answer: string;
  isConfident: boolean;
  confidence: ConfidenceLevel;
  chunkIds: string[];
  avgSimilarity: number;
  latencyMs: number;
}

/** A document chunk ready for indexing */
export interface Chunk {
  content: string;
  index: number;
  metadata: ChunkMetadata;
}

/** Result of indexing a document */
export interface IndexResult {
  documentsProcessed: number;
  chunksCreated: number;
  embeddingsCreated: number;
  errors: string[];
}
