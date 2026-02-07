import crypto from "crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { Request, Response } from "express";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { indexDocument } from "../indexer/index.js";
import { shouldIndexPath, isAllowedRepo } from "../indexer/config.js";

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!signature || !config.github.webhookSecret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", config.github.webhookSecret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  if (!config.github.appId || !config.github.privateKey) {
    throw new Error("GitHub App not configured");
  }
  const auth = createAppAuth({
    appId: config.github.appId,
    privateKey: config.github.privateKey,
    installationId,
  });
  const { token } = await auth({ type: "installation" });
  return new Octokit({ auth: token });
}

export async function handleGitHubWebhook(req: Request, res: Response): Promise<void> {
  if (!config.github.isConfigured) {
    logger.warn("GitHub webhook received but GitHub is not configured", { stage: "github" });
    res.status(503).send("GitHub integration not configured");
    return;
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const event = req.headers["x-github-event"] as string;
  const rawBody = (req as { rawBody?: string }).rawBody;

  if (!rawBody || !verifySignature(rawBody, signature)) {
    logger.error("GitHub webhook signature verification failed", { stage: "github" });
    res.status(401).send("Invalid signature");
    return;
  }

  if (event !== "push") {
    res.status(200).send("Ignored event: " + event);
    return;
  }

  const payload = req.body as {
    ref?: string;
    repository?: { full_name?: string };
    after?: string;
    installation?: { id?: number };
  };

  const ref = payload.ref;
  const repoFullName = payload.repository?.full_name;
  const commitSha = payload.after;
  const installationId = payload.installation?.id;

  if (!repoFullName || !commitSha || !installationId) {
    logger.error("Invalid webhook payload", { stage: "github", ref, repoFullName });
    res.status(400).send("Invalid payload");
    return;
  }

  if (ref !== "refs/heads/main") {
    res.status(200).send("Ignored ref: " + ref);
    return;
  }

  logger.info("Push to main received", {
    stage: "github",
    repo: repoFullName,
    commit: commitSha.slice(0, 7),
  });

  // Respond immediately, process async
  res.status(202).send("Accepted");

  try {
    await processRepoUpdate(repoFullName, commitSha, installationId);
  } catch (err) {
    logger.error("Error processing repo update", { stage: "github", repo: repoFullName, error: err });
  }
}

async function processRepoUpdate(repoFullName: string, commitSha: string, installationId: number): Promise<void> {
  const parts = repoFullName.split("/");
  const owner = parts[0];
  const repo = parts[1];

  if (!owner || !repo) {
    throw new Error(`Invalid repo name: ${repoFullName}`);
  }

  if (!isAllowedRepo(repoFullName)) {
    logger.warn("Ignoring push from non-allowed repo", { stage: "github", repo: repoFullName });
    return;
  }

  const octokit = await getInstallationOctokit(installationId);

  logger.info("Fetching repo tree", { stage: "index", repo: repoFullName });

  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  const indexableFiles = tree.tree.filter(
    (item) => item.type === "blob" && item.path && shouldIndexPath(item.path)
  );

  logger.info("Found indexable files", { stage: "index", repo: repoFullName, count: indexableFiles.length });

  let indexed = 0;
  let errors = 0;

  for (const file of indexableFiles) {
    const filePath = file.path;
    const fileSha = file.sha;
    if (!filePath || !fileSha) continue;

    try {
      const { data: blob } = await octokit.git.getBlob({ owner, repo, file_sha: fileSha });
      const content = Buffer.from(blob.content, "base64").toString("utf-8");

      logger.debug("Indexing file", { stage: "index", path: filePath, chars: content.length });

      const result = await indexDocument(repoFullName, filePath, content, commitSha);
      if (result.chunksCreated > 0) indexed++;
    } catch (err) {
      logger.error("Error indexing file", { stage: "index", path: filePath, error: err });
      errors++;
    }
  }

  logger.info("Repo processing complete", {
    stage: "index",
    repo: repoFullName,
    indexed,
    errors,
  });
}
