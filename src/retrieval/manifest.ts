// ============================================
// Article Manifest — Lightweight article index for agentic loop
// Queries docs table, groups by path, caches with 5-min TTL
// ============================================

import { supabase } from "../db/supabase.js";
import { logger } from "../lib/logger.js";

/**
 * A single entry in the article manifest.
 * Lightweight representation for the LLM to browse.
 */
export interface ManifestEntry {
  /** File path (e.g., "getting-started/invoicing.md") */
  path: string;
  /** Human-readable title */
  title: string;
  /** Category derived from path (e.g., "getting-started") */
  category: string;
  /** First sentence of article content */
  firstSentence: string;
}

// ============================================
// Cache
// ============================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedManifest: ManifestEntry[] | null = null;
let cacheTimestamp = 0;

/**
 * Invalidate the manifest cache.
 * Called after reindexing via GitHub webhook.
 */
export function invalidateManifestCache(): void {
  cachedManifest = null;
  cacheTimestamp = 0;
  logger.info("Manifest cache invalidated", { stage: "retrieval" });
}

// ============================================
// Manifest Generation
// ============================================

interface DocsRow {
  id: string;
  content: string;
  metadata: Record<string, string | undefined> | null;
}

/**
 * Generate the article manifest.
 * Queries all docs, groups chunks by path, extracts title + first sentence.
 * Returns a compact list for the LLM to browse (~20 words per entry).
 */
export async function generateManifest(): Promise<ManifestEntry[]> {
  // Return cached if fresh
  if (cachedManifest && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedManifest;
  }

  logger.info("Generating article manifest", { stage: "retrieval" });

  const { data, error } = await supabase
    .from("docs")
    .select("id, content, metadata")
    .order("id", { ascending: true });

  if (error) {
    logger.error("Failed to fetch docs for manifest", {
      stage: "retrieval",
      error: error.message,
    });
    // Return stale cache if available
    if (cachedManifest) return cachedManifest;
    return [];
  }

  const rows = (data ?? []) as DocsRow[];

  // Group chunks by path, keeping first chunk for summary
  const pathMap = new Map<string, { title: string; content: string }>();

  for (const row of rows) {
    const meta = row.metadata ?? {};
    const path = meta["path"] ?? meta["source"] ?? "unknown";

    if (!pathMap.has(path)) {
      const title = meta["title"] ?? extractTitleFromPath(path);
      pathMap.set(path, { title, content: row.content });
    }
  }

  // Build manifest entries
  const manifest: ManifestEntry[] = [];

  for (const [path, { title, content }] of pathMap) {
    if (path === "unknown") continue;

    const category = extractCategory(path);
    const firstSentence = extractFirstSentence(content);

    manifest.push({ path, title, category, firstSentence });
  }

  // Sort by category then title for readability
  manifest.sort((a, b) =>
    a.category === b.category
      ? a.title.localeCompare(b.title)
      : a.category.localeCompare(b.category)
  );

  // Cache
  cachedManifest = manifest;
  cacheTimestamp = Date.now();

  logger.info("Article manifest generated", {
    stage: "retrieval",
    articleCount: manifest.length,
    categories: [...new Set(manifest.map((m) => m.category))].length,
  });

  return manifest;
}

// ============================================
// Utilities
// ============================================

function extractTitleFromPath(path: string): string {
  if (!path) return "Help Article";
  const filename = path.split("/").pop() ?? path;
  const name = filename.replace(/\.(md|mdx)$/i, "");
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractCategory(path: string): string {
  const parts = path.split("/");
  if (parts.length > 1) {
    return parts[0]!
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "General";
}

function extractFirstSentence(content: string): string {
  // Skip markdown headers and blank lines
  const lines = content.split("\n");
  let text = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      text = trimmed;
      break;
    }
  }

  if (!text) return "";

  // Extract first sentence (up to first period followed by space or end)
  const match = text.match(/^(.+?\.)\s/);
  if (match) {
    return match[1]!.slice(0, 150);
  }

  // No sentence boundary — return first 150 chars
  return text.slice(0, 150);
}
