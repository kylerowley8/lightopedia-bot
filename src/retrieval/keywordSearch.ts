import { supabase } from "../db/supabase.js";
import { logger } from "../lib/logger.js";
import type { RetrievedChunk, ChunkMetadata } from "../types/index.js";

// ============================================
// Keyword/Full-Text Search
// Complements vector search for exact term matching
// ============================================

interface KeywordSearchRow {
  id: string;
  content: string;
  metadata: ChunkMetadata | null;
}

/**
 * Extract key terms from a question for keyword search.
 * Focuses on nouns, product names, and technical terms.
 */
export function extractSearchTerms(question: string): string[] {
  // Known product/integration names and Light domain terms
  const knownTerms = [
    // Integrations
    "salesforce",
    "hubspot",
    "finch",
    "stripe",
    "plaid",
    "quickbooks",
    "xero",
    "netsuite",
    "sage",
    // Technical terms
    "ocr",
    "workflow",
    "webhook",
    "api",
    "oauth",
    "sso",
    "auth0",
    // Light domain entities
    "customer",
    "customers",
    "contact",
    "contacts",
    "vendor",
    "vendors",
    "supplier",
    "suppliers",
    "contract",
    "contracts",
    "invoice",
    "invoices",
    "expense",
    "expenses",
    "reimbursement",
    "approval",
    "approver",
    // Actions
    "import",
    "export",
    "create",
    "sync",
    "merge",
    "csv",
    // Accounting
    "ledger",
    "journal",
    "payable",
    "receivable",
  ];

  const lowerQuestion = question.toLowerCase();
  const foundTerms: string[] = [];

  // Check for known terms
  for (const term of knownTerms) {
    if (lowerQuestion.includes(term)) {
      foundTerms.push(term);
    }
  }

  // Extract capitalized words (likely proper nouns/product names)
  const capitalizedWords = question.match(/\b[A-Z][a-zA-Z]+\b/g) || [];
  for (const word of capitalizedWords) {
    const lower = word.toLowerCase();
    // Skip common words
    if (!["the", "how", "what", "when", "where", "why", "does", "can", "light"].includes(lower)) {
      if (!foundTerms.includes(lower)) {
        foundTerms.push(lower);
      }
    }
  }

  return foundTerms;
}

/**
 * Perform keyword/full-text search using Supabase.
 * Returns chunks matching any of the search terms.
 */
export async function keywordSearch(
  question: string,
  limit: number = 10
): Promise<RetrievedChunk[]> {
  const terms = extractSearchTerms(question);

  if (terms.length === 0) {
    logger.debug("No keyword terms extracted", { stage: "retrieve", question: question.slice(0, 50) });
    return [];
  }

  logger.info("Keyword search starting", {
    stage: "retrieve",
    terms,
    termCount: terms.length,
  });

  const allResults: RetrievedChunk[] = [];
  const seenIds = new Set<string>();

  // Search for each term separately to ensure we get results for each
  for (const term of terms) {
    try {
      // Use ilike for case-insensitive partial matching
      const { data, error } = await supabase
        .from("chunks")
        .select("id, content, metadata")
        .ilike("content", `%${term}%`)
        .limit(limit);

      if (error) {
        logger.warn("Keyword search failed for term", {
          stage: "retrieve",
          term,
          error: error.message,
        });
        continue;
      }

      const rows = (data ?? []) as KeywordSearchRow[];

      for (const row of rows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);

        // Calculate a simple relevance score based on term frequency
        const termCount = (row.content.toLowerCase().match(new RegExp(term, "gi")) || []).length;
        const contentLength = row.content.length;
        // Normalize: more occurrences in shorter content = higher score
        const relevanceScore = Math.min(1, (termCount * 100) / contentLength + 0.3);

        allResults.push({
          chunkId: row.id,
          content: row.content,
          metadata: {
            source: row.metadata?.source ?? "unknown",
            documentId: row.metadata?.documentId,
            chunkIndex: row.metadata?.chunkIndex,
          },
          similarity: relevanceScore, // Use relevance as similarity placeholder
        });
      }
    } catch (err) {
      logger.error("Keyword search exception", { stage: "retrieve", term, error: err });
    }
  }

  // Sort by relevance score descending
  allResults.sort((a, b) => b.similarity - a.similarity);

  logger.info("Keyword search complete", {
    stage: "retrieve",
    terms,
    totalFound: allResults.length,
  });

  return allResults.slice(0, limit);
}

/**
 * Merge vector search results with keyword search results.
 * Deduplicates by chunk ID and combines scores.
 */
export function mergeSearchResults(
  vectorResults: RetrievedChunk[],
  keywordResults: RetrievedChunk[],
  vectorWeight: number = 0.7,
  keywordWeight: number = 0.3
): RetrievedChunk[] {
  const merged = new Map<string, RetrievedChunk & { vectorScore?: number; keywordScore?: number }>();

  // Add vector results
  for (const chunk of vectorResults) {
    merged.set(chunk.chunkId, {
      ...chunk,
      vectorScore: chunk.similarity,
      keywordScore: 0,
    });
  }

  // Add/merge keyword results
  for (const chunk of keywordResults) {
    const existing = merged.get(chunk.chunkId);
    if (existing) {
      // Chunk found by both - boost it
      existing.keywordScore = chunk.similarity;
    } else {
      // Keyword-only result
      merged.set(chunk.chunkId, {
        ...chunk,
        vectorScore: 0,
        keywordScore: chunk.similarity,
      });
    }
  }

  // Calculate combined scores
  const results: RetrievedChunk[] = [];
  for (const chunk of merged.values()) {
    const vectorScore = chunk.vectorScore ?? 0;
    const keywordScore = chunk.keywordScore ?? 0;

    // If found by both methods, give extra boost
    const dualMatchBoost = vectorScore > 0 && keywordScore > 0 ? 0.1 : 0;

    const combinedScore =
      vectorScore * vectorWeight + keywordScore * keywordWeight + dualMatchBoost;

    results.push({
      chunkId: chunk.chunkId,
      content: chunk.content,
      metadata: chunk.metadata,
      similarity: Math.min(1, combinedScore),
    });
  }

  // Sort by combined score
  results.sort((a, b) => b.similarity - a.similarity);

  return results;
}
