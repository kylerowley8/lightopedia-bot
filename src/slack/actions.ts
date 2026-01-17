// ============================================
// Slack Actions — Button and interaction handlers
// ============================================

import { logger } from "../lib/logger.js";
import { supabase } from "../db/supabase.js";

/**
 * Action types.
 */
export type ActionType =
  | "show_technical"
  | "hide_technical"
  | "feedback_helpful"
  | "feedback_not_helpful"
  | "trace_api"
  | "trace_domain";

/**
 * Action handler result.
 */
export type ActionResult = {
  success: boolean;
  updateMessage?: boolean;
  blocks?: unknown[];
  error?: string;
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

    case "show_technical":
      return handleShowTechnical(value, userId);

    case "hide_technical":
      return handleHideTechnical(value, userId);

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
 * Handle "Show technical details" button.
 * Returns flag to trigger technical view rendering.
 */
async function handleShowTechnical(
  value: string,
  userId: string
): Promise<ActionResult> {
  try {
    const { requestId } = JSON.parse(value) as { requestId: string };

    logger.info("Show technical requested", {
      stage: "slack",
      requestId,
      userId,
    });

    // In a full implementation, we would:
    // 1. Look up the cached pipeline result by requestId
    // 2. Re-render with renderTechnical()
    // 3. Return the updated blocks

    // For now, just acknowledge
    return {
      success: true,
      updateMessage: true,
      // blocks would be populated from cache
    };
  } catch (err) {
    logger.error("Failed to parse show_technical value", {
      stage: "slack",
      value,
      error: err,
    });
    return { success: false, error: "Invalid action data" };
  }
}

/**
 * Handle "Back to summary" button.
 */
async function handleHideTechnical(
  requestId: string,
  userId: string
): Promise<ActionResult> {
  logger.info("Hide technical requested", {
    stage: "slack",
    requestId,
    userId,
  });

  // Would re-render with renderNonTechnical()
  return {
    success: true,
    updateMessage: true,
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
