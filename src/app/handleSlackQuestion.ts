// ============================================
// Slack Question Handler — Single entrypoint
// Thin shell around the agentic pipeline
// ============================================

import { executeAgenticPipeline } from "../agent/loop.js";
import { renderNonTechnical, renderFallback } from "../slack/renderNonTechnical.js";
import { logger } from "../lib/logger.js";
import { wrapError, getUserMessage } from "../lib/errors.js";
import type { SlackInput, SlackResponse } from "./types.js";
import type { ThreadHistoryMessage } from "./types.js";
import type { UserContext } from "../llm/prompts.js";

/**
 * Extended response that includes metadata for caching.
 */
export interface SlackQuestionResult {
  response: SlackResponse;
  requestId: string;
  detailedAnswer?: string;
}

/**
 * Handle a Slack question.
 *
 * This is the SINGLE entrypoint for all Slack interactions.
 * Slack event handlers should call this, not the pipeline directly.
 */
export async function handleSlackQuestion(
  input: SlackInput,
  threadHistory: ThreadHistoryMessage[] = [],
  userContext?: UserContext
): Promise<SlackQuestionResult> {
  try {
    // Execute the agentic pipeline
    const result = await executeAgenticPipeline({
      input,
      threadHistory,
      userContext,
    });

    // Render non-technical response
    const response = renderNonTechnical(result);

    return {
      response,
      requestId: result.metadata.requestId,
      detailedAnswer: result.answer.detailedAnswer,
    };
  } catch (err) {
    // Log and return user-friendly error
    const appError = wrapError(err);

    logger.error("Question handling failed", {
      stage: "slack",
      userId: input.userId,
      channelId: input.channelId,
      error: err,
    });

    return {
      response: renderFallback(getUserMessage(appError)),
      requestId: "error",
    };
  }
}
