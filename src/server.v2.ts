// ============================================
// Lightopedia V2 Server — Thin Slack shell
// Single entrypoint, no duplicated handlers
// ============================================

import "dotenv/config";
import express from "express";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { App, ExpressReceiver } = require("@slack/bolt");

import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { handleSlackQuestion, fetchThreadHistory } from "./app/handleSlackQuestion.js";
import { handleAction } from "./slack/actions.js";
import { handleGitHubWebhook } from "./github/webhook.js";
import type { SlackInput } from "./app/types.js";

// ============================================
// Slack App Setup
// ============================================

const receiver = new ExpressReceiver({
  signingSecret: config.slack.signingSecret,
  endpoints: "/slack/events",
});

const slackApp = new App({
  token: config.slack.botToken,
  receiver,
});

// ============================================
// Single Question Handler
// ============================================

interface SlackMessage {
  type: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  channel_type: string;
  team?: string;
  subtype?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    url_private: string;
    size: number;
  }>;
}

interface SlackClient {
  chat: {
    postMessage: (params: { channel: string; thread_ts: string; text: string; blocks?: unknown[] }) => Promise<{ ts: string }>;
    update: (params: { channel: string; ts: string; text: string; blocks?: unknown[] }) => Promise<void>;
  };
  conversations: {
    replies: (params: { channel: string; ts: string; limit?: number }) => Promise<{
      ok: boolean;
      messages?: Array<{ type: string; user?: string; bot_id?: string; text?: string; ts: string; subtype?: string }>;
      error?: string;
    }>;
  };
}

/**
 * Core question handler — used by both app_mention and DM.
 * NO duplication — single flow.
 */
async function handleQuestion(
  message: SlackMessage,
  client: SlackClient,
  botUserId?: string
): Promise<void> {
  const threadTs = message.thread_ts || message.ts;
  const cleanText = message.text.replace(/<@[^>]+>\s*/g, "").trim();

  // Build SlackInput
  const input: SlackInput = {
    text: cleanText,
    userId: message.user,
    channelId: message.channel,
    threadTs,
    messageTs: message.ts,
    channelType: message.channel_type === "im" ? "dm" : "channel",
    teamId: message.team,
    files: message.files?.map((f) => ({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      url: f.url_private,
      size: f.size,
    })),
  };

  // Post "thinking" message
  let pendingTs: string | undefined;
  try {
    const pending = await client.chat.postMessage({
      channel: message.channel,
      thread_ts: threadTs,
      text: "🔎 Looking that up…",
    });
    pendingTs = pending.ts;
  } catch (err) {
    logger.error("Failed to post pending message", { stage: "slack", error: err });
  }

  // Fetch thread history
  const threadHistory = await fetchThreadHistory(
    client,
    message.channel,
    threadTs,
    message.ts,
    botUserId
  );

  // Handle the question
  const response = await handleSlackQuestion(input, threadHistory);

  // Update or post response
  try {
    if (pendingTs) {
      await client.chat.update({
        channel: message.channel,
        ts: pendingTs,
        text: response.text,
        blocks: response.blocks,
      });
    } else {
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: threadTs,
        text: response.text,
        blocks: response.blocks,
      });
    }
  } catch (err) {
    logger.error("Failed to send response", { stage: "slack", error: err });
  }
}

// ============================================
// Slack Event Handlers
// ============================================

slackApp.event("app_mention", async ({ event, client, context }: { event: unknown; client: unknown; context: unknown }) => {
  const e = event as SlackMessage;
  const ctx = context as { botUserId?: string };
  await handleQuestion(e, client as SlackClient, ctx.botUserId);
});

slackApp.message(async ({ message, client, context }: { message: unknown; client: unknown; context: unknown }) => {
  const m = message as SlackMessage;
  const ctx = context as { botUserId?: string };

  // Only respond to DMs
  if (m.channel_type !== "im") return;
  if (m.subtype === "bot_message") return;

  await handleQuestion(m, client as SlackClient, ctx.botUserId);
});

// ============================================
// Action Handlers
// ============================================

slackApp.action(/^(feedback_helpful|feedback_not_helpful|show_technical|hide_technical)$/, async ({ ack, body, client }: { ack: () => Promise<void>; body: unknown; client: unknown }) => {
  await ack();

  const actionBody = body as {
    actions?: Array<{ action_id?: string; value?: string }>;
    user?: { id?: string };
    channel?: { id?: string };
    message?: { ts?: string; blocks?: unknown[] };
  };

  const actionId = actionBody.actions?.[0]?.action_id ?? "";
  const value = actionBody.actions?.[0]?.value ?? "";
  const userId = actionBody.user?.id ?? "unknown";
  const channelId = actionBody.channel?.id;
  const messageTs = actionBody.message?.ts;
  const originalBlocks = actionBody.message?.blocks as Array<{ type: string; elements?: unknown[] }> | undefined;

  const result = await handleAction(actionId, value, userId);

  if (!result.success) {
    logger.warn("Action handler failed", {
      stage: "slack",
      actionId,
      error: result.error,
    });
    return;
  }

  // Update the message to show feedback was recorded
  if (channelId && messageTs && originalBlocks) {
    try {
      // For feedback actions, update the actions block to show confirmation
      if (actionId === "feedback_helpful" || actionId === "feedback_not_helpful") {
        const feedbackLabel = actionId === "feedback_helpful" ? "helpful" : "not helpful";
        const updatedBlocks = originalBlocks.map((block) => {
          if (block.type === "actions") {
            // Replace action buttons with confirmation
            return {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `_Thanks for your feedback! You marked this as ${feedbackLabel}._`,
                },
              ],
            };
          }
          return block;
        });

        await (client as { chat: { update: (opts: unknown) => Promise<unknown> } }).chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: updatedBlocks,
        });

        logger.info("Updated message with feedback confirmation", {
          stage: "slack",
          actionId,
          channelId,
        });
      }

      // For show_technical, show a message that technical view is coming
      if (actionId === "show_technical") {
        // For now, just update the button text to indicate it was clicked
        // Full implementation would cache pipeline results and re-render
        const updatedBlocks = originalBlocks.map((block) => {
          if (block.type === "actions" && Array.isArray(block.elements)) {
            return {
              ...block,
              elements: (block.elements as Array<{ action_id?: string; text?: { type: string; text: string } }>).map((el) => {
                if (el.action_id === "show_technical") {
                  return {
                    ...el,
                    text: { type: "plain_text" as const, text: "Technical view coming soon" },
                  };
                }
                return el;
              }),
            };
          }
          return block;
        });

        await (client as { chat: { update: (opts: unknown) => Promise<unknown> } }).chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: updatedBlocks,
        });
      }
    } catch (err) {
      logger.error("Failed to update message", {
        stage: "slack",
        actionId,
        error: err,
      });
    }
  }
});

// ============================================
// Express Routes
// ============================================

const app = receiver.app as express.Application;

// Health check
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Debug endpoint - version info
app.get("/debug/version", (_req, res) => {
  res.json({
    version: "v2.0.0",
    router: "router.v1.0",
    retrieval: "retrieval.v1.0",
    pipeline: "pipeline.v1.0",
  });
});

// Debug endpoint - replay a question (for testing)
app.post("/debug/replay", express.json(), async (req, res) => {
  try {
    const { question, threadHistory } = req.body as {
      question?: string;
      threadHistory?: Array<{ role: string; content: string; timestamp: string }>;
    };

    if (!question) {
      res.status(400).json({ error: "question is required" });
      return;
    }

    const { routeQuestion } = await import("./router/routeQuestion.js");
    const { retrieveDocs } = await import("./retrieval/docsRetrieval.js");

    // Route the question
    const route = await routeQuestion({
      question,
      channelType: "dm", // Default for debug
      threadHistory: threadHistory?.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: m.timestamp,
      })),
    });

    // Retrieve evidence
    const evidence = await retrieveDocs(question, route);

    res.json({
      question,
      route,
      evidence: {
        docsCount: evidence.docs.length,
        slackCount: evidence.slackThreads.length,
        topDocs: evidence.docs.slice(0, 3).map((d) => ({
          source: d.source,
          section: d.section,
          similarity: d.similarity,
          preview: d.content.slice(0, 100),
        })),
        queriesUsed: evidence.retrievalMeta.queriesUsed,
      },
    });
  } catch (err) {
    logger.error("Debug replay failed", { stage: "startup", error: err });
    res.status(500).json({ error: "Replay failed", message: String(err) });
  }
});

// Debug endpoint - feedback stats
app.get("/debug/stats", async (_req, res) => {
  try {
    const { getFeedbackStats, getRecentFeedback } = await import("./feedback/store.js");

    // Get stats for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = await getFeedbackStats(sevenDaysAgo);
    const recentFeedback = await getRecentFeedback(10);

    res.json({
      period: "last_7_days",
      stats: stats ?? { total: 0, helpful: 0, notHelpful: 0, helpfulRate: 0 },
      recentFeedback: recentFeedback.map((f) => ({
        requestId: f.requestId,
        feedbackType: f.feedbackType,
        routeMode: f.routeMode,
        question: f.question?.slice(0, 50),
      })),
    });
  } catch (err) {
    logger.error("Debug stats failed", { stage: "startup", error: err });
    res.status(500).json({ error: "Stats failed", message: String(err) });
  }
});

// GitHub webhook
app.post(
  "/github/webhook",
  express.json({
    verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
  handleGitHubWebhook
);

// ============================================
// Startup
// ============================================

logger.info("Starting Lightopedia V2", {
  stage: "startup",
  port: config.port,
  version: "v2.0.0",
});

app.listen(config.port, () => {
  logger.info("Server listening", {
    stage: "startup",
    port: config.port,
  });
});
