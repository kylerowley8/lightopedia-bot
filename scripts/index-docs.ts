#!/usr/bin/env npx tsx
// ============================================
// Docs Indexer Script — Manual indexing trigger
// ============================================
// Usage: npm run index:docs -- --repo light-space/light
//
// Prerequisites:
// - Supabase migrations applied
// - GITHUB_TOKEN or GitHub App configured (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY)
// - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY set

import "dotenv/config";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { indexRepo } from "../src/indexer/docsIndexer.js";
import { isAllowedRepo, shouldIndexPath, ALLOWED_REPOS } from "../src/indexer/config.js";
import { config, env } from "../src/config/env.js";

// ============================================
// GitHub Auth (App or PAT)
// ============================================

async function getOctokit(owner: string): Promise<Octokit> {
  // Try GitHub App first if configured
  if (config.github.isConfigured) {
    log("🔑", "Using GitHub App authentication...");
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

    log("✅", `Found installation ID: ${installation.id}`);

    const auth = createAppAuth({
      appId: config.github.appId!,
      privateKey: config.github.privateKey!,
      installationId: installation.id,
    });
    const { token } = await auth({ type: "installation" });
    return new Octokit({ auth: token });
  }

  // Fall back to personal access token
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "No GitHub credentials configured.\n" +
      "Either set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY for GitHub App auth,\n" +
      "or set GITHUB_TOKEN for personal access token auth."
    );
  }

  log("🔑", "Using personal access token (GITHUB_TOKEN)...");
  return new Octokit({ auth: token });
}

// ============================================
// Helpers
// ============================================

function log(emoji: string, message: string) {
  console.log(`${emoji} ${message}`);
}

async function fetchRepoFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<{ path: string; content: string; commitSha: string }[]> {
  log("📥", `Fetching files from ${owner}/${repo}@${branch}...`);

  // First verify we can access the repo
  try {
    await octokit.repos.get({ owner, repo });
  } catch (err: any) {
    if (err.status === 404) {
      throw new Error(
        `Repository ${owner}/${repo} not found or not accessible.\n` +
        `This could mean:\n` +
        `  - The repository doesn't exist\n` +
        `  - Your token doesn't have access to this private repository\n` +
        `  - The organization name or repo name is incorrect\n\n` +
        `If using a personal access token, ensure it has 'repo' scope for private repos.`
      );
    }
    throw err;
  }

  // Get the latest commit SHA
  let refData;
  try {
    const response = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    refData = response.data;
  } catch (err: any) {
    if (err.status === 404) {
      throw new Error(
        `Branch '${branch}' not found in ${owner}/${repo}.\n` +
        `Try specifying a different branch with --branch <name>`
      );
    }
    throw err;
  }
  const commitSha = refData.object.sha;
  log("📍", `Commit: ${commitSha.slice(0, 7)}`);

  // Get the tree
  const { data: commit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: commitSha,
  });

  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: commit.tree.sha,
    recursive: "1",
  });

  // Filter for indexable files
  const indexableFiles = tree.tree.filter(
    (item) =>
      item.type === "blob" &&
      item.path &&
      shouldIndexPath(item.path)
  );

  log("📄", `Found ${indexableFiles.length} indexable files`);

  // Fetch content for each file
  const files: { path: string; content: string; commitSha: string }[] = [];

  for (const file of indexableFiles) {
    if (!file.path || !file.sha) continue;

    try {
      const { data: blob } = await octokit.git.getBlob({
        owner,
        repo,
        file_sha: file.sha,
      });

      // Decode base64 content
      const content = Buffer.from(blob.content, "base64").toString("utf-8");
      files.push({ path: file.path, content, commitSha });
    } catch (err) {
      log("⚠️", `Failed to fetch ${file.path}: ${err}`);
    }
  }

  return files;
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);

  // Parse args
  let repoSlug: string | undefined;
  let branch = "main";
  let force = false;
  let listOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo" && args[i + 1]) {
      repoSlug = args[++i];
    } else if (arg === "--branch" && args[i + 1]) {
      branch = args[++i]!;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--list") {
      listOnly = true;
    } else if (arg === "--help") {
      console.log(`
Usage: npm run index:docs -- [options]

Options:
  --repo <slug>     Repository to index (e.g., light-space/light)
  --branch <name>   Branch to index (default: main)
  --force           Re-index even if already indexed
  --list            List allowed repos and exit

Examples:
  npm run index:docs -- --repo light-space/light
  npm run index:docs -- --repo light-space/light --branch main --force
  npm run index:docs -- --list
`);
      process.exit(0);
    }
  }

  if (listOnly) {
    console.log("\nAllowed repositories:");
    for (const repo of ALLOWED_REPOS) {
      console.log(`  - ${repo}`);
    }
    process.exit(0);
  }

  if (!repoSlug) {
    console.error("Error: --repo is required");
    console.error("Use --list to see allowed repos, or --help for usage");
    process.exit(1);
  }

  if (!isAllowedRepo(repoSlug)) {
    console.error(`Error: Repository "${repoSlug}" is not in the allowlist`);
    console.error("Allowed repos:", ALLOWED_REPOS.join(", "));
    process.exit(1);
  }

  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) {
    console.error("Error: Invalid repo format. Expected owner/repo");
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("Lightopedia V2 Docs Indexer");
  console.log("========================================\n");

  // Get authenticated Octokit (tries GitHub App first, then PAT)
  const octokit = await getOctokit(owner);

  // Fetch files
  const filesWithMeta = await fetchRepoFiles(octokit, owner, repo, branch);

  if (filesWithMeta.length === 0) {
    log("⚠️", "No indexable files found");
    process.exit(0);
  }

  const commitSha = filesWithMeta[0]?.commitSha ?? "unknown";
  const files = filesWithMeta.map((f) => ({ path: f.path, content: f.content }));

  // Index
  log("🔄", "Starting indexing...");
  const result = await indexRepo(repoSlug, files, commitSha, { force });

  console.log("\n========================================");
  console.log("Results:");
  console.log("========================================");
  console.log(`  Index Run ID:     ${result.indexRunId}`);
  console.log(`  Documents:        ${result.documentsProcessed}`);
  console.log(`  Chunks Created:   ${result.chunksCreated}`);
  console.log(`  Skipped:          ${result.skipped}`);
  console.log(`  Errors:           ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log("\n✅ Indexing complete");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
