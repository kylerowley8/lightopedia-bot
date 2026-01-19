// ============================================
// Code Indexer — V3 Code-First Indexing
// ============================================
// Indexes Kotlin and TypeScript source files.
// Chunks by function/class for better semantic retrieval.

import { supabase } from "../db/supabase.js";
import { embedChunks } from "../retrieval/embeddings.js";
import { logger } from "../lib/logger.js";
import { RETRIEVAL_VERSION } from "../evidence/types.js";
import {
  isAllowedRepo,
  shouldIndexPath,
  isCodeFile,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
} from "./config.js";
import {
  extractKotlinSymbols,
  extractTsSymbols,
} from "./chunker.js";
import crypto from "crypto";

// ============================================
// Types
// ============================================

export interface IndexCodeResult {
  chunksCreated: number;
  skipped: boolean;
  reason?: string;
}

export interface IndexCodeRepoResult {
  filesProcessed: number;
  chunksCreated: number;
  skipped: number;
  errors: string[];
  indexRunId: string;
}

interface CodeChunk {
  content: string;
  symbols: string[];
  startLine: number;
  endLine: number;
  type: "class" | "function" | "module" | "block";
}

interface CodeChunkInsert {
  content: string;
  embedding: number[];
  metadata: {
    source_type: "code";
    repo_slug: string;
    path: string;
    symbols: string[];
    start_line: number;
    end_line: number;
    chunk_type: string;
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
 * Index a single code file from a repo.
 */
export async function indexCodeFile(
  repoSlug: string,
  filePath: string,
  content: string,
  commitSha: string,
  indexRunId: string,
  options?: { force?: boolean }
): Promise<IndexCodeResult> {
  // Validate
  if (!isAllowedRepo(repoSlug)) {
    return { chunksCreated: 0, skipped: true, reason: `Repo not allowed: ${repoSlug}` };
  }

  if (!shouldIndexPath(filePath)) {
    return { chunksCreated: 0, skipped: true, reason: `Path not allowed: ${filePath}` };
  }

  if (!isCodeFile(filePath)) {
    return { chunksCreated: 0, skipped: true, reason: `Not a code file: ${filePath}` };
  }

  // Check if already indexed
  if (!options?.force) {
    const { data: existing } = await supabase
      .from("docs")
      .select("id")
      .eq("metadata->>source_type", "code")
      .eq("metadata->>repo_slug", repoSlug)
      .eq("metadata->>path", filePath)
      .eq("metadata->>commit_sha", commitSha)
      .limit(1);

    if (existing && existing.length > 0) {
      logger.info("Code file already indexed", {
        stage: "indexer",
        repoSlug,
        filePath,
        commitSha: commitSha.slice(0, 7),
      });
      return { chunksCreated: 0, skipped: true, reason: "already indexed" };
    }
  }

  // Delete old versions
  await supabase
    .from("docs")
    .delete()
    .eq("metadata->>source_type", "code")
    .eq("metadata->>repo_slug", repoSlug)
    .eq("metadata->>path", filePath);

  // Chunk the code
  const chunks = chunkCode(content, filePath);
  if (chunks.length === 0) {
    return { chunksCreated: 0, skipped: true, reason: "no content to index" };
  }

  // Generate embeddings
  const embeddings = await embedChunks(chunks.map((c) => c.content));

  // Build rows
  const now = new Date().toISOString();
  const rows: CodeChunkInsert[] = chunks.map((chunk, i) => ({
    content: chunk.content,
    embedding: embeddings[i]!,
    metadata: {
      source_type: "code" as const,
      repo_slug: repoSlug,
      path: filePath,
      symbols: chunk.symbols,
      start_line: chunk.startLine,
      end_line: chunk.endLine,
      chunk_type: chunk.type,
      commit_sha: commitSha,
      indexed_at: now,
      index_run_id: indexRunId,
      retrieval_program_version: RETRIEVAL_VERSION,
    },
  }));

  // Insert
  const { error: insertError } = await supabase.from("docs").insert(rows);

  if (insertError) {
    logger.error("Failed to insert code chunks", {
      stage: "indexer",
      repoSlug,
      filePath,
      error: insertError.message,
    });
    throw insertError;
  }

  logger.info("Indexed code file", {
    stage: "indexer",
    repoSlug,
    filePath,
    chunksCreated: chunks.length,
    symbols: chunks.flatMap((c) => c.symbols).slice(0, 10),
  });

  return { chunksCreated: chunks.length, skipped: false };
}

/**
 * Index multiple code files from a repo.
 */
export async function indexCodeRepo(
  repoSlug: string,
  files: { path: string; content: string }[],
  commitSha: string,
  options?: { force?: boolean }
): Promise<IndexCodeRepoResult> {
  if (!isAllowedRepo(repoSlug)) {
    return {
      filesProcessed: 0,
      chunksCreated: 0,
      skipped: files.length,
      errors: [`Repo not in allowlist: ${repoSlug}`],
      indexRunId: "",
    };
  }

  const indexRunId = crypto.randomUUID();

  const result: IndexCodeRepoResult = {
    filesProcessed: 0,
    chunksCreated: 0,
    skipped: 0,
    errors: [],
    indexRunId,
  };

  logger.info("Starting code indexing", {
    stage: "indexer",
    repoSlug,
    fileCount: files.length,
    indexRunId,
  });

  for (const file of files) {
    try {
      const fileResult = await indexCodeFile(
        repoSlug,
        file.path,
        file.content,
        commitSha,
        indexRunId,
        options
      );

      if (fileResult.skipped) {
        result.skipped++;
      } else {
        result.filesProcessed++;
        result.chunksCreated += fileResult.chunksCreated;
      }
    } catch (err) {
      const msg = `Failed to index ${file.path}: ${err}`;
      logger.error(msg, { stage: "indexer", repoSlug, path: file.path });
      result.errors.push(msg);
    }
  }

  logger.info("Code indexing complete", {
    stage: "indexer",
    repoSlug,
    indexRunId,
    filesProcessed: result.filesProcessed,
    chunksCreated: result.chunksCreated,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  return result;
}

// ============================================
// Code Chunking
// ============================================

/**
 * Chunk code by semantic units (classes, functions).
 */
function chunkCode(content: string, filePath: string): CodeChunk[] {
  const isKotlin = /\.(kt|kts)$/i.test(filePath);
  const isTypeScript = /\.(ts|tsx)$/i.test(filePath);

  if (isKotlin) {
    return chunkKotlin(content);
  } else if (isTypeScript) {
    return chunkTypeScript(content);
  }

  // Fallback: simple line-based chunking
  return chunkByLines(content);
}

/**
 * Chunk Kotlin code by class/function boundaries.
 */
function chunkKotlin(content: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split("\n");

  // Regex patterns for Kotlin
  const classPattern = /^(?:data\s+)?(?:sealed\s+)?(?:abstract\s+)?(?:class|object|interface|enum\s+class)\s+(\w+)/;
  const funPattern = /^(?:suspend\s+)?(?:override\s+)?(?:private\s+|protected\s+|internal\s+|public\s+)?fun\s+(?:<[^>]+>\s+)?(\w+)/;

  let currentChunk: string[] = [];
  let currentSymbols: string[] = [];
  let currentStartLine = 1;
  let braceCount = 0;
  let inClass = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    const classMatch = line.match(classPattern);
    const funMatch = line.match(funPattern);

    // Track brace depth
    braceCount += (line.match(/{/g) || []).length;
    braceCount -= (line.match(/}/g) || []).length;

    if (classMatch || funMatch) {
      // Save previous chunk if substantial
      if (currentChunk.length > 5) {
        chunks.push({
          content: currentChunk.join("\n"),
          symbols: [...new Set(currentSymbols)],
          startLine: currentStartLine,
          endLine: lineNum - 1,
          type: inClass ? "class" : "module",
        });
      }

      currentChunk = [line];
      currentSymbols = classMatch ? [classMatch[1]!] : [funMatch![1]!];
      currentStartLine = lineNum;
      inClass = !!classMatch;
    } else {
      currentChunk.push(line);

      // Extract additional symbols from the line
      const symbols = extractKotlinSymbols(line);
      currentSymbols.push(...symbols);
    }

    // If chunk is getting large, split it
    if (currentChunk.join("\n").length > CHUNK_SIZE && braceCount === 0) {
      chunks.push({
        content: currentChunk.join("\n"),
        symbols: [...new Set(currentSymbols)],
        startLine: currentStartLine,
        endLine: lineNum,
        type: inClass ? "class" : "function",
      });
      currentChunk = [];
      currentSymbols = [];
      currentStartLine = lineNum + 1;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join("\n"),
      symbols: [...new Set(currentSymbols)],
      startLine: currentStartLine,
      endLine: lines.length,
      type: "block",
    });
  }

  // Merge small chunks
  return mergeSmallChunks(chunks);
}

/**
 * Chunk TypeScript code by class/function boundaries.
 */
function chunkTypeScript(content: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split("\n");

  // Regex patterns for TypeScript
  const classPattern = /^(?:export\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+(\w+)/;
  const funPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/;
  const constFunPattern = /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/;

  let currentChunk: string[] = [];
  let currentSymbols: string[] = [];
  let currentStartLine = 1;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    const classMatch = line.match(classPattern);
    const funMatch = line.match(funPattern);
    const constFunMatch = line.match(constFunPattern);

    // Track brace depth
    braceCount += (line.match(/{/g) || []).length;
    braceCount -= (line.match(/}/g) || []).length;

    if (classMatch || funMatch || constFunMatch) {
      // Save previous chunk
      if (currentChunk.length > 5) {
        chunks.push({
          content: currentChunk.join("\n"),
          symbols: [...new Set(currentSymbols)],
          startLine: currentStartLine,
          endLine: lineNum - 1,
          type: "module",
        });
      }

      const symbol = classMatch?.[1] || funMatch?.[1] || constFunMatch?.[1];
      currentChunk = [line];
      currentSymbols = symbol ? [symbol] : [];
      currentStartLine = lineNum;
    } else {
      currentChunk.push(line);

      const symbols = extractTsSymbols(line);
      currentSymbols.push(...symbols);
    }

    // Split large chunks at safe boundaries
    if (currentChunk.join("\n").length > CHUNK_SIZE && braceCount === 0) {
      chunks.push({
        content: currentChunk.join("\n"),
        symbols: [...new Set(currentSymbols)],
        startLine: currentStartLine,
        endLine: lineNum,
        type: "function",
      });
      currentChunk = [];
      currentSymbols = [];
      currentStartLine = lineNum + 1;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join("\n"),
      symbols: [...new Set(currentSymbols)],
      startLine: currentStartLine,
      endLine: lines.length,
      type: "block",
    });
  }

  return mergeSmallChunks(chunks);
}

/**
 * Simple line-based chunking fallback.
 */
function chunkByLines(content: string): CodeChunk[] {
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];
  const linesPerChunk = Math.ceil(CHUNK_SIZE / 50); // ~50 chars per line estimate

  for (let i = 0; i < lines.length; i += linesPerChunk - 5) {
    const chunkLines = lines.slice(i, i + linesPerChunk);
    const chunkContent = chunkLines.join("\n");

    if (chunkContent.trim().length > 20) {
      chunks.push({
        content: chunkContent,
        symbols: [],
        startLine: i + 1,
        endLine: Math.min(i + linesPerChunk, lines.length),
        type: "block",
      });
    }
  }

  return chunks;
}

/**
 * Merge chunks that are too small.
 */
function mergeSmallChunks(chunks: CodeChunk[]): CodeChunk[] {
  const merged: CodeChunk[] = [];
  const minSize = 100; // Minimum chunk size

  for (const chunk of chunks) {
    if (chunk.content.length < minSize && merged.length > 0) {
      // Merge with previous chunk
      const prev = merged[merged.length - 1]!;
      prev.content += "\n" + chunk.content;
      prev.symbols = [...new Set([...prev.symbols, ...chunk.symbols])];
      prev.endLine = chunk.endLine;
    } else if (chunk.content.trim().length > 20) {
      merged.push(chunk);
    }
  }

  return merged;
}
