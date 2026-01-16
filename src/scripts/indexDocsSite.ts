import "dotenv/config";
import { parse } from "node-html-parser";
import { supabase } from "../db/supabase.js";
import { embedChunks } from "../retrieval/embeddings.js";
import { chunkDocument } from "../indexer/chunker.js";

// ============================================
// Docs Site Indexer
// Scrapes docs.light.inc and indexes content
// ============================================

const BASE_URL = "https://docs.light.inc";

// Pages to index (discovered from site navigation)
const PAGES = [
  // Getting Started
  "/getting-started/introduction",
  "/getting-started/authentication",
  "/getting-started/rate-limits",
  // Examples
  "/examples/oauth-callback",
  // API Reference - Core resources
  "/api-reference/v1--accounting-documents/list-accounting-documents",
  "/api-reference/v1--attachments/list-attachments",
  "/api-reference/v1--bank-accounts/list-bank-accounts",
  "/api-reference/v1--cards/list-cards",
  "/api-reference/v1--card-transactions/list-card-transactions",
  "/api-reference/v1--companies/get-company",
  "/api-reference/v1--contracts/list-contracts",
  "/api-reference/v1--contracts/get-contract",
  "/api-reference/v1--contracts/create-contract",
  "/api-reference/v1--credit-notes/list-credit-notes",
  "/api-reference/v1--customers/list-customers",
  "/api-reference/v1--customers/get-customer",
  "/api-reference/v1--customers/create-customer",
  "/api-reference/v1--expenses/list-expenses",
  "/api-reference/v1--invoice-payables/list-invoice-payables",
  "/api-reference/v1--invoice-payables/get-invoice-payable",
  "/api-reference/v1--invoice-receivables/list-invoice-receivables",
  "/api-reference/v1--invoice-receivables/get-invoice-receivable",
  "/api-reference/v1--invoice-receivables/create-invoice-receivable",
  "/api-reference/v1--products/list-products",
  "/api-reference/v1--purchase-orders/list-purchase-orders",
  "/api-reference/v1--vendors/list-vendors",
  "/api-reference/v1--vendors/get-vendor",
  "/api-reference/v1--ledger-accounts/list-ledger-accounts",
  "/api-reference/v1--journal-entries/list-journal-entries",
];

interface FetchedPage {
  url: string;
  path: string;
  title: string;
  content: string;
}

async function fetchPage(path: string): Promise<FetchedPage | null> {
  const url = `${BASE_URL}${path}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Failed to fetch ${path}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const root = parse(html);

    // Extract title
    const titleEl = root.querySelector("h1") || root.querySelector("title");
    const title = titleEl?.text?.trim() || path.split("/").pop() || "Untitled";

    // Extract main content - try multiple selectors
    const mainContent =
      root.querySelector("main") ||
      root.querySelector("article") ||
      root.querySelector('[class*="content"]') ||
      root.querySelector("body");

    if (!mainContent) {
      console.log(`No content found for ${path}`);
      return null;
    }

    // Convert HTML to plain text with basic markdown
    const content = htmlToMarkdown(mainContent.innerHTML, title);

    if (content.length < 50) {
      console.log(`Content too short for ${path}: ${content.length} chars`);
      return null;
    }

    // Skip "Page Not Found" pages
    if (title.toLowerCase().includes("page not found") || title.toLowerCase().includes("not found")) {
      console.log(`Skipping 404 page: ${path}`);
      return null;
    }

    return { url, path, title, content };
  } catch (err) {
    console.error(`Error fetching ${path}:`, err);
    return null;
  }
}

function htmlToMarkdown(html: string, title: string): string {
  const root = parse(html);

  // Remove script and style tags
  root.querySelectorAll("script, style, nav, footer, header").forEach(el => el.remove());

  let text = "";

  // Add title as heading
  text += `# ${title}\n\n`;

  // Process common elements
  const processNode = (node: ReturnType<typeof parse>): string => {
    let result = "";

    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        // Text node
        result += child.text;
      } else if (child.nodeType === 1) {
        // Element node
        const el = child as ReturnType<typeof parse>;
        const tagName = el.tagName?.toLowerCase();

        switch (tagName) {
          case "h1":
            result += `\n# ${el.text.trim()}\n\n`;
            break;
          case "h2":
            result += `\n## ${el.text.trim()}\n\n`;
            break;
          case "h3":
            result += `\n### ${el.text.trim()}\n\n`;
            break;
          case "h4":
          case "h5":
          case "h6":
            result += `\n#### ${el.text.trim()}\n\n`;
            break;
          case "p":
            result += `${el.text.trim()}\n\n`;
            break;
          case "li":
            result += `- ${el.text.trim()}\n`;
            break;
          case "ul":
          case "ol":
            result += processNode(el) + "\n";
            break;
          case "code":
          case "pre":
            result += `\`${el.text.trim()}\``;
            break;
          case "a":
            result += el.text.trim();
            break;
          case "table":
            result += formatTable(el) + "\n\n";
            break;
          case "div":
          case "section":
          case "article":
          case "span":
            result += processNode(el);
            break;
          default:
            if (el.text) {
              result += el.text.trim() + " ";
            }
        }
      }
    }

    return result;
  };

  text += processNode(root);

  // Clean up
  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return text;
}

function formatTable(tableEl: ReturnType<typeof parse>): string {
  const rows = tableEl.querySelectorAll("tr");
  if (rows.length === 0) return "";

  let result = "";
  rows.forEach((row, i) => {
    const cells = row.querySelectorAll("td, th");
    const cellTexts = cells.map(c => c.text.trim());
    result += `| ${cellTexts.join(" | ")} |\n`;
    if (i === 0) {
      result += `| ${cellTexts.map(() => "---").join(" | ")} |\n`;
    }
  });

  return result;
}

async function indexPage(page: FetchedPage): Promise<number> {
  const source = `docs-light-inc${page.path}`;
  const commitSha = `docs-${Date.now()}`;

  // Delete old version
  await supabase.from("documents").delete().eq("source", source);

  // Insert document
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      source,
      title: page.title,
      commit_sha: commitSha,
    })
    .select()
    .single();

  if (docError) {
    console.error(`Failed to insert document ${source}:`, docError);
    return 0;
  }

  // Chunk the content
  const chunks = chunkDocument(page.content, source);
  if (chunks.length === 0) {
    console.log(`No chunks for ${source}`);
    return 0;
  }

  // Insert chunks
  const chunkRows = chunks.map((c) => ({
    document_id: doc.id,
    chunk_index: c.index,
    content: c.content,
    metadata: { ...c.metadata, url: page.url },
  }));

  const { data: insertedChunks, error: chunkError } = await supabase
    .from("chunks")
    .insert(chunkRows)
    .select("id");

  if (chunkError) {
    console.error(`Failed to insert chunks for ${source}:`, chunkError);
    return 0;
  }

  // Generate embeddings in small batches to avoid token limits
  // Using batch size of 2 to stay well under 8192 token limit
  const BATCH_SIZE = 2;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchIds = insertedChunks.slice(i, i + BATCH_SIZE);

    try {
      const embeddings = await embedChunks(batch.map((c) => c.content));

      const embeddingRows = batchIds.map((chunk, j) => ({
        chunk_id: chunk.id,
        embedding: embeddings[j],
      }));

      const { error: embError } = await supabase.from("chunk_embeddings").insert(embeddingRows);
      if (embError) {
        console.error(`Failed to insert embeddings for ${source}:`, embError);
      }
    } catch (err) {
      console.error(`Embedding error for ${source} batch ${i}:`, err);
      // Continue with other batches
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 100));
  }

  return chunks.length;
}

async function main() {
  console.log(`Starting docs site indexer for ${BASE_URL}`);
  console.log(`Pages to index: ${PAGES.length}`);

  let totalPages = 0;
  let totalChunks = 0;

  for (const path of PAGES) {
    console.log(`\nFetching ${path}...`);
    const page = await fetchPage(path);

    if (page) {
      const chunks = await indexPage(page);
      if (chunks > 0) {
        totalPages++;
        totalChunks += chunks;
        console.log(`  ✓ Indexed: ${page.title} (${chunks} chunks)`);
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n========================================`);
  console.log(`Done! Indexed ${totalPages} pages, ${totalChunks} chunks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
