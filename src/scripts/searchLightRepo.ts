import "dotenv/config";
import { supabase } from "../db/supabase.js";

async function main() {
  // Search for customer-related content in light-space/light
  const { data: customerChunks } = await supabase
    .from("chunks")
    .select("id, content, metadata")
    .like("metadata->>source", "light-space/light%")
    .ilike("content", "%customer%")
    .limit(5);

  console.log("Customer chunks in light-space/light:", customerChunks?.length);
  for (const c of customerChunks || []) {
    const meta = c.metadata as any;
    console.log("\n  Source:", meta?.source?.slice(0, 80));
    console.log("  Content:", c.content.slice(0, 150).replace(/\n/g, " "));
  }

  // Search for import-related content
  const { data: importChunks } = await supabase
    .from("chunks")
    .select("id, content, metadata")
    .like("metadata->>source", "light-space/light%")
    .ilike("content", "%import%")
    .limit(5);

  console.log("\n\nImport chunks in light-space/light:", importChunks?.length);
  for (const c of importChunks || []) {
    const meta = c.metadata as any;
    console.log("\n  Source:", meta?.source?.slice(0, 80));
    console.log("  Content:", c.content.slice(0, 150).replace(/\n/g, " "));
  }

  // Check what file types are indexed
  const { data: docs } = await supabase
    .from("documents")
    .select("source")
    .like("source", "light-space/light%")
    .limit(100);

  const extensions: Record<string, number> = {};
  for (const d of docs || []) {
    const ext = d.source?.split(".").pop() || "none";
    extensions[ext] = (extensions[ext] || 0) + 1;
  }
  console.log("\n\nFile types in light-space/light:");
  for (const [ext, count] of Object.entries(extensions).sort((a, b) => b[1] - a[1])) {
    console.log(`  .${ext}: ${count}`);
  }
}

main().catch(console.error);
