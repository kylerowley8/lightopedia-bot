// ============================================
// Feedback Store — V2 User Feedback Persistence
// ============================================
// Stores and retrieves feedback for quality tracking.

import { supabase } from "../db/supabase.js";
import { logger } from "../lib/logger.js";

// ============================================
// Types
// ============================================

export type FeedbackType = "helpful" | "not_helpful";

export interface FeedbackRecord {
  requestId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  feedbackType: FeedbackType;
  question?: string;
  routeMode?: string;
  docsCount?: number;
  slackCount?: number;
  topSimilarity?: number;
}

export interface FeedbackStats {
  total: number;
  helpful: number;
  notHelpful: number;
  helpfulRate: number;
}

// ============================================
// Store Feedback
// ============================================

/**
 * Store user feedback.
 */
export async function storeFeedback(feedback: FeedbackRecord): Promise<boolean> {
  const { error } = await supabase.from("feedback").insert({
    request_id: feedback.requestId,
    channel_id: feedback.channelId,
    thread_ts: feedback.threadTs,
    message_ts: feedback.messageTs,
    user_id: feedback.userId,
    feedback_type: feedback.feedbackType,
    question: feedback.question,
    route_mode: feedback.routeMode,
    docs_count: feedback.docsCount,
    slack_count: feedback.slackCount,
    top_similarity: feedback.topSimilarity,
  });

  if (error) {
    logger.error("Failed to store feedback", {
      stage: "slack",
      requestId: feedback.requestId,
      error: error.message,
    });
    return false;
  }

  logger.info("Feedback stored", {
    stage: "slack",
    requestId: feedback.requestId,
    feedbackType: feedback.feedbackType,
    userId: feedback.userId,
  });

  return true;
}

// ============================================
// Query Feedback
// ============================================

/**
 * Get feedback stats for a time period.
 */
export async function getFeedbackStats(
  sinceDate?: Date
): Promise<FeedbackStats | null> {
  let query = supabase.from("feedback").select("feedback_type");

  if (sinceDate) {
    query = query.gte("created_at", sinceDate.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    logger.error("Failed to get feedback stats", {
      stage: "slack",
      error: error.message,
    });
    return null;
  }

  const total = data?.length ?? 0;
  const helpful = data?.filter((f) => f.feedback_type === "helpful").length ?? 0;
  const notHelpful = total - helpful;

  return {
    total,
    helpful,
    notHelpful,
    helpfulRate: total > 0 ? helpful / total : 0,
  };
}

/**
 * Check if user already gave feedback for a request.
 */
export async function hasUserFeedback(
  requestId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("feedback")
    .select("id")
    .eq("request_id", requestId)
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    return false;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Get recent feedback for debugging.
 */
export async function getRecentFeedback(
  limit: number = 20
): Promise<FeedbackRecord[]> {
  const { data, error } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("Failed to get recent feedback", {
      stage: "slack",
      error: error.message,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    requestId: row.request_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    messageTs: row.message_ts,
    userId: row.user_id,
    feedbackType: row.feedback_type as FeedbackType,
    question: row.question,
    routeMode: row.route_mode,
    docsCount: row.docs_count,
    slackCount: row.slack_count,
    topSimilarity: row.top_similarity,
  }));
}
