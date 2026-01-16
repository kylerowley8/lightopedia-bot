import "dotenv/config";
import fs from "fs";
import path from "path";
import { indexDocument } from "../indexer/index.js";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx src/scripts/indexLocalDoc.ts <path-to-md-file>");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, "utf-8");
  const fileName = path.basename(filePath);

  // Use "notion-docs" as pseudo-repo for local docs
  // Use docs/filename pattern to match **/*.md allowlist
  const docPath = `docs/${fileName}`;
  const result = await indexDocument("notion-docs", docPath, content, "local-" + Date.now());

  console.log(`Done. Chunks created: ${result.chunksCreated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
