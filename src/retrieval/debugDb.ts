import "dotenv/config";
import { supabase } from "../db/supabase.js";
import { embedQuery } from "./embeddings.js";

async function main() {
  const { data: docs } = await supabase.from("documents").select("*");
  console.log("Documents:", docs?.length);

  const { data: chunks } = await supabase.from("chunks").select("*");
  console.log("Chunks:", chunks?.length);

  const { data: embeddings } = await supabase.from("chunk_embeddings").select("chunk_id");
  console.log("Embeddings:", embeddings?.length);

  // Test match_chunks
  console.log("\nTesting match_chunks...");
  const testEmbedding = await embedQuery("Salesforce");

  // Try as array
  const { data: result1, error: err1 } = await supabase.rpc("match_chunks", {
    query_embedding: testEmbedding,
    match_count: 5,
  });
  console.log("As array - error:", err1?.message, "results:", result1?.length);

  // Try as string
  const embStr = `[${testEmbedding.join(",")}]`;
  const { data: result2, error: err2 } = await supabase.rpc("match_chunks", {
    query_embedding: embStr,
    match_count: 5,
  });
  console.log("As string - error:", err2?.message, "results:", result2?.length);

  // Check raw embedding storage
  const { data: rawEmb, error: rawErr } = await supabase
    .from("chunk_embeddings")
    .select("chunk_id, embedding")
    .limit(1);
  console.log("\nRaw embedding error:", rawErr?.message);
  if (rawEmb && rawEmb[0]) {
    const emb = rawEmb[0].embedding;
    console.log("Embedding type:", typeof emb);
    console.log("Embedding is array:", Array.isArray(emb));
    console.log("Embedding preview:", String(emb).slice(0, 100));
  }

  // Try direct SQL via a simple function
  console.log("\nTrying simple count of chunk_embeddings join chunks...");
  const { data: joinCount, error: joinErr } = await supabase
    .from("chunk_embeddings")
    .select("chunk_id, chunks(id, content)")
    .limit(3);
  console.log("Join error:", joinErr?.message);
  console.log("Join results:", joinCount?.length);
  if (joinCount) {
    for (const r of joinCount) {
      console.log("  chunk_id:", r.chunk_id, "has chunk:", !!(r as any).chunks);
    }
  }
}

main().catch(console.error);
