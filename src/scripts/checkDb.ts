import "dotenv/config";
import { supabase } from "../db/supabase.js";

async function main() {
  // Check documents by source
  const { data: docs } = await supabase.from("documents").select("source");

  console.log("\nDocuments by repo:");
  const repos: Record<string, number> = {};
  for (const d of docs || []) {
    const repo = d.source?.split("/").slice(0, 2).join("/") || "unknown";
    repos[repo] = (repos[repo] || 0) + 1;
  }
  for (const [repo, count] of Object.entries(repos)) {
    console.log(`  ${repo}: ${count}`);
  }

  // Check chunks count
  const { count: chunkCount } = await supabase
    .from("chunks")
    .select("*", { count: "exact", head: true });
  console.log("\nTotal chunks:", chunkCount);

  // Check embeddings count
  const { count: embCount } = await supabase
    .from("chunk_embeddings")
    .select("*", { count: "exact", head: true });
  console.log("Total embeddings:", embCount);
}

main().catch(console.error);
