// ============================================
// Technical Renderer — Opt-in detailed view
// For engineers, includes citations and file paths
// ============================================

import type { SlackResponse, SlackBlock, SlackButton } from "../app/types.js";
import type { PipelineResult } from "../app/types.js";
import type { DocChunk, SlackThread } from "../evidence/types.js";

/**
 * Render a technical Slack response.
 *
 * Shown after "Show technical details" button click.
 * Includes:
 * - Answer with inline citations
 * - Evidence sources with paths
 * - Retrieval metadata
 */
export function renderTechnical(result: PipelineResult): SlackResponse {
  const { answer, evidence, metadata } = result;
  const blocks: SlackBlock[] = [];

  // Header
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Technical Details*",
    },
  });

  blocks.push({ type: "divider" });

  // Answer with citations
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: answer.summary,
    },
  });

  // Claims with citation references
  if (answer.claims.length > 0) {
    for (const claim of answer.claims) {
      const citationRefs = claim.citations
        .map((c) => `[${c.label ?? c.ref}]`)
        .join(" ");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• ${claim.text} ${citationRefs}`,
        },
      });
    }
  }

  blocks.push({ type: "divider" });

  // Evidence sources
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Sources*",
    },
  });

  // Docs
  const docSources = formatDocSources(evidence.docs.slice(0, 5));
  if (docSources) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: docSources,
      },
    });
  }

  // Slack threads
  const slackSources = formatSlackSources(evidence.slackThreads.slice(0, 3));
  if (slackSources) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackSources,
      },
    });
  }

  // Retrieval metadata
  blocks.push({ type: "divider" });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: formatRetrievalMeta(evidence.retrievalMeta, metadata),
      },
    ],
  });

  // Back button
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "← Back to summary" },
        action_id: "hide_technical",
        value: metadata.requestId,
      },
    ],
  });

  return {
    text: "Technical details",
    blocks,
  };
}

/**
 * Format doc sources for display.
 */
function formatDocSources(docs: DocChunk[]): string {
  if (docs.length === 0) return "";

  const lines = docs.map((doc, i) => {
    const path = doc.metadata.path || doc.source;
    const similarity = (doc.similarity * 100).toFixed(0);
    return `${i + 1}. \`${path}\` (${similarity}% match)`;
  });

  return `📄 *Docs:*\n${lines.join("\n")}`;
}

/**
 * Format Slack thread sources for display.
 */
function formatSlackSources(threads: SlackThread[]): string {
  if (threads.length === 0) return "";

  const lines = threads.map((thread, i) => {
    const topic = thread.topic.slice(0, 50);
    const similarity = (thread.similarity * 100).toFixed(0);
    const permalink = thread.permalink ? ` (<${thread.permalink}|link>)` : "";
    return `${i + 1}. ${topic}${permalink} (${similarity}% match)`;
  });

  return `💬 *Slack:*\n${lines.join("\n")}`;
}

/**
 * Format retrieval metadata.
 */
function formatRetrievalMeta(
  retrievalMeta: PipelineResult["evidence"]["retrievalMeta"],
  metadata: PipelineResult["metadata"]
): string {
  return [
    `Mode: ${metadata.mode}`,
    `Latency: ${metadata.latencyMs}ms`,
    `Searched: ${retrievalMeta.totalSearched} chunks`,
    `Version: ${retrievalMeta.version}`,
    `ID: ${metadata.requestId}`,
  ].join(" | ");
}
