// ============================================
// Answer Cache — Store detailed answers for "More details" retrieval
// ============================================

import { logger } from "./logger.js";

interface CachedAnswer {
  detailedAnswer: string;
  threadTs: string;
  channelId: string;
  createdAt: number;
}

// In-memory cache with TTL of 24 hours
const cache = new Map<string, CachedAnswer>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Store a detailed answer for later retrieval.
 */
export function cacheDetailedAnswer(
  requestId: string,
  detailedAnswer: string,
  threadTs: string,
  channelId: string
): void {
  cache.set(requestId, {
    detailedAnswer,
    threadTs,
    channelId,
    createdAt: Date.now(),
  });

  logger.info("Cached detailed answer", {
    stage: "slack",
    requestId,
    answerLength: detailedAnswer.length,
  });

  // Cleanup old entries
  cleanupExpired();
}

/**
 * Retrieve a cached detailed answer.
 */
export function getCachedAnswer(requestId: string): CachedAnswer | null {
  const entry = cache.get(requestId);

  if (!entry) {
    logger.info("Cache miss for detailed answer", {
      stage: "slack",
      requestId,
    });
    return null;
  }

  // Check if expired
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(requestId);
    logger.info("Cache entry expired", {
      stage: "slack",
      requestId,
    });
    return null;
  }

  logger.info("Cache hit for detailed answer", {
    stage: "slack",
    requestId,
  });

  return entry;
}

/**
 * Remove expired entries from cache.
 */
function cleanupExpired(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of cache.entries()) {
    if (now - entry.createdAt > TTL_MS) {
      cache.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info("Cleaned up expired cache entries", {
      stage: "slack",
      cleanedCount: cleaned,
      remainingCount: cache.size,
    });
  }
}
