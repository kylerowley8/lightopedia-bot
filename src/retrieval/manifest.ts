// ============================================
// Article Manifest — Curated KB hierarchy from GitHub
// Fetches help-article-hierarchy.md, caches with 5-min TTL
// ============================================

import { logger } from "../lib/logger.js";

const GITHUB_REPO = "light-space/help-articles";
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/main`;
const KB_HIERARCHY_URL = `${GITHUB_RAW_BASE}/help-article-hierarchy.md`;

// ============================================
// Cache
// ============================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedHierarchy: string | null = null;
let cacheTimestamp = 0;

/**
 * Invalidate the manifest cache.
 * Called after reindexing via GitHub webhook.
 */
export function invalidateManifestCache(): void {
  cachedHierarchy = null;
  cacheTimestamp = 0;
  logger.info("Manifest cache invalidated", { stage: "retrieval" });
}

// ============================================
// Hierarchy Fetching
// ============================================

/**
 * Fetch the curated KB hierarchy from GitHub.
 * Returns the raw markdown text — a structured table of contents
 * with article titles and GitHub URLs organized by category.
 *
 * ~136 articles in 174 lines — compact enough for the LLM to browse.
 */
export async function fetchKBHierarchy(): Promise<string> {
  // Return cached if fresh
  if (cachedHierarchy && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedHierarchy;
  }

  logger.info("Fetching KB hierarchy from GitHub", { stage: "retrieval" });

  try {
    const response = await fetch(KB_HIERARCHY_URL, {
      headers: { "User-Agent": "Lightopedia-Bot" },
    });

    if (!response.ok) {
      logger.error("Failed to fetch KB hierarchy", {
        stage: "retrieval",
        status: response.status,
      });
      // Return stale cache if available
      if (cachedHierarchy) return cachedHierarchy;
      return "";
    }

    const text = await response.text();

    // Cache
    cachedHierarchy = text;
    cacheTimestamp = Date.now();

    logger.info("KB hierarchy fetched", {
      stage: "retrieval",
      length: text.length,
    });

    return text;
  } catch (err) {
    logger.error("Error fetching KB hierarchy", {
      stage: "retrieval",
      error: err,
    });
    // Return stale cache if available
    if (cachedHierarchy) return cachedHierarchy;
    return "";
  }
}

// ============================================
// URL Utilities
// ============================================

/**
 * Convert a GitHub blob URL to a raw content URL.
 * e.g., https://github.com/light-space/help-articles/blob/main/articles/01-getting-started/1-1-what-is-light.md
 *   ->  https://raw.githubusercontent.com/light-space/help-articles/main/articles/01-getting-started/1-1-what-is-light.md
 */
export function githubBlobToRaw(url: string): string {
  return url.replace(
    "https://github.com/light-space/help-articles/blob/main/",
    `${GITHUB_RAW_BASE}/`
  );
}

/**
 * Convert a GitHub blob URL to a help.light.inc URL.
 * e.g., https://github.com/light-space/help-articles/blob/main/articles/08-expense-management/8-11-virtual-cards.md
 *   ->  https://help.light.inc/knowledge-base/virtual-cards
 *
 * Note: The slug mapping is approximate — help site slugs don't always match
 * the GitHub filenames. This is used for Firecrawl scraping attempts.
 */
export function githubBlobToHelpUrl(url: string): string {
  // Extract the filename part and clean it
  const match = url.match(/\/articles\/[^/]+\/[\d-]+(.+)\.md$/);
  if (match) {
    return `https://help.light.inc/knowledge-base/${match[1]}`;
  }
  return url;
}
