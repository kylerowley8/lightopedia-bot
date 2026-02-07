// ============================================
// Indexer — Entry Point
// Only indexes markdown docs from help-articles
// ============================================

import { indexDocument as indexDocDocument, indexRepo as indexDocRepo } from "./docsIndexer.js";
import { shouldIndexPath, isDocFile } from "./config.js";
import crypto from "crypto";

export interface IndexResult {
  documentsProcessed: number;
  chunksCreated: number;
  errors: string[];
  indexRunId: string;
}

/**
 * Index a single file (docs only).
 */
export async function indexDocument(
  repoFullName: string,
  filePath: string,
  content: string,
  commitSha: string,
  options?: { force?: boolean; indexRunId?: string }
): Promise<{ chunksCreated: number; skipped?: boolean }> {
  if (!shouldIndexPath(filePath)) {
    console.log(`Skipping ${filePath} (not in allowlist)`);
    return { chunksCreated: 0, skipped: true };
  }

  if (!isDocFile(filePath)) {
    console.log(`Skipping ${filePath} (not a doc file)`);
    return { chunksCreated: 0, skipped: true };
  }

  const indexRunId = options?.indexRunId || crypto.randomUUID();

  const result = await indexDocDocument(
    repoFullName,
    filePath,
    content,
    commitSha,
    indexRunId,
    options
  );
  return { chunksCreated: result.chunksCreated, skipped: result.skipped };
}

/**
 * Index multiple files from a repo.
 */
export async function indexRepo(
  repoFullName: string,
  files: { path: string; content: string }[],
  commitSha: string,
  options?: { force?: boolean }
): Promise<IndexResult> {
  const indexRunId = crypto.randomUUID();
  const result: IndexResult = {
    documentsProcessed: 0,
    chunksCreated: 0,
    errors: [],
    indexRunId,
  };

  // Only doc files
  const docFiles = files.filter((f) => isDocFile(f.path) && shouldIndexPath(f.path));

  console.log(`\nIndexing ${docFiles.length} doc files...`);

  if (docFiles.length > 0) {
    const docResult = await indexDocRepo(repoFullName, docFiles, commitSha, options);
    result.documentsProcessed += docResult.documentsProcessed;
    result.chunksCreated += docResult.chunksCreated;
    result.errors.push(...docResult.errors);
  }

  return result;
}

// Re-export useful functions from config
export { shouldIndexPath, isDocFile } from "./config.js";
