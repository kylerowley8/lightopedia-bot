import "dotenv/config";
import { supabase } from "../db/supabase.js";

async function main() {
  // Total docs chunks
  const { count: totalDocs } = await supabase
    .from("docs")
    .select("*", { count: "exact", head: true });
  console.log("\nTotal docs table chunks:", totalDocs);

  // Get sample to understand structure
  const { data: samples } = await supabase
    .from("docs")
    .select("metadata")
    .limit(5);

  if (samples && samples.length > 0) {
    console.log("\nSample metadata structure:", JSON.stringify(samples[0]?.metadata, null, 2));
  }

  // Count by source_type using RPC or pagination
  // Supabase default limit is 1000, so we need to paginate for accurate counts
  const byType: Record<string, number> = {};
  const byRepo: Record<string, number> = {};

  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: page } = await supabase
      .from("docs")
      .select("metadata")
      .range(offset, offset + pageSize - 1);

    if (!page || page.length === 0) {
      hasMore = false;
      break;
    }

    for (const doc of page) {
      const meta = doc.metadata as any;
      const sourceType = meta?.source_type || "unknown";
      const repoSlug = meta?.repo_slug || "unknown";

      byType[sourceType] = (byType[sourceType] || 0) + 1;
      byRepo[repoSlug] = (byRepo[repoSlug] || 0) + 1;
    }

    offset += pageSize;
    if (page.length < pageSize) {
      hasMore = false;
    }
  }

  console.log("\nBy source type:");
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\nBy repo:");
  for (const [repo, count] of Object.entries(byRepo).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${repo}: ${count}`);
  }

  // Slack threads
  const { count: slackCount } = await supabase
    .from("slack_threads")
    .select("*", { count: "exact", head: true });
  console.log("\nSlack thread chunks:", slackCount);
}

main().catch(console.error);
