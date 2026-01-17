#!/usr/bin/env npx tsx
import "dotenv/config";
// ============================================
// Database RPC Test Script
// ============================================
// Verifies that match_docs and match_slack_threads RPCs are working.
// Run with: npm run db:test
//
// Prerequisites:
// - Supabase migrations applied
// - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set
// - OPENAI_API_KEY set (for generating test embeddings)

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import crypto from "crypto";

// ============================================
// Config
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!OPENAI_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ============================================
// Helpers
// ============================================

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    dimensions: 1536,
  });
  return response.data[0]!.embedding;
}

function log(emoji: string, message: string) {
  console.log(`${emoji} ${message}`);
}

// ============================================
// Test Data
// ============================================

const TEST_DOC = {
  content:
    "Light invoices are created automatically when a subscription billing cycle completes. Each invoice contains line items for the subscription amount and any usage-based charges.",
  metadata: {
    source_type: "repo",
    repo_slug: "light-space/light",
    path: "docs/billing/invoices.md",
    section: "Invoice Creation",
    commit_sha: "abc123",
    indexed_at: new Date().toISOString(),
    index_run_id: crypto.randomUUID(),
    retrieval_program_version: "retrieval.v1.0",
  },
};

const TEST_SLACK_THREAD = {
  content:
    "Q: How do I refund an invoice? A: Use the refund endpoint on the Invoice API. You can refund partially or fully. The ledger entries are automatically created.",
  metadata: {
    permalink: "https://lightspace.slack.com/archives/C08SDBFS7BL/p1234567890",
    topic: "Invoice refunds",
    channel: "C08SDBFS7BL",
    indexed_at: new Date().toISOString(),
    index_run_id: crypto.randomUUID(),
  },
};

// ============================================
// Tests
// ============================================

async function testMatchDocs(): Promise<boolean> {
  log("📝", "Testing match_docs RPC...");

  // 1. Insert test document
  log("  ", "Inserting test document...");
  const embedding = await generateEmbedding(TEST_DOC.content);

  const { error: insertError } = await supabase
    .from("docs")
    .insert({
      content: TEST_DOC.content,
      embedding,
      metadata: TEST_DOC.metadata,
    })
    .select();

  // Handle schema-qualified table
  if (insertError?.message?.includes("relation") && insertError?.message?.includes("does not exist")) {
    // Try with schema prefix
    const { error: schemaError } = await supabase.rpc("match_docs", {
      query_embedding: embedding,
      match_count: 1,
    });

    if (schemaError) {
      log("❌", `match_docs RPC not found: ${schemaError.message}`);
      log("  ", "Have you applied the migrations?");
      return false;
    }
  } else if (insertError) {
    log("❌", `Failed to insert test doc: ${insertError.message}`);
    return false;
  }

  // 2. Query with similar embedding
  log("  ", "Querying with match_docs...");
  const queryEmbedding = await generateEmbedding("How are invoices created?");

  const { data, error: queryError } = await supabase.rpc("match_docs", {
    query_embedding: queryEmbedding,
    match_count: 5,
  });

  if (queryError) {
    log("❌", `match_docs failed: ${queryError.message}`);
    return false;
  }

  if (!data || data.length === 0) {
    log("⚠️", "match_docs returned 0 results");
    return false;
  }

  log("✅", `match_docs returned ${data.length} result(s)`);
  log("  ", `Top result similarity: ${data[0].similarity.toFixed(4)}`);
  log("  ", `Content preview: ${data[0].content.slice(0, 60)}...`);

  return true;
}

async function testMatchSlackThreads(): Promise<boolean> {
  log("💬", "Testing match_slack_threads RPC...");

  // 1. Insert test thread
  log("  ", "Inserting test Slack thread...");
  const embedding = await generateEmbedding(TEST_SLACK_THREAD.content);

  const { error: insertError } = await supabase
    .from("slack_threads")
    .insert({
      content: TEST_SLACK_THREAD.content,
      embedding,
      metadata: TEST_SLACK_THREAD.metadata,
    });

  if (insertError && !insertError.message?.includes("does not exist")) {
    log("❌", `Failed to insert test thread: ${insertError.message}`);
    return false;
  }

  // 2. Query with similar embedding
  log("  ", "Querying with match_slack_threads...");
  const queryEmbedding = await generateEmbedding("How do I refund an invoice?");

  const { data, error: queryError } = await supabase.rpc("match_slack_threads", {
    query_embedding: queryEmbedding,
    match_count: 5,
  });

  if (queryError) {
    log("❌", `match_slack_threads failed: ${queryError.message}`);
    return false;
  }

  if (!data || data.length === 0) {
    log("⚠️", "match_slack_threads returned 0 results");
    return false;
  }

  log("✅", `match_slack_threads returned ${data.length} result(s)`);
  log("  ", `Top result similarity: ${data[0].similarity.toFixed(4)}`);
  log("  ", `Content preview: ${data[0].content.slice(0, 60)}...`);

  return true;
}

async function cleanup() {
  log("🧹", "Cleaning up test data...");

  // Delete test docs
  await supabase
    .from("docs")
    .delete()
    .eq("metadata->>path", TEST_DOC.metadata.path);

  // Delete test threads
  await supabase
    .from("slack_threads")
    .delete()
    .eq("metadata->>permalink", TEST_SLACK_THREAD.metadata.permalink);
}

// ============================================
// Main
// ============================================

async function main() {
  console.log("\n========================================");
  console.log("Lightopedia V2 Database RPC Test");
  console.log("========================================\n");

  let passed = 0;
  let failed = 0;

  try {
    if (await testMatchDocs()) {
      passed++;
    } else {
      failed++;
    }
  } catch (err) {
    log("❌", `match_docs test threw: ${err}`);
    failed++;
  }

  console.log("");

  try {
    if (await testMatchSlackThreads()) {
      passed++;
    } else {
      failed++;
    }
  } catch (err) {
    log("❌", `match_slack_threads test threw: ${err}`);
    failed++;
  }

  console.log("");

  try {
    await cleanup();
  } catch (err) {
    log("⚠️", `Cleanup failed: ${err}`);
  }

  console.log("\n========================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("========================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
