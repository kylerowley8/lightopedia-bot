import { supabase } from "../db/supabase.js";
import { embedChunks } from "../retrieval/embeddings.js";
import { chunkDocument } from "./chunker.js";
import { shouldIndexPath } from "./config.js";

export interface IndexResult {
  documentsProcessed: number;
  chunksCreated: number;
  embeddingsCreated: number;
  errors: string[];
}

export async function indexDocument(
  repoFullName: string,
  filePath: string,
  content: string,
  commitSha: string
): Promise<{ chunksCreated: number }> {
  const source = `${repoFullName}/${filePath}`;

  // Check if we should index this file
  if (!shouldIndexPath(filePath)) {
    console.log(`Skipping ${filePath} (not in allowlist)`);
    return { chunksCreated: 0 };
  }

  // Check if already indexed at this commit
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("source", source)
    .eq("commit_sha", commitSha)
    .single();

  if (existing) {
    console.log(`Already indexed: ${source} @ ${commitSha.slice(0, 7)}`);
    return { chunksCreated: 0 };
  }

  // Delete old version of this document
  await supabase.from("documents").delete().eq("source", source);

  // Insert new document
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      source,
      title: extractTitle(content, filePath),
      commit_sha: commitSha,
    })
    .select()
    .single();

  if (docError) throw docError;

  // Chunk the document
  const chunks = chunkDocument(content, source);
  if (chunks.length === 0) {
    console.log(`No chunks for ${source}`);
    return { chunksCreated: 0 };
  }

  // Insert chunks
  const chunkRows = chunks.map((c) => ({
    document_id: doc.id,
    chunk_index: c.index,
    content: c.content,
    metadata: c.metadata,
  }));

  const { data: insertedChunks, error: chunkError } = await supabase
    .from("chunks")
    .insert(chunkRows)
    .select("id");

  if (chunkError) throw chunkError;

  // Generate and insert embeddings
  const embeddings = await embedChunks(chunks.map((c) => c.content));

  const embeddingRows = insertedChunks.map((chunk, i) => ({
    chunk_id: chunk.id,
    embedding: embeddings[i],
  }));

  const { error: embError } = await supabase.from("chunk_embeddings").insert(embeddingRows);

  if (embError) throw embError;

  console.log(`Indexed ${source}: ${chunks.length} chunks`);
  return { chunksCreated: chunks.length };
}

export async function indexRepo(
  repoFullName: string,
  files: { path: string; content: string }[],
  commitSha: string
): Promise<IndexResult> {
  const result: IndexResult = {
    documentsProcessed: 0,
    chunksCreated: 0,
    embeddingsCreated: 0,
    errors: [],
  };

  for (const file of files) {
    try {
      const { chunksCreated } = await indexDocument(repoFullName, file.path, file.content, commitSha);
      if (chunksCreated > 0) {
        result.documentsProcessed++;
        result.chunksCreated += chunksCreated;
        result.embeddingsCreated += chunksCreated;
      }
    } catch (err) {
      const msg = `Failed to index ${file.path}: ${err}`;
      console.error(msg);
      result.errors.push(msg);
    }
  }

  return result;
}

function extractTitle(content: string, filePath: string): string {
  // Try to extract title from first heading
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1];

  // Fall back to filename
  return filePath.split("/").pop() || filePath;
}
