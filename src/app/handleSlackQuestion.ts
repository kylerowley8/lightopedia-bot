// ============================================
// Slack Question Handler — Single entrypoint
// Thin shell around the pipeline
// ============================================

import { executePipeline } from "./pipeline.js";
import { renderNonTechnical, renderFallback } from "../slack/renderNonTechnical.js";
import { logger } from "../lib/logger.js";
import { wrapError, getUserMessage } from "../lib/errors.js";
import type { SlackInput, SlackResponse } from "./types.js";
import type { ThreadMessage } from "../router/types.js";

/**
 * Handle a Slack question.
 *
 * This is the SINGLE entrypoint for all Slack interactions.
 * Slack event handlers should call this, not the pipeline directly.
 */
export async function handleSlackQuestion(
  input: SlackInput,
  threadHistory: ThreadMessage[] = []
): Promise<SlackResponse> {
  try {
    // Execute the pipeline
    const result = await executePipeline(input, threadHistory);

    // Render non-technical response (default)
    return renderNonTechnical(result);
  } catch (err) {
    // Log and return user-friendly error
    const appError = wrapError(err);

    logger.error("Question handling failed", {
      stage: "slack",
      userId: input.userId,
      channelId: input.channelId,
      error: err,
    });

    return renderFallback(getUserMessage(appError));
  }
}

/**
 * Fetch thread history from Slack.
 * Returns messages in order, with role classification.
 */
export async function fetchThreadHistory(
  client: SlackWebClient,
  channelId: string,
  threadTs: string,
  currentMessageTs: string,
  botUserId?: string
): Promise<ThreadMessage[]> {
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 50,
    });

    if (!result.ok || !result.messages) {
      logger.warn("Failed to fetch thread history", {
        stage: "slack",
        channelId,
        threadTs,
        error: result.error,
      });
      return [];
    }

    const messages: ThreadMessage[] = [];

    for (const msg of result.messages) {
      // Skip current message
      if (msg.ts === currentMessageTs) continue;

      // Skip messages without text
      if (!msg.text) continue;

      // Determine role
      const isBotMessage =
        msg.bot_id !== undefined ||
        (botUserId !== undefined && msg.user === botUserId);

      // Clean text (remove bot mentions)
      const cleanText = msg.text.replace(/<@[^>]+>\s*/g, "").trim();
      if (!cleanText) continue;

      messages.push({
        role: isBotMessage ? "assistant" : "user",
        content: cleanText,
        timestamp: msg.ts,
      });
    }

    // Sort by timestamp (oldest first)
    messages.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));

    // Return most recent messages
    return messages.slice(-6);
  } catch (err) {
    logger.error("Error fetching thread history", {
      stage: "slack",
      channelId,
      threadTs,
      error: err,
    });
    return [];
  }
}

/**
 * Slack Web Client interface (minimal).
 */
interface SlackWebClient {
  conversations: {
    replies: (params: {
      channel: string;
      ts: string;
      limit?: number;
    }) => Promise<{
      ok: boolean;
      messages?: Array<{
        type: string;
        user?: string;
        bot_id?: string;
        text?: string;
        ts: string;
        subtype?: string;
      }>;
      error?: string;
    }>;
  };
}
