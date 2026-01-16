import crypto from "crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { Request, Response } from "express";
import { indexDocument } from "../indexer/index.js";
import { shouldIndexPath } from "../indexer/config.js";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;
const APP_ID = process.env.GITHUB_APP_ID!;
const PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY!;

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const auth = createAppAuth({
    appId: APP_ID,
    privateKey: PRIVATE_KEY,
    installationId,
  });
  const { token } = await auth({ type: "installation" });
  return new Octokit({ auth: token });
}

export async function handleGitHubWebhook(req: Request, res: Response) {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const event = req.headers["x-github-event"] as string;
  const rawBody = (req as any).rawBody as string;

  if (!verifySignature(rawBody, signature)) {
    console.error("GitHub webhook signature verification failed");
    return res.status(401).send("Invalid signature");
  }

  if (event !== "push") {
    return res.status(200).send("Ignored event: " + event);
  }

  const payload = req.body;
  const ref = payload.ref as string;
  const repoFullName = payload.repository?.full_name as string;
  const commitSha = payload.after as string;
  const installationId = payload.installation?.id as number;

  if (ref !== "refs/heads/main") {
    return res.status(200).send("Ignored ref: " + ref);
  }

  console.log(`Push to main: ${repoFullName} @ ${commitSha}`);

  // Respond immediately, process async
  res.status(202).send("Accepted");

  try {
    await processRepoUpdate(repoFullName, commitSha, installationId);
  } catch (err) {
    console.error("Error processing repo update:", err);
  }
}

async function processRepoUpdate(repoFullName: string, commitSha: string, installationId: number) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationOctokit(installationId);

  console.log(`Fetching docs from ${repoFullName}...`);

  // Find all files in the repo
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  // Filter to files we should index
  const indexableFiles = tree.tree.filter(
    (item) => item.type === "blob" && item.path && shouldIndexPath(item.path)
  );

  console.log(`Found ${indexableFiles.length} indexable files`);

  let indexed = 0;
  let errors = 0;

  for (const file of indexableFiles) {
    if (!file.path || !file.sha) continue;

    try {
      const { data: blob } = await octokit.git.getBlob({ owner, repo, file_sha: file.sha });
      const content = Buffer.from(blob.content, "base64").toString("utf-8");

      console.log(`Indexing: ${file.path} (${content.length} chars)`);

      const result = await indexDocument(repoFullName, file.path, content, commitSha);
      if (result.chunksCreated > 0) indexed++;
    } catch (err) {
      console.error(`Error indexing ${file.path}:`, err);
      errors++;
    }
  }

  console.log(`Done processing ${repoFullName}: ${indexed} indexed, ${errors} errors`);
}
