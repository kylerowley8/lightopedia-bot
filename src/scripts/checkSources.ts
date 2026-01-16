import "dotenv/config";
import { supabase } from "../db/supabase.js";

async function main() {
  // Get all unique source prefixes from documents
  const { data: docs } = await supabase
    .from("documents")
    .select("source")
    .limit(2000);

  const prefixCounts: Record<string, number> = {};
  for (const d of docs || []) {
    // Get first 2 path segments as prefix
    const prefix = d.source?.split("/").slice(0, 2).join("/") || "unknown";
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
  }

  console.log("Indexed sources (by document count):");
  const sorted = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1]);
  for (const [src, count] of sorted) {
    console.log(`  ${src}: ${count} docs`);
  }

  // Total counts
  const { count: totalDocs } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true });
  const { count: totalChunks } = await supabase
    .from("chunks")
    .select("*", { count: "exact", head: true });

  console.log(`\nTotals: ${totalDocs} documents, ${totalChunks} chunks`);
}

main().catch(console.error);
