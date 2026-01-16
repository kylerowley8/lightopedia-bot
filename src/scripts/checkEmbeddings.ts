import "dotenv/config";
import { supabase } from "../db/supabase.js";

async function main() {
  // Get a customer chunk
  const { data: chunk } = await supabase
    .from("chunks")
    .select("id, metadata")
    .like("metadata->>source", "docs-light-inc%customer%")
    .limit(1)
    .single();

  console.log("Customer chunk:", chunk?.id, chunk?.metadata);

  // Check if it has embedding
  if (chunk) {
    const { data: emb, error } = await supabase
      .from("chunk_embeddings")
      .select("chunk_id")
      .eq("chunk_id", chunk.id)
      .single();

    console.log("Has embedding:", emb ? "YES" : "NO", error?.message || "");
  }

  // Count chunks with embeddings for docs-light-inc
  const { data: docsChunks } = await supabase
    .from("chunks")
    .select("id")
    .like("metadata->>source", "docs-light-inc%")
    .limit(50);

  let withEmb = 0;
  let withoutEmb = 0;
  const missingIds: string[] = [];

  for (const c of docsChunks || []) {
    const { data } = await supabase
      .from("chunk_embeddings")
      .select("chunk_id")
      .eq("chunk_id", c.id)
      .single();
    if (data) {
      withEmb++;
    } else {
      withoutEmb++;
      if (missingIds.length < 5) missingIds.push(c.id);
    }
  }
  console.log("\ndocs-light-inc chunks (sampled 50):");
  console.log("  With embeddings:", withEmb);
  console.log("  Without embeddings:", withoutEmb);
  if (missingIds.length > 0) {
    console.log("  Sample missing IDs:", missingIds);
  }

  // Total embeddings count
  const { count: totalEmb } = await supabase
    .from("chunk_embeddings")
    .select("*", { count: "exact", head: true });
  console.log("\nTotal embeddings in database:", totalEmb);
}

main().catch(console.error);
