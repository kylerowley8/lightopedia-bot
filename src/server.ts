import "dotenv/config";
import express from "express";
import pkg from "@slack/bolt";
import { handleGitHubWebhook } from "./github/webhook.js";
import { retrieveContext } from "./retrieval/retrieve.js";
import { generateAnswer } from "./answer/generate.js";
import { supabase } from "./db/supabase.js";
const { App, ExpressReceiver } = pkg as any;

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  endpoints: "/slack/events",
});

const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  receiver,
});

// Store recent answers for debug endpoint
const recentAnswers: any[] = [];
const MAX_RECENT = 20;

async function answerQuestion(
  question: string,
  userId: string,
  slackContext: { teamId?: string; channelId?: string; threadTs?: string }
): Promise<string> {
  const retrieval = await retrieveContext(question);
  const result = await generateAnswer(question, retrieval, userId, slackContext);

  // Store for debug
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

  return result.answer;
}

slackApp.event("app_mention", async ({ event, client, context }: any) => {
  const e: any = event;
  const thread_ts = e.thread_ts || e.ts;
  const userText = (e.text || "").replace(/<@[^>]+>\s*/g, "").trim();
  let pendingTs: string | undefined;

  const slackContext = {
    teamId: context?.teamId || e.team,
    channelId: e.channel,
    threadTs: thread_ts,
  };

  try {
    const pending = await client.chat.postMessage({ channel: e.channel, thread_ts, text: "🔎 Looking that up…" });
    pendingTs = pending.ts;
    const reply = await answerQuestion(userText, e.user, slackContext);
    await client.chat.update({ channel: e.channel, ts: pendingTs, text: reply });
  } catch (err) {
    console.error("app_mention error:", err);
    const errorMsg = "😕 Something went wrong. Please try again.";
    if (pendingTs) {
      await client.chat.update({ channel: e.channel, ts: pendingTs, text: errorMsg }).catch(() => {});
    } else {
      await client.chat.postMessage({ channel: e.channel, thread_ts, text: errorMsg }).catch(() => {});
    }
  }
});

slackApp.message(async ({ message, client, context }: any) => {
  const m: any = message;
  if (m.channel_type !== "im") return;
  if (m.subtype === "bot_message") return;

  const thread_ts = m.thread_ts || m.ts;
  let pendingTs: string | undefined;

  const slackContext = {
    teamId: context?.teamId || m.team,
    channelId: m.channel,
    threadTs: thread_ts,
  };

  try {
    const pending = await client.chat.postMessage({ channel: m.channel, thread_ts, text: "🔎 Looking that up…" });
    pendingTs = pending.ts;
    const reply = await answerQuestion((m.text || "").trim(), m.user, slackContext);
    await client.chat.update({ channel: m.channel, ts: pendingTs, text: reply });
  } catch (err) {
    console.error("message error:", err);
    const errorMsg = "😕 Something went wrong. Please try again.";
    if (pendingTs) {
      await client.chat.update({ channel: m.channel, ts: pendingTs, text: errorMsg }).catch(() => {});
    } else {
      await client.chat.postMessage({ channel: m.channel, thread_ts, text: errorMsg }).catch(() => {});
    }
  }
});

const app = receiver.app as express.Application;
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Debug endpoint for recent answers
app.get("/debug/last-answers", (_req, res) => {
  res.json(recentAnswers);
});

// GitHub webhook with raw body for signature verification
app.post(
  "/github/webhook",
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
  handleGitHubWebhook
);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Listening on :${port}`));
