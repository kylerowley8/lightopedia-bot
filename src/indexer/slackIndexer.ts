// ============================================
// Slack Indexer — V2 #lightopedia Thread Indexing
// ============================================
// Indexes curated threads from #lightopedia only.
// See INDEXING_SCOPE.md for channel allowlist.

import { supabase } from "../db/supabase.js";
import { embedChunks } from "../retrieval/embeddings.js";
import { logger } from "../lib/logger.js";
import { RETRIEVAL_VERSION } from "../evidence/types.js";
import { isAllowedSlackChannel, ALLOWED_SLACK_CHANNELS } from "./config.js";
import crypto from "crypto";

// ============================================
// Types
// ============================================

export interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  reply_count?: number;
  thread_ts?: string;
}

export interface SlackThread {
  parentTs: string;
  messages: SlackMessage[];
  permalink?: string;
}

export interface IndexSlackResult {
  threadsIndexed: number;
  skipped: number;
  errors: string[];
  indexRunId: string;
}

interface SlackThreadInsert {
  content: string;
  embedding: number[];
  metadata: {
    source_type: "slack";
    permalink: string;
    topic: string;
    channel: string;
    parent_ts: string;
    reply_count: number;
    indexed_at: string;
    index_run_id: string;
    retrieval_program_version: string;
  };
}

/**
 * Slack Web Client interface for indexing.
 */
export interface SlackIndexerClient {
  conversations: {
    history: (params: {
      channel: string;
      limit?: number;
      cursor?: string;
      oldest?: string;
    }) => Promise<{
      ok: boolean;
      messages?: SlackMessage[];
      response_metadata?: { next_cursor?: string };
      error?: string;
    }>;
    replies: (params: {
      channel: string;
      ts: string;
      limit?: number;
    }) => Promise<{
      ok: boolean;
      messages?: SlackMessage[];
      error?: string;
    }>;
  };
  chat: {
    getPermalink: (params: {
      channel: string;
      message_ts: string;
    }) => Promise<{
      ok: boolean;
      permalink?: string;
      error?: string;
    }>;
  };
}

// ============================================
// Configuration
// ============================================

const MIN_THREAD_REPLIES = 1; // Require at least 1 reply
const MAX_THREADS_PER_RUN = 100;
const CONTENT_MIN_LENGTH = 50; // Skip threads with very little content

// ============================================
// Main Indexing Functions
// ============================================

/**
 * Index threads from #lightopedia channel.
 */
export async function indexLightopediaChannel(
  client: SlackIndexerClient,
  options?: {
    force?: boolean;
    sinceTs?: string; // Only index threads newer than this timestamp
    maxThreads?: number;
  }
): Promise<IndexSlackResult> {
  const channelId = ALLOWED_SLACK_CHANNELS.lightopedia;
  const indexRunId = crypto.randomUUID();
  const maxThreads = options?.maxThreads ?? MAX_THREADS_PER_RUN;

  const result: IndexSlackResult = {
    threadsIndexed: 0,
    skipped: 0,
    errors: [],
    indexRunId,
  };

  logger.info("Starting Slack indexing", {
    stage: "indexer",
    channel: channelId,
    indexRunId,
  });

  // Validate channel is allowed
  if (!isAllowedSlackChannel(channelId)) {
    result.errors.push(`Channel ${channelId} not in allowlist`);
    return result;
  }

  // Fetch channel history
  const threads = await fetchThreadsWithReplies(client, channelId, {
    sinceTs: options?.sinceTs,
    maxThreads,
  });

  logger.info("Found threads to index", {
    stage: "indexer",
    threadCount: threads.length,
    channelId,
  });

  // Process threads in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < threads.length; i += BATCH_SIZE) {
    const batch = threads.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (thread) => {
        try {
          const indexed = await indexThread(
            thread,
            channelId,
            indexRunId,
            options?.force
          );
          if (indexed) {
            result.threadsIndexed++;
          } else {
            result.skipped++;
          }
        } catch (err) {
          const msg = `Failed to index thread ${thread.parentTs}: ${err}`;
          logger.error(msg, { stage: "indexer" });
          result.errors.push(msg);
        }
      })
    );
  }

  logger.info("Slack indexing complete", {
    stage: "indexer",
    channelId,
    indexRunId,
    threadsIndexed: result.threadsIndexed,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Fetch threads with at least MIN_THREAD_REPLIES replies.
 */
async function fetchThreadsWithReplies(
  client: SlackIndexerClient,
  channelId: string,
  options?: { sinceTs?: string; maxThreads?: number }
): Promise<SlackThread[]> {
  const threads: SlackThread[] = [];
  let cursor: string | undefined;
  const maxThreads = options?.maxThreads ?? MAX_THREADS_PER_RUN;

  while (threads.length < maxThreads) {
    const historyResult = await client.conversations.history({
      channel: channelId,
      limit: 100,
      cursor,
      oldest: options?.sinceTs,
    });

    if (!historyResult.ok || !historyResult.messages) {
      logger.error("Failed to fetch channel history", {
        stage: "indexer",
        channelId,
        error: historyResult.error,
      });
      break;
    }

    // Filter for messages with threads
    const threadParents = historyResult.messages.filter(
      (m) => m.reply_count && m.reply_count >= MIN_THREAD_REPLIES
    );

    // Fetch full thread content for each
    for (const parent of threadParents) {
      if (threads.length >= maxThreads) break;

      const repliesResult = await client.conversations.replies({
        channel: channelId,
        ts: parent.ts,
        limit: 50,
      });

      if (repliesResult.ok && repliesResult.messages) {
        // Get permalink
        let permalink: string | undefined;
        try {
          const permalinkResult = await client.chat.getPermalink({
            channel: channelId,
            message_ts: parent.ts,
          });
          if (permalinkResult.ok) {
            permalink = permalinkResult.permalink;
          }
        } catch {
          // Permalink is optional
        }

        threads.push({
          parentTs: parent.ts,
          messages: repliesResult.messages,
          permalink,
        });
      }
    }

    // Check for more pages
    cursor = historyResult.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return threads;
}

/**
 * Index a single thread.
 */
async function indexThread(
  thread: SlackThread,
  channelId: string,
  indexRunId: string,
  force?: boolean
): Promise<boolean> {
  // Check if already indexed (unless force)
  if (!force) {
    const { data: existing } = await supabase
      .from("slack_threads")
      .select("id")
      .eq("metadata->>parent_ts", thread.parentTs)
      .eq("metadata->>channel", channelId)
      .limit(1);

    if (existing && existing.length > 0) {
      return false; // Already indexed
    }
  }

  // Build content from messages
  const content = buildThreadContent(thread);
  if (content.length < CONTENT_MIN_LENGTH) {
    return false; // Not enough content
  }

  // Extract topic from first message
  const topic = extractTopic(thread);

  // Delete old version if exists
  await supabase
    .from("slack_threads")
    .delete()
    .eq("metadata->>parent_ts", thread.parentTs)
    .eq("metadata->>channel", channelId);

  // Generate embedding
  const [embedding] = await embedChunks([content]);

  // Build row for insertion
  const now = new Date().toISOString();
  const row: SlackThreadInsert = {
    content,
    embedding: embedding!,
    metadata: {
      source_type: "slack",
      permalink: thread.permalink ?? "",
      topic,
      channel: channelId,
      parent_ts: thread.parentTs,
      reply_count: thread.messages.length - 1, // Exclude parent
      indexed_at: now,
      index_run_id: indexRunId,
      retrieval_program_version: RETRIEVAL_VERSION,
    },
  };

  // Insert
  const { error } = await supabase.from("slack_threads").insert(row);

  if (error) {
    throw error;
  }

  logger.info("Indexed Slack thread", {
    stage: "indexer",
    parentTs: thread.parentTs,
    topic: topic.slice(0, 50),
    replyCount: thread.messages.length - 1,
  });

  return true;
}

/**
 * Build thread content from messages.
 * Formats as Q&A style for better embedding.
 */
function buildThreadContent(thread: SlackThread): string {
  const lines: string[] = [];

  for (const msg of thread.messages) {
    if (!msg.text) continue;

    // Clean up Slack formatting
    const cleanText = cleanSlackText(msg.text);
    if (!cleanText) continue;

    // Label as Q or A based on position
    const isFirst = msg.ts === thread.parentTs;
    const prefix = isFirst ? "Q:" : "A:";
    lines.push(`${prefix} ${cleanText}`);
  }

  return lines.join("\n\n");
}

/**
 * Extract topic from first message.
 */
function extractTopic(thread: SlackThread): string {
  const firstMessage = thread.messages.find((m) => m.ts === thread.parentTs);
  if (!firstMessage?.text) {
    return "Lightopedia thread";
  }

  const cleaned = cleanSlackText(firstMessage.text);
  // Take first sentence or first 80 chars
  const firstSentence = cleaned.split(/[.!?]/)[0] ?? cleaned;
  return firstSentence.slice(0, 80).trim();
}

/**
 * Clean Slack-formatted text.
 */
function cleanSlackText(text: string): string {
  return text
    .replace(/<@[^>]+>/g, "") // Remove user mentions
    .replace(/<#[^|]+\|([^>]+)>/g, "#$1") // Convert channel links
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2") // Convert labeled links
    .replace(/<([^>]+)>/g, "$1") // Convert plain links
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Purge all threads from a specific indexing run.
 */
export async function purgeSlackIndexRun(indexRunId: string): Promise<number> {
  const { data, error } = await supabase
    .from("slack_threads")
    .delete()
    .eq("metadata->>index_run_id", indexRunId)
    .select("id");

  if (error) {
    logger.error("Failed to purge Slack index run", {
      stage: "indexer",
      indexRunId,
      error: error.message,
    });
    throw error;
  }

  const count = data?.length ?? 0;
  logger.info("Purged Slack index run", {
    stage: "indexer",
    indexRunId,
    threadsDeleted: count,
  });

  return count;
}
