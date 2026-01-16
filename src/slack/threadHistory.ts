import type { ConversationHistory, ConversationMessage } from "../types/index.js";
import { logger } from "../lib/logger.js";

// ============================================
// Thread History Fetcher
// Retrieves conversation context from Slack threads
// ============================================

/** Slack client interface for thread fetching */
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

/** Max messages to include in context (most recent) */
const MAX_CONTEXT_MESSAGES = 6;

/** Bot user ID pattern - messages from our bot */
const BOT_MESSAGE_SUBTYPES = ["bot_message"];

/**
 * Fetch conversation history from a Slack thread.
 * Returns the most recent messages, alternating user/assistant roles.
 */
export async function getThreadHistory(
  client: SlackWebClient,
  channel: string,
  threadTs: string,
  currentMessageTs: string,
  botUserId?: string
): Promise<ConversationHistory> {
  try {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 50, // Fetch more than needed, we'll filter
    });

    if (!result.ok || !result.messages) {
      logger.warn("Failed to fetch thread history", {
        stage: "slack",
        channel,
        threadTs,
        error: result.error,
      });
      return { messages: [], isFollowUp: false };
    }

    // Filter and transform messages
    const messages: ConversationMessage[] = [];

    for (const msg of result.messages) {
      // Skip the current message we're responding to
      if (msg.ts === currentMessageTs) continue;

      // Skip messages without text
      if (!msg.text) continue;

      // Determine if this is a bot message
      const isBotMessage =
        msg.bot_id !== undefined ||
        BOT_MESSAGE_SUBTYPES.includes(msg.subtype || "") ||
        (botUserId && msg.user === botUserId);

      // Clean the message text (remove bot mentions)
      const cleanText = msg.text.replace(/<@[^>]+>\s*/g, "").trim();
      if (!cleanText) continue;

      messages.push({
        role: isBotMessage ? "assistant" : "user",
        content: cleanText,
        timestamp: msg.ts,
      });
    }

    // Sort by timestamp (oldest first for context)
    messages.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));

    // Take only the most recent messages
    const recentMessages = messages.slice(-MAX_CONTEXT_MESSAGES);

    // It's a follow-up if there are previous messages in the thread
    const isFollowUp = recentMessages.length > 0;

    logger.debug("Fetched thread history", {
      stage: "slack",
      channel,
      threadTs,
      totalMessages: messages.length,
      includedMessages: recentMessages.length,
      isFollowUp,
    });

    return {
      messages: recentMessages,
      isFollowUp,
    };
  } catch (err) {
    logger.error("Error fetching thread history", {
      stage: "slack",
      channel,
      threadTs,
      error: err,
    });
    return { messages: [], isFollowUp: false };
  }
}

/**
 * Format conversation history for inclusion in LLM prompt.
 * Returns a string suitable for appending to the user message.
 */
export function formatConversationContext(history: ConversationHistory): string {
  if (!history.isFollowUp || history.messages.length === 0) {
    return "";
  }

  const lines = ["CONVERSATION HISTORY (for context on follow-up questions):"];

  for (const msg of history.messages) {
    const role = msg.role === "user" ? "User" : "Assistant";
    // Truncate long messages to avoid context bloat
    const content = msg.content.length > 500 ? msg.content.slice(0, 500) + "..." : msg.content;
    lines.push(`${role}: ${content}`);
  }

  lines.push("---");
  lines.push("Now answer the current question, using the conversation history above for context if relevant.");

  return lines.join("\n");
}
