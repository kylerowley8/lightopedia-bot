import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { supabase } from "../db/supabase.js";
import { embedQuery } from "../retrieval/embeddings.js";

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

/**
 * Extract text from a PDF file using pdfjs-dist.
 */
async function extractPdfText(filePath: string): Promise<{ text: string; numPages: number }> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = new Uint8Array(dataBuffer);

  const pdf = await getDocument({ data }).promise;
  const numPages = pdf.numPages;

  let fullText = "";

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ");
    fullText += pageText + "\n\n";
  }

  return { text: fullText, numPages };
}

/**
 * Index a PDF file into the docs table.
 */
async function indexPdf(filePath: string) {
  console.log(`\n📄 Indexing PDF: ${filePath}`);

  // Extract text from PDF
  const { text, numPages } = await extractPdfText(filePath);

  console.log(`Pages: ${numPages}`);
  console.log(`Text length: ${text.length} characters`);

  // Clean up text
  const cleanedText = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Chunk the text
  const chunks = chunkText(cleanedText, CHUNK_SIZE, CHUNK_OVERLAP);
  console.log(`Chunks: ${chunks.length}`);

  // Get filename for metadata
  const fileName = path.basename(filePath);
  const indexRunId = crypto.randomUUID();

  // Delete existing chunks from this PDF
  console.log(`\nDeleting old chunks for ${fileName}...`);
  const { error: deleteError } = await supabase
    .from("docs")
    .delete()
    .eq("metadata->>path", fileName);

  if (deleteError) {
    console.error("Delete error:", deleteError);
  }

  // Index each chunk
  console.log("\nIndexing chunks...");
  let indexed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;

    try {
      // Generate embedding
      const embedding = await embedQuery(chunk);

      // Insert into docs table
      const { error } = await supabase.from("docs").insert({
        id: crypto.randomUUID(),
        content: chunk,
        embedding,
        metadata: {
          path: fileName,
          source_type: "pdf",
          chunk_index: i,
          total_chunks: chunks.length,
          indexed_at: new Date().toISOString(),
          index_run_id: indexRunId,
          retrieval_program_version: "retrieval.v1.0",
        },
      });

      if (error) {
        console.error(`Error inserting chunk ${i}:`, error);
      } else {
        indexed++;
        if ((i + 1) % 10 === 0) {
          console.log(`  Progress: ${i + 1}/${chunks.length}`);
        }
      }
    } catch (err) {
      console.error(`Failed to index chunk ${i}:`, err);
    }
  }

  console.log(`\n✅ Indexed ${indexed}/${chunks.length} chunks from ${fileName}`);
}

/**
 * Split text into overlapping chunks.
 */
function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + size;

    // Try to break at paragraph or sentence boundary
    if (end < text.length) {
      // Look for paragraph break
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + size / 2) {
        end = paragraphBreak;
      } else {
        // Look for sentence break
        const sentenceBreak = text.lastIndexOf(". ", end);
        if (sentenceBreak > start + size / 2) {
          end = sentenceBreak + 1;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

// Main
const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error("Usage: npx tsx src/scripts/indexPdf.ts <path-to-pdf>");
  process.exit(1);
}

if (!fs.existsSync(pdfPath)) {
  console.error(`File not found: ${pdfPath}`);
  process.exit(1);
}

indexPdf(pdfPath).catch(console.error);
