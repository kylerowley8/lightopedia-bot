import "dotenv/config";
import express from "express";
import { App, ExpressReceiver } from "@slack/bolt";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { wrapError, getUserMessage } from "./lib/errors.js";
import { handleGitHubWebhook } from "./github/webhook.js";
import { retrieveContext } from "./retrieval/retrieve.js";
import { generateAnswer } from "./answer/generate.js";
import type { SlackContext, AnswerResult } from "./types/index.js";

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
// Slack Event Types (minimal typed interfaces)
// ============================================

interface SlackMessageEvent {
  type: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  channel_type: string;
  team?: string;
  subtype?: string;
}

interface SlackEventContext {
  teamId?: string;
}

interface SlackClient {
  chat: {
    postMessage: (params: { channel: string; thread_ts: string; text: string }) => Promise<{ ts: string }>;
    update: (params: { channel: string; ts: string; text: string }) => Promise<void>;
  };
}

// ============================================
// Debug Storage
// ============================================

interface RecentAnswer {
  timestamp: string;
  requestId: string;
  question: string;
  isConfident: boolean;
  chunkCount: number;
  avgSimilarity: number;
  latencyMs: number;
  teamId?: string;
  channelId?: string;
  threadTs?: string;
}

const recentAnswers: RecentAnswer[] = [];
const MAX_RECENT = 20;

// ============================================
// Core Question Handler
// ============================================

async function answerQuestion(
  question: string,
  userId: string,
  slackContext: Partial<SlackContext>
): Promise<AnswerResult> {
  const retrieval = await retrieveContext(question);
  const result = await generateAnswer(question, retrieval, userId, slackContext);

  // Store for debug endpoint
  recentAnswers.unshift({
    timestamp: new Date().toISOString(),
    requestId: result.requestId,
    question: question.slice(0, 100),
    isConfident: result.isConfident,
    chunkCount: retrieval.chunks.length,
    avgSimilarity: result.avgSimilarity,
    latencyMs: result.latencyMs,
    ...slackContext,
  });
  if (recentAnswers.length > MAX_RECENT) recentAnswers.pop();

  return result;
}

// ============================================
// Slack Event Handlers
// ============================================

slackApp.event("app_mention", async ({ event, client, context }: { event: unknown; client: unknown; context: unknown }) => {
  const e = event as SlackMessageEvent;
  const ctx = context as SlackEventContext;
  const slackClient = client as SlackClient;

  const threadTs = e.thread_ts || e.ts;
  const userText = (e.text || "").replace(/<@[^>]+>\s*/g, "").trim();
  let pendingTs: string | undefined;

  const slackContext: Partial<SlackContext> = {
    teamId: ctx.teamId || e.team,
    channelId: e.channel,
    threadTs: threadTs,
  };

  try {
    const pending = await slackClient.chat.postMessage({
      channel: e.channel,
      thread_ts: threadTs,
      text: "🔎 Looking that up…",
    });
    pendingTs = pending.ts;

    const result = await answerQuestion(userText, e.user, slackContext);

    await slackClient.chat.update({
      channel: e.channel,
      ts: pendingTs,
      text: result.answer,
    });
  } catch (err) {
    const appError = wrapError(err);
    logger.error("app_mention handler failed", {
      stage: "slack",
      ...slackContext,
      error: err,
    });

    const errorMsg = getUserMessage(appError);
    if (pendingTs) {
      await slackClient.chat.update({ channel: e.channel, ts: pendingTs, text: errorMsg }).catch(() => {});
    } else {
      await slackClient.chat.postMessage({ channel: e.channel, thread_ts: threadTs, text: errorMsg }).catch(() => {});
    }
  }
});

slackApp.message(async ({ message, client, context }: { message: unknown; client: unknown; context: unknown }) => {
  const m = message as SlackMessageEvent;
  const ctx = context as SlackEventContext;
  const slackClient = client as SlackClient;

  // Only respond to DMs
  if (m.channel_type !== "im") return;
  if (m.subtype === "bot_message") return;

  const threadTs = m.thread_ts || m.ts;
  let pendingTs: string | undefined;

  const slackContext: Partial<SlackContext> = {
    teamId: ctx.teamId || m.team,
    channelId: m.channel,
    threadTs: threadTs,
  };

  try {
    const pending = await slackClient.chat.postMessage({
      channel: m.channel,
      thread_ts: threadTs,
      text: "🔎 Looking that up…",
    });
    pendingTs = pending.ts;

    const result = await answerQuestion((m.text || "").trim(), m.user, slackContext);

    await slackClient.chat.update({
      channel: m.channel,
      ts: pendingTs,
      text: result.answer,
    });
  } catch (err) {
    const appError = wrapError(err);
    logger.error("message handler failed", {
      stage: "slack",
      ...slackContext,
      error: err,
    });

    const errorMsg = getUserMessage(appError);
    if (pendingTs) {
      await slackClient.chat.update({ channel: m.channel, ts: pendingTs, text: errorMsg }).catch(() => {});
    } else {
      await slackClient.chat.postMessage({ channel: m.channel, thread_ts: threadTs, text: errorMsg }).catch(() => {});
    }
  }
});

// ============================================
// Express Routes
// ============================================

const app = receiver.app as express.Application;

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.get("/debug/last-answers", (_req, res) => {
  res.json(recentAnswers);
});

// GitHub webhook with raw body for signature verification
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

logger.info("Starting Lightopedia bot", {
  stage: "startup",
  port: config.port,
  githubConfigured: config.github.isConfigured,
});

app.listen(config.port, () => {
  logger.info("Server listening", { stage: "startup", port: config.port });
});
