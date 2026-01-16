import "dotenv/config";
import { supabase } from "../db/supabase.js";

async function main() {
  const { data } = await supabase.from("chunks").select("metadata").limit(200);

  const sources = new Set<string>();
  for (const row of data ?? []) {
    const meta = row.metadata as Record<string, unknown>;
    if (meta?.source) sources.add(String(meta.source));
  }

  console.log(`Sources found (${sources.size}):`);
  for (const s of [...sources].sort()) {
    console.log(" ", s);
  }
}

main().catch(console.error);
