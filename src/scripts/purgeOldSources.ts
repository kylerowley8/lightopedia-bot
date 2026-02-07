// ============================================
// Purge Old Sources — One-time cleanup
// Removes non-help-article chunks from the database
//
// Usage:
//   npx tsx src/scripts/purgeOldSources.ts --dry-run   # Preview what would be deleted
//   npx tsx src/scripts/purgeOldSources.ts --confirm    # Actually delete
// ============================================

import "dotenv/config";
import { supabase } from "../db/supabase.js";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isConfirmed = args.includes("--confirm");

if (!isDryRun && !isConfirmed) {
  console.error("Usage: npx tsx src/scripts/purgeOldSources.ts [--dry-run | --confirm]");
  console.error("  --dry-run   Preview what would be deleted (no changes made)");
  console.error("  --confirm   Actually delete the data");
  process.exit(1);
}

async function purgeOldSources(): Promise<void> {
  console.log(`Mode: ${isDryRun ? "DRY RUN (no data will be deleted)" : "LIVE DELETE"}\n`);

  // Count non-help-article chunks
  const { count: docsCount, error: countError } = await supabase
    .from("docs")
    .select("*", { count: "exact", head: true })
    .or("metadata->>repo_slug.neq.light-space/help-articles,metadata->>repo_slug.is.null");

  if (countError) {
    console.error("Failed to count old docs:", countError.message);
  } else {
    console.log(`Found ${docsCount ?? 0} non-help-article chunks in docs table`);
  }

  // Count slack_threads
  const { count: slackCount, error: slackCountError } = await supabase
    .from("slack_threads")
    .select("*", { count: "exact", head: true });

  if (slackCountError) {
    console.log("Note: slack_threads table not accessible:", slackCountError.message);
  } else {
    console.log(`Found ${slackCount ?? 0} rows in slack_threads table`);
  }

  if (isDryRun) {
    console.log("\nDry run complete. No data was deleted.");
    console.log("Run with --confirm to delete.");
    return;
  }

  // Delete non-help-article chunks
  console.log("\nDeleting non-help-article chunks...");
  const { error: docsError } = await supabase
    .from("docs")
    .delete()
    .or("metadata->>repo_slug.neq.light-space/help-articles,metadata->>repo_slug.is.null");

  if (docsError) {
    console.error("Failed to delete old docs:", docsError.message);
  } else {
    console.log(`Deleted ${docsCount ?? "unknown"} non-help-article chunks from docs`);
  }

  // Clear slack_threads table
  console.log("Clearing slack_threads table...");
  const { error: slackError } = await supabase
    .from("slack_threads")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (slackError) {
    console.log("Note: slack_threads cleanup skipped:", slackError.message);
  } else {
    console.log("Cleared slack_threads table");
  }

  console.log("\nPurge complete.");
}

purgeOldSources().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
