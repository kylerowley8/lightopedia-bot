import "dotenv/config";
import { supabase } from "../db/supabase.js";

async function main() {
  // Get chunks for the bills doc
  const { data: chunks } = await supabase
    .from("chunks")
    .select("id, chunk_index, content, metadata")
    .filter("metadata->>source", "eq", "notion-docs/docs/bills-supplier-invoices.md");

  console.log(`Chunks for bills doc: ${chunks?.length}\n`);

  for (const c of chunks ?? []) {
    const tokens = Math.ceil(c.content.length / 4);
    console.log(`Chunk ${c.chunk_index}: ${c.content.length} chars (~${tokens} tokens)`);
    console.log(`  "${c.content.slice(0, 80).replace(/\n/g, " ")}..."`);
  }

  // Check if embeddings exist
  if (chunks && chunks.length > 0) {
    const chunkIds = chunks.map((c) => c.id);
    const { data: embeddings } = await supabase
      .from("chunk_embeddings")
      .select("chunk_id")
      .in("chunk_id", chunkIds);

    console.log(`\nEmbeddings found: ${embeddings?.length} of ${chunks.length}`);
  }
}

main().catch(console.error);
