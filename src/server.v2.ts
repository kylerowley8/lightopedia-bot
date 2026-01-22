// ============================================
// Lightopedia V2 Server — Thin Slack shell
// Single entrypoint, no duplicated handlers
// ============================================

import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { App, ExpressReceiver } = require("@slack/bolt");

import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { handleSlackQuestion } from "./app/handleSlackQuestion.js";
import { handleAction } from "./slack/actions.js";
import { cacheDetailedAnswer } from "./lib/answerCache.js";
import { handleGitHubWebhook } from "./github/webhook.js";
import {
  authenticateApiKey,
  rateLimit,
  validateBody,
  askRequestSchema,
  addRequestId,
  corsMiddleware,
  handleAskRequest,
  handleHealthCheck,
} from "./api/index.js";
import { handleLogin, handleCallback, handleLogout } from "./auth/index.js";
import { createDashboardRouter, createAuthRouter } from "./dashboard/index.js";
import type { SlackInput, SlackFile } from "./app/types.js";
import type { ThreadMessage } from "./router/types.js";

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
    url_private_download?: string;
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
      messages?: Array<{
        type: string;
        user?: string;
        bot_id?: string;
        text?: string;
        ts: string;
        subtype?: string;
        files?: Array<{
          id: string;
          name: string;
          mimetype: string;
          url_private: string;
          url_private_download?: string;
          size: number;
        }>;
      }>;
      error?: string;
    }>;
  };
}

/**
 * Fetch thread history AND files from thread messages.
 * Returns both conversation history and any files attached to thread messages.
 */
async function fetchThreadHistoryWithFiles(
  client: SlackClient,
  channelId: string,
  threadTs: string,
  currentMessageTs: string,
  botUserId?: string
): Promise<{ history: ThreadMessage[]; files: SlackFile[] }> {
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
      return { history: [], files: [] };
    }

    const history: ThreadMessage[] = [];
    const files: SlackFile[] = [];

    for (const msg of result.messages) {
      // Skip current message for history (but still get its files below)
      if (msg.ts !== currentMessageTs) {
        // Add text to history
        if (msg.text) {
          const isBotMessage =
            msg.bot_id !== undefined ||
            (botUserId !== undefined && msg.user === botUserId);

          const cleanText = msg.text.replace(/<@[^>]+>\s*/g, "").trim();
          if (cleanText) {
            history.push({
              role: isBotMessage ? "assistant" : "user",
              content: cleanText,
              timestamp: msg.ts,
            });
          }
        }
      }

      // Extract files from ALL messages (including current, but we filter duplicates later)
      if (msg.files && msg.ts !== currentMessageTs) {
        for (const f of msg.files) {
          files.push({
            id: f.id,
            name: f.name,
            mimetype: f.mimetype,
            url: f.url_private_download || f.url_private,
            size: f.size,
          });
        }
      }
    }

    // Sort history by timestamp (oldest first)
    history.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));

    return {
      history: history.slice(-6),
      files,
    };
  } catch (err) {
    logger.error("Error fetching thread history with files", {
      stage: "slack",
      channelId,
      threadTs,
      error: err,
    });
    return { history: [], files: [] };
  }
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
      url: f.url_private_download || f.url_private,
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

  // Fetch thread history and files from thread
  const { history: threadHistory, files: threadFiles } = await fetchThreadHistoryWithFiles(
    client,
    message.channel,
    threadTs,
    message.ts,
    botUserId
  );

  // Merge thread files with current message files (thread files first, then current)
  const allFiles = [...threadFiles, ...(input.files || [])];
  if (allFiles.length > 0) {
    input.files = allFiles;
    logger.info("Files found in thread", {
      stage: "slack",
      threadFileCount: threadFiles.length,
      currentFileCount: (message.files || []).length,
      totalFiles: allFiles.length,
    });
  }

  // Handle the question
  const { response, requestId, detailedAnswer } = await handleSlackQuestion(input, threadHistory);

  // Cache detailed answer if present
  if (detailedAnswer && requestId !== "error") {
    cacheDetailedAnswer(requestId, detailedAnswer, threadTs, message.channel);
  }

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

slackApp.action(/^(feedback_helpful|feedback_not_helpful|show_technical|hide_technical|show_more_details)$/, async ({ ack, body, client }: { ack: () => Promise<void>; body: unknown; client: unknown }) => {
  await ack();

  const actionBody = body as {
    actions?: Array<{ action_id?: string; value?: string }>;
    user?: { id?: string };
    channel?: { id?: string };
    message?: { ts?: string; thread_ts?: string; blocks?: unknown[] };
  };

  const actionId = actionBody.actions?.[0]?.action_id ?? "";
  const value = actionBody.actions?.[0]?.value ?? "";
  const userId = actionBody.user?.id ?? "unknown";
  const channelId = actionBody.channel?.id;
  const messageTs = actionBody.message?.ts;
  const threadTs = actionBody.message?.thread_ts || messageTs;
  const originalBlocks = actionBody.message?.blocks as Array<{ type: string; elements?: unknown[] }> | undefined;

  const result = await handleAction(actionId, value, userId);

  if (!result.success) {
    logger.warn("Action handler failed", {
      stage: "slack",
      actionId,
      error: result.error,
    });

    // For show_more_details failure, post an error message
    if (actionId === "show_more_details" && channelId && threadTs) {
      try {
        await (client as SlackClient).chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: result.error || "Sorry, I couldn't retrieve the details.",
        });
      } catch (err) {
        logger.error("Failed to post error message", { stage: "slack", error: err });
      }
    }
    return;
  }

  // Handle show_more_details: post detailed answer as a threaded reply
  if (actionId === "show_more_details" && result.detailedReply) {
    try {
      await (client as SlackClient).chat.postMessage({
        channel: result.detailedReply.channelId,
        thread_ts: result.detailedReply.threadTs,
        text: result.detailedReply.text,
      });

      // Update original message to remove the "More details" button
      if (channelId && messageTs && originalBlocks) {
        const updatedBlocks = originalBlocks.map((block) => {
          if (block.type === "actions" && Array.isArray(block.elements)) {
            // Remove the show_more_details button, keep others
            const filteredElements = (block.elements as Array<{ action_id?: string }>).filter(
              (el) => el.action_id !== "show_more_details"
            );
            if (filteredElements.length === 0) {
              return null; // Remove the entire actions block if empty
            }
            return { ...block, elements: filteredElements };
          }
          return block;
        }).filter((block): block is NonNullable<typeof block> => block !== null);

        await (client as { chat: { update: (opts: unknown) => Promise<unknown> } }).chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: updatedBlocks,
        });
      }

      logger.info("Posted detailed answer as reply", {
        stage: "slack",
        requestId: value,
        channelId: result.detailedReply.channelId,
      });
    } catch (err) {
      logger.error("Failed to post detailed answer", {
        stage: "slack",
        error: err,
      });
    }
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

// Cookie parser for session management
app.use(cookieParser());

// Health check
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ============================================
// Auth & Dashboard Routes
// ============================================

if (config.googleOAuth.isConfigured) {
  // Auth routes
  const authRouter = createAuthRouter();
  app.use("/auth", authRouter);

  // OAuth handlers (separate from static login page)
  app.get("/auth/login", handleLogin);
  app.get("/auth/callback", handleCallback);
  app.post("/auth/logout", handleLogout);

  // Dashboard routes
  app.use("/dashboard", express.json(), createDashboardRouter());

  logger.info("Dashboard routes enabled", {
    stage: "startup",
  });
} else {
  // Dashboard not configured - return helpful message
  app.get("/dashboard", (_req, res) => {
    res.status(503).json({
      error: "DASHBOARD_NOT_CONFIGURED",
      message: "The dashboard is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, and SESSION_SECRET environment variables.",
    });
  });
  app.get("/auth/login", (_req, res) => {
    res.status(503).json({
      error: "AUTH_NOT_CONFIGURED",
      message: "Google OAuth is not configured.",
    });
  });
}

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
// Public API Routes
// ============================================

// Apply CORS to API routes
app.use("/api", corsMiddleware);

// Apply request ID to all API routes
app.use("/api", addRequestId);

// API health check (no auth required)
app.get("/api/v1/health", handleHealthCheck);

// Protected API routes (require authentication)
if (config.api.isConfigured) {
  // Rate limiting configuration
  const rateLimiter = rateLimit({
    windowMs: config.api.rateLimitWindowMs,
    maxRequests: config.api.rateLimitMaxRequests,
  });

  // POST /api/v1/ask - Main Q&A endpoint
  app.post(
    "/api/v1/ask",
    express.json({ limit: "100kb" }), // Limit request body size
    authenticateApiKey,
    rateLimiter,
    validateBody(askRequestSchema),
    handleAskRequest
  );

  logger.info("API routes enabled", {
    stage: "startup",
    keyCount: config.api.keys.length,
    rateLimitWindow: config.api.rateLimitWindowMs,
    rateLimitMax: config.api.rateLimitMaxRequests,
  });
} else {
  // API not configured - return helpful error
  app.post("/api/v1/ask", express.json(), (_req, res) => {
    res.status(503).json({
      error: "API_NOT_CONFIGURED",
      message: "The API is not configured. Please set API_KEYS environment variable.",
    });
  });

  logger.info("API routes disabled (no API keys configured)", {
    stage: "startup",
  });
}

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
