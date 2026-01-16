import "dotenv/config";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "../config/env.js";
import { indexDocument } from "../indexer/index.js";
import { shouldIndexPath } from "../indexer/config.js";
import { supabase } from "../db/supabase.js";

// Usage: npx tsx src/scripts/reindexRepo.ts <owner/repo> [branch]
// Example: npx tsx src/scripts/reindexRepo.ts light-space/light main

async function getInstallationId(octokit: Octokit, owner: string): Promise<number> {
  // List installations and find the one for this owner
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.github.appId,
      privateKey: config.github.privateKey,
    },
  });

  const { data: installations } = await appOctokit.apps.listInstallations();
  const installation = installations.find(
    (i) => i.account?.login?.toLowerCase() === owner.toLowerCase()
  );

  if (!installation) {
    throw new Error(`No GitHub App installation found for ${owner}`);
  }

  return installation.id;
}

async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const auth = createAppAuth({
    appId: config.github.appId!,
    privateKey: config.github.privateKey!,
    installationId,
  });
  const { token } = await auth({ type: "installation" });
  return new Octokit({ auth: token });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: npx tsx src/scripts/reindexRepo.ts <owner/repo> [branch]");
    console.error("Example: npx tsx src/scripts/reindexRepo.ts light-space/light main");
    process.exit(1);
  }

  const repoFullName = args[0]!;
  const branch = args[1] || "main";
  const [owner, repo] = repoFullName.split("/") as [string, string];

  if (!owner || !repo) {
    console.error("Invalid repo format. Use: owner/repo");
    process.exit(1);
  }

  if (!config.github.isConfigured) {
    console.error("GitHub App not configured. Check GITHUB_APP_ID and GITHUB_PRIVATE_KEY.");
    process.exit(1);
  }

  console.log(`\n🔄 Re-indexing ${repoFullName} (branch: ${branch})\n`);

  // Get installation
  const tempOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.github.appId,
      privateKey: config.github.privateKey,
    },
  });

  const installationId = await getInstallationId(tempOctokit, owner);
  console.log(`Found installation ID: ${installationId}`);

  const octokit = await getInstallationOctokit(installationId);

  // Get the latest commit SHA for the branch
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const commitSha = refData.object.sha;
  console.log(`Latest commit: ${commitSha.slice(0, 7)}`);

  // Delete old documents from this repo
  console.log(`\nDeleting old documents from ${repoFullName}...`);
  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .like("source", `${repoFullName}%`);

  if (deleteError) {
    console.error("Error deleting old documents:", deleteError);
  } else {
    console.log("Old documents deleted.");
  }

  // Fetch repo tree
  console.log("\nFetching repo tree...");
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  const allFiles = tree.tree.filter((item) => item.type === "blob" && item.path);
  const indexableFiles = allFiles.filter((item) => shouldIndexPath(item.path!));

  console.log(`Total files: ${allFiles.length}`);
  console.log(`Indexable files: ${indexableFiles.length}`);

  // Show file type breakdown
  const extensions: Record<string, number> = {};
  for (const file of indexableFiles) {
    const ext = file.path?.split(".").pop() || "none";
    extensions[ext] = (extensions[ext] || 0) + 1;
  }
  console.log("\nFile types to index:");
  for (const [ext, count] of Object.entries(extensions).sort((a, b) => b[1] - a[1])) {
    console.log(`  .${ext}: ${count}`);
  }

  // Index files
  console.log("\nIndexing files...");
  let indexed = 0;
  let errors = 0;
  let totalChunks = 0;

  for (let i = 0; i < indexableFiles.length; i++) {
    const file = indexableFiles[i]!;
    const filePath = file.path!;
    const fileSha = file.sha!;

    try {
      const { data: blob } = await octokit.git.getBlob({
        owner,
        repo,
        file_sha: fileSha,
      });
      const content = Buffer.from(blob.content, "base64").toString("utf-8");

      const result = await indexDocument(repoFullName, filePath, content, commitSha);

      if (result.chunksCreated > 0) {
        indexed++;
        totalChunks += result.chunksCreated;
      }

      // Progress update every 50 files
      if ((i + 1) % 50 === 0 || i === indexableFiles.length - 1) {
        console.log(`  Progress: ${i + 1}/${indexableFiles.length} files (${indexed} indexed, ${totalChunks} chunks)`);
      }

      // Small delay to avoid rate limits
      if ((i + 1) % 100 === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      errors++;
      console.error(`  Error indexing ${filePath}:`, (err as Error).message);
    }
  }

  console.log("\n========================================");
  console.log(`✅ Done! Re-indexed ${repoFullName}`);
  console.log(`   Files indexed: ${indexed}`);
  console.log(`   Chunks created: ${totalChunks}`);
  console.log(`   Errors: ${errors}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
