import "dotenv/config";
import { retrieveContext } from "./retrieve.js";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npx tsx src/retrieval/testRetrieve.ts "your question"');
    process.exit(1);
  }

  console.log(`\nQuestion: "${question}"\n`);

  const result = await retrieveContext(question);

  console.log(`\n--- Results ---`);
  console.log(`Confident: ${result.isConfident}`);
  console.log(`Chunks found: ${result.chunks.length}`);
  console.log(`Avg similarity: ${result.avgSimilarity.toFixed(3)}`);
  console.log(`Total tokens: ${result.totalTokens}`);

  console.log("\nTop matches:\n");
  for (const chunk of result.chunks) {
    console.log(`- similarity: ${chunk.similarity?.toFixed(3)}`);
    console.log(`  source: ${chunk.metadata.source || "unknown"}`);
    console.log(`  ${chunk.content.slice(0, 200).replace(/\n/g, " ")}...`);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
