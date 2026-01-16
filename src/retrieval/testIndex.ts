import "dotenv/config";
import { supabase } from "../db/supabase.js";
import { embedChunks } from "./embeddings.js";

const TEST_CONTENT = `
# Light Platform Overview

Light is a modern data integration platform that helps teams connect their tools and automate workflows.

## Key Features

Light provides real-time data sync between your favorite tools. It supports bi-directional sync, meaning changes in one system automatically reflect in connected systems.

## Salesforce Integration

Light integrates with Salesforce through a native connector. You can sync contacts, accounts, opportunities, and custom objects. The integration supports both sandbox and production environments.

To set up the Salesforce integration:
1. Go to Settings > Integrations > Salesforce
2. Click "Connect" and authorize with your Salesforce credentials
3. Select the objects you want to sync
4. Configure field mappings

## Pricing

Light offers three tiers: Starter ($49/mo), Pro ($149/mo), and Enterprise (custom pricing). All plans include unlimited users and 24/7 support.
`.trim();

function chunkText(text: string, maxChunkSize = 500): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function main() {
  console.log("Inserting test document...");

  // Insert document (schema: source is required, title is optional)
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({ source: "test/overview.md", title: "Light Platform Overview" })
    .select()
    .single();

  if (docError) throw docError;
  console.log(`Created document: ${doc.id}`);

  // Create chunks
  const chunkTexts = chunkText(TEST_CONTENT);
  console.log(`Splitting into ${chunkTexts.length} chunks...`);

  const chunkRows = chunkTexts.map((content, i) => ({
    document_id: doc.id,
    content,
    chunk_index: i,
  }));

  const { data: chunks, error: chunkError } = await supabase
    .from("chunks")
    .insert(chunkRows)
    .select();

  if (chunkError) throw chunkError;
  console.log(`Created ${chunks.length} chunks`);

  // Generate embeddings
  console.log("Generating embeddings...");
  const embeddings = await embedChunks(chunkTexts);

  const embeddingRows = chunks.map((chunk, i) => ({
    chunk_id: chunk.id,
    embedding: embeddings[i],
  }));

  const { error: embError } = await supabase
    .from("chunk_embeddings")
    .insert(embeddingRows);

  if (embError) throw embError;
  console.log(`Created ${embeddingRows.length} embeddings`);

  console.log("\nDone! Now test retrieval:");
  console.log('npx tsx src/retrieval/testRetrieve.ts "How does Light integrate with Salesforce?"');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
