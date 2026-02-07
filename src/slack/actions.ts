// ============================================
// Slack Actions — Button and interaction handlers
// ============================================

import { logger } from "../lib/logger.js";
import { supabase } from "../db/supabase.js";
import { getCachedAnswer } from "../lib/answerCache.js";

/**
 * Action types.
 */
export type ActionType =
  | "show_more_details"
  | "feedback_helpful"
  | "feedback_not_helpful";

/**
 * Action handler result.
 */
export type ActionResult = {
  success: boolean;
  updateMessage?: boolean;
  blocks?: unknown[];
  error?: string;
  /** For show_more_details: the detailed answer to post as a reply */
  detailedReply?: {
    text: string;
    threadTs: string;
    channelId: string;
  };
};

/**
 * Handle a Slack action (button click).
 */
export async function handleAction(
  actionId: string,
  value: string,
  userId: string
): Promise<ActionResult> {
  logger.info("Handling action", {
    stage: "slack",
    actionId,
    userId,
    value: value.slice(0, 50),
  });

  switch (actionId) {
    case "feedback_helpful":
      return handleFeedback(value, "helpful", userId);

    case "feedback_not_helpful":
      return handleFeedback(value, "not_helpful", userId);

    case "show_more_details":
      return handleShowMoreDetails(value, userId);

    default:
      logger.warn("Unknown action", { stage: "slack", actionId });
      return { success: false, error: "Unknown action" };
  }
}

/**
 * Handle feedback submission.
 * Stores to Supabase for analysis.
 */
async function handleFeedback(
  requestId: string,
  label: "helpful" | "not_helpful",
  userId: string
): Promise<ActionResult> {
  try {
    await supabase.from("feedback").insert({
      request_id: requestId,
      label,
      user_id: userId,
      created_at: new Date().toISOString(),
    });

    logger.info("Feedback stored", {
      stage: "slack",
      requestId,
      label,
      userId,
    });

    return { success: true };
  } catch (err) {
    logger.error("Failed to store feedback", {
      stage: "slack",
      requestId,
      error: err,
    });
    return { success: false, error: "Failed to record feedback" };
  }
}

/**
 * Handle "More details" button.
 * Retrieves cached detailed answer and returns it for posting as a reply.
 */
async function handleShowMoreDetails(
  requestId: string,
  userId: string
): Promise<ActionResult> {
  logger.info("Show more details requested", {
    stage: "slack",
    requestId,
    userId,
  });

  const cached = getCachedAnswer(requestId);

  if (!cached) {
    logger.warn("No cached detailed answer found", {
      stage: "slack",
      requestId,
    });
    return {
      success: false,
      error: "Details no longer available. Please ask your question again.",
    };
  }

  return {
    success: true,
    detailedReply: {
      text: cached.detailedAnswer,
      threadTs: cached.threadTs,
      channelId: cached.channelId,
    },
  };
}

/**
 * Store reaction feedback.
 * Called when users react with ✅, ⚠️, or ❓.
 */
export async function storeReactionFeedback(
  requestId: string,
  reaction: string,
  userId: string
): Promise<void> {
  // Map reactions to labels
  const labelMap: Record<string, string> = {
    white_check_mark: "helpful",
    warning: "incorrect",
    question: "needs_context",
  };

  const label = labelMap[reaction];
  if (!label) return;

  try {
    await supabase.from("feedback").insert({
      request_id: requestId,
      label,
      user_id: userId,
      source: "reaction",
      created_at: new Date().toISOString(),
    });

    logger.info("Reaction feedback stored", {
      stage: "slack",
      requestId,
      reaction,
      label,
    });
  } catch (err) {
    logger.error("Failed to store reaction feedback", {
      stage: "slack",
      requestId,
      error: err,
    });
  }
}
