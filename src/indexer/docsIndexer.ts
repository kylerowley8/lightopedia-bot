// ============================================
// Docs Indexer — V2 Docs-First Indexing
// ============================================
// Indexes documentation from allowed repos into the docs table.
// See INDEXING_SCOPE.md for what is indexed.

import { supabase } from "../db/supabase.js";
import { embedChunks } from "../retrieval/embeddings.js";
import { logger } from "../lib/logger.js";
import { RETRIEVAL_VERSION } from "../evidence/types.js";
import {
  isAllowedRepo,
  shouldIndexPath,
  validateIndexRequest,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
} from "./config.js";
import crypto from "crypto";

// ============================================
// Types
// ============================================

export interface IndexDocResult {
  chunksCreated: number;
  skipped: boolean;
  reason?: string;
}

export interface IndexRepoResult {
  documentsProcessed: number;
  chunksCreated: number;
  skipped: number;
  errors: string[];
  indexRunId: string;
}

interface DocChunkInsert {
  content: string;
  embedding: number[];
  metadata: {
    source_type: "repo";
    repo_slug: string;
    path: string;
    section?: string;
    commit_sha: string;
    indexed_at: string;
    index_run_id: string;
    retrieval_program_version: string;
  };
}

// ============================================
// Main Indexing Functions
// ============================================

/**
 * Index a single document from a repo.
 * Validates against allowlist and indexes only markdown.
 */
export async function indexDocument(
  repoSlug: string,
  filePath: string,
  content: string,
  commitSha: string,
  indexRunId: string,
  options?: { force?: boolean }
): Promise<IndexDocResult> {
  // Validate against V1 scope
  const validation = validateIndexRequest(repoSlug, filePath);
  if (!validation.allowed) {
    return {
      chunksCreated: 0,
      skipped: true,
      reason: validation.reason,
    };
  }

  // Check if already indexed at this commit (unless force)
  if (!options?.force) {
    const { data: existing } = await supabase
      .from("docs")
      .select("id")
      .eq("metadata->>repo_slug", repoSlug)
      .eq("metadata->>path", filePath)
      .eq("metadata->>commit_sha", commitSha)
      .limit(1);

    if (existing && existing.length > 0) {
      logger.info("Document already indexed", {
        stage: "indexer",
        repoSlug,
        filePath,
        commitSha: commitSha.slice(0, 7),
      });
      return {
        chunksCreated: 0,
        skipped: true,
        reason: "already indexed at this commit",
      };
    }
  }

  // Delete old versions of this document
  await supabase
    .from("docs")
    .delete()
    .eq("metadata->>repo_slug", repoSlug)
    .eq("metadata->>path", filePath);

  // Chunk the document
  const chunks = chunkMarkdown(content, filePath);
  if (chunks.length === 0) {
    logger.info("No chunks created", {
      stage: "indexer",
      repoSlug,
      filePath,
      reason: "empty or too short",
    });
    return { chunksCreated: 0, skipped: true, reason: "no content to index" };
  }

  // Generate embeddings in batch
  const embeddings = await embedChunks(chunks.map((c) => c.content));

  // Build rows for insertion
  const now = new Date().toISOString();
  const rows: DocChunkInsert[] = chunks.map((chunk, i) => ({
    content: chunk.content,
    embedding: embeddings[i]!,
    metadata: {
      source_type: "repo" as const,
      repo_slug: repoSlug,
      path: filePath,
      section: chunk.section,
      commit_sha: commitSha,
      indexed_at: now,
      index_run_id: indexRunId,
      retrieval_program_version: RETRIEVAL_VERSION,
    },
  }));

  // Insert chunks
  const { error: insertError } = await supabase.from("docs").insert(rows);

  if (insertError) {
    logger.error("Failed to insert doc chunks", {
      stage: "indexer",
      repoSlug,
      filePath,
      error: insertError.message,
    });
    throw insertError;
  }

  logger.info("Indexed document", {
    stage: "indexer",
    repoSlug,
    filePath,
    chunksCreated: chunks.length,
  });

  return { chunksCreated: chunks.length, skipped: false };
}

/**
 * Index multiple documents from a repo.
 */
export async function indexRepo(
  repoSlug: string,
  files: { path: string; content: string }[],
  commitSha: string,
  options?: { force?: boolean }
): Promise<IndexRepoResult> {
  // Validate repo first
  if (!isAllowedRepo(repoSlug)) {
    return {
      documentsProcessed: 0,
      chunksCreated: 0,
      skipped: files.length,
      errors: [`Repo not in allowlist: ${repoSlug}`],
      indexRunId: "",
    };
  }

  const indexRunId = crypto.randomUUID();

  const result: IndexRepoResult = {
    documentsProcessed: 0,
    chunksCreated: 0,
    skipped: 0,
    errors: [],
    indexRunId,
  };

  logger.info("Starting repo indexing", {
    stage: "indexer",
    repoSlug,
    fileCount: files.length,
    indexRunId,
  });

  for (const file of files) {
    try {
      const docResult = await indexDocument(
        repoSlug,
        file.path,
        file.content,
        commitSha,
        indexRunId,
        options
      );

      if (docResult.skipped) {
        result.skipped++;
      } else {
        result.documentsProcessed++;
        result.chunksCreated += docResult.chunksCreated;
      }
    } catch (err) {
      const msg = `Failed to index ${file.path}: ${err}`;
      logger.error(msg, { stage: "indexer", repoSlug, path: file.path });
      result.errors.push(msg);
    }
  }

  logger.info("Repo indexing complete", {
    stage: "indexer",
    repoSlug,
    indexRunId,
    documentsProcessed: result.documentsProcessed,
    chunksCreated: result.chunksCreated,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Delete all chunks for a document path.
 */
export async function deleteDocument(
  repoSlug: string,
  filePath: string
): Promise<number> {
  const { data, error } = await supabase
    .from("docs")
    .delete()
    .eq("metadata->>repo_slug", repoSlug)
    .eq("metadata->>path", filePath)
    .select("id");

  if (error) {
    logger.error("Failed to delete document", {
      stage: "indexer",
      repoSlug,
      filePath,
      error: error.message,
    });
    throw error;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    logger.info("Deleted document", {
      stage: "indexer",
      repoSlug,
      filePath,
      chunksDeleted: count,
    });
  }

  return count;
}

/**
 * Purge all documents from a specific indexing run.
 */
export async function purgeIndexRun(indexRunId: string): Promise<number> {
  const { data, error } = await supabase
    .from("docs")
    .delete()
    .eq("metadata->>index_run_id", indexRunId)
    .select("id");

  if (error) {
    logger.error("Failed to purge index run", {
      stage: "indexer",
      indexRunId,
      error: error.message,
    });
    throw error;
  }

  const count = data?.length ?? 0;
  logger.info("Purged index run", {
    stage: "indexer",
    indexRunId,
    chunksDeleted: count,
  });

  return count;
}

// ============================================
// Markdown Chunking
// ============================================

interface MarkdownChunk {
  content: string;
  section?: string;
}

/**
 * Chunk markdown document into sections.
 * Preserves heading context for each chunk.
 */
function chunkMarkdown(content: string, filePath: string): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  const sections = splitByHeadings(content);

  for (const section of sections) {
    const sectionChunks = chunkText(section.content, CHUNK_SIZE, CHUNK_OVERLAP);
    for (const text of sectionChunks) {
      if (text.trim().length < 20) continue; // Skip tiny chunks

      chunks.push({
        content: text.trim(),
        section: section.heading,
      });
    }
  }

  return chunks;
}

interface Section {
  heading?: string;
  content: string;
}

/**
 * Split markdown by headings (h1-h3).
 */
function splitByHeadings(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | undefined;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join("\n"),
        });
      }
      currentHeading = headingMatch[1];
      currentContent = [line];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join("\n"),
    });
  }

  return sections;
}

/**
 * Chunk text with overlap.
 */
function chunkText(text: string, maxSize: number, overlap: number): string[] {
  if (text.length <= maxSize) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (para.length > maxSize) {
      // Paragraph is too long - push current and split paragraph
      if (current.trim()) {
        chunks.push(current);
      }
      chunks.push(...splitLongText(para, maxSize));
      current = "";
    } else if (current.length + para.length + 2 > maxSize && current.trim()) {
      // Adding paragraph would exceed limit
      chunks.push(current);
      // Start new chunk with overlap
      const overlapText = current.slice(-overlap);
      current = overlapText + "\n\n" + para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Split very long text by sentences or hard limits.
 */
function splitLongText(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];

  const parts: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxSize) {
      // Sentence is too long - hard split
      if (current.trim()) {
        parts.push(current.trim());
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxSize) {
        parts.push(sentence.slice(i, i + maxSize));
      }
    } else if (current.length + sentence.length + 1 > maxSize && current.trim()) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.length > 0 ? parts : [text.slice(0, maxSize)];
}
