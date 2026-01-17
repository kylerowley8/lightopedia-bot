#!/usr/bin/env npx tsx
// ============================================
// Slack Indexer Script — Manual #lightopedia indexing
// ============================================
// Usage: npm run index:slack
//
// Prerequisites:
// - Supabase migrations applied
// - SLACK_BOT_TOKEN with channels:history scope
// - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY set

import "dotenv/config";
import { WebClient } from "@slack/web-api";
import { indexLightopediaChannel, type SlackIndexerClient } from "../src/indexer/slackIndexer.js";
import { ALLOWED_SLACK_CHANNELS } from "../src/indexer/config.js";

// ============================================
// Config
// ============================================

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!SLACK_TOKEN) {
  console.error("Missing SLACK_BOT_TOKEN environment variable");
  process.exit(1);
}

const slackClient = new WebClient(SLACK_TOKEN);

// ============================================
// Helpers
// ============================================

function log(emoji: string, message: string) {
  console.log(`${emoji} ${message}`);
}

// Adapt WebClient to SlackIndexerClient interface
function createIndexerClient(client: WebClient): SlackIndexerClient {
  return {
    conversations: {
      history: async (params) => {
        const result = await client.conversations.history(params);
        return {
          ok: result.ok ?? false,
          messages: result.messages as any,
          response_metadata: result.response_metadata as any,
          error: result.error,
        };
      },
      replies: async (params) => {
        const result = await client.conversations.replies(params);
        return {
          ok: result.ok ?? false,
          messages: result.messages as any,
          error: result.error,
        };
      },
    },
    chat: {
      getPermalink: async (params) => {
        const result = await client.chat.getPermalink(params);
        return {
          ok: result.ok ?? false,
          permalink: result.permalink,
          error: result.error,
        };
      },
    },
  };
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);

  // Parse args
  let force = false;
  let maxThreads = 100;
  let sinceTs: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--max" && args[i + 1]) {
      maxThreads = parseInt(args[++i]!, 10);
    } else if (arg === "--since" && args[i + 1]) {
      // Accept either a timestamp or a date string
      const since = args[++i]!;
      if (/^\d+\.\d+$/.test(since)) {
        sinceTs = since;
      } else {
        // Parse as date and convert to Slack timestamp
        const date = new Date(since);
        if (isNaN(date.getTime())) {
          console.error(`Invalid date: ${since}`);
          process.exit(1);
        }
        sinceTs = (date.getTime() / 1000).toString();
      }
    } else if (arg === "--help") {
      console.log(`
Usage: npm run index:slack -- [options]

Options:
  --force           Re-index threads even if already indexed
  --max <count>     Maximum threads to index (default: 100)
  --since <date>    Only index threads newer than this date
                    Accepts Slack timestamp or ISO date string

Examples:
  npm run index:slack
  npm run index:slack -- --force --max 50
  npm run index:slack -- --since 2024-01-01
`);
      process.exit(0);
    }
  }

  console.log("\n========================================");
  console.log("Lightopedia V2 Slack Indexer");
  console.log("========================================\n");

  log("📍", `Channel: #lightopedia (${ALLOWED_SLACK_CHANNELS.lightopedia})`);
  log("📊", `Max threads: ${maxThreads}`);
  if (sinceTs) {
    log("📅", `Since: ${new Date(parseFloat(sinceTs) * 1000).toISOString()}`);
  }
  if (force) {
    log("🔄", "Force mode: re-indexing existing threads");
  }

  console.log("");

  // Create adapter for WebClient
  const indexerClient = createIndexerClient(slackClient);

  // Run indexer
  log("🔄", "Starting Slack indexing...");
  const result = await indexLightopediaChannel(indexerClient, {
    force,
    maxThreads,
    sinceTs,
  });

  console.log("\n========================================");
  console.log("Results:");
  console.log("========================================");
  console.log(`  Index Run ID:     ${result.indexRunId}`);
  console.log(`  Threads Indexed:  ${result.threadsIndexed}`);
  console.log(`  Skipped:          ${result.skipped}`);
  console.log(`  Errors:           ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log("\n✅ Slack indexing complete");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
