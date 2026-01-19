// ============================================
// Indexer — V3 Entry Point
// Routes to appropriate indexer based on file type
// ============================================

import { indexDocument as indexDocDocument, indexRepo as indexDocRepo } from "./docsIndexer.js";
import { indexCodeFile, indexCodeRepo } from "./codeIndexer.js";
import { shouldIndexPath, isCodeFile, isDocFile } from "./config.js";
import crypto from "crypto";

export interface IndexResult {
  documentsProcessed: number;
  chunksCreated: number;
  errors: string[];
  indexRunId: string;
}

/**
 * Index a single file (routes to docs or code indexer).
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

  const indexRunId = options?.indexRunId || crypto.randomUUID();

  if (isCodeFile(filePath)) {
    const result = await indexCodeFile(
      repoFullName,
      filePath,
      content,
      commitSha,
      indexRunId,
      options
    );
    return { chunksCreated: result.chunksCreated, skipped: result.skipped };
  }

  if (isDocFile(filePath)) {
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

  console.log(`Skipping ${filePath} (unknown file type)`);
  return { chunksCreated: 0, skipped: true };
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

  // Separate files by type
  const docFiles = files.filter((f) => isDocFile(f.path) && shouldIndexPath(f.path));
  const codeFiles = files.filter((f) => isCodeFile(f.path) && shouldIndexPath(f.path));

  console.log(`\nIndexing ${docFiles.length} doc files and ${codeFiles.length} code files...`);

  // Index docs
  if (docFiles.length > 0) {
    const docResult = await indexDocRepo(repoFullName, docFiles, commitSha, options);
    result.documentsProcessed += docResult.documentsProcessed;
    result.chunksCreated += docResult.chunksCreated;
    result.errors.push(...docResult.errors);
  }

  // Index code
  if (codeFiles.length > 0) {
    const codeResult = await indexCodeRepo(repoFullName, codeFiles, commitSha, options);
    result.documentsProcessed += codeResult.filesProcessed;
    result.chunksCreated += codeResult.chunksCreated;
    result.errors.push(...codeResult.errors);
  }

  return result;
}

// Re-export useful functions from config
export { shouldIndexPath, isCodeFile, isDocFile } from "./config.js";
