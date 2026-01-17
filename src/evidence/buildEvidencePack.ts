// ============================================
// Build Evidence Pack — Assemble evidence for synthesis
// ============================================

import { retrieveDocs } from "../retrieval/docsRetrieval.js";
import { extractAttachmentText } from "../attachments/extractText.js";
import { logger } from "../lib/logger.js";
import type { EvidencePack, AttachmentEvidence } from "./types.js";
import type { RouteDecision } from "../router/types.js";
import type { SlackFile } from "../app/types.js";

/**
 * Build a complete evidence pack for a question.
 *
 * V1 Strategy:
 * - Primary: Docs retrieval
 * - Secondary: Slack threads
 * - Optional: User attachments
 */
export async function buildEvidencePack(
  question: string,
  route: RouteDecision,
  files?: SlackFile[]
): Promise<EvidencePack> {
  logger.info("Building evidence pack", {
    stage: "evidence",
    mode: route.mode,
    hasFiles: (files?.length ?? 0) > 0,
  });

  // Retrieve docs (primary + Slack secondary)
  const pack = await retrieveDocs(question, route);

  // Extract attachment evidence if provided
  if (files && files.length > 0) {
    const attachments = await extractAttachments(files);
    pack.attachments = attachments;

    // Use attachment identifiers to augment retrieval if helpful
    const identifiers = attachments.flatMap((a) => a.identifiers);
    if (identifiers.length > 0) {
      logger.info("Attachment identifiers found", {
        stage: "evidence",
        identifiers,
      });
      // Could re-run retrieval with identifiers as hints
      // For V1, just include as context
    }
  }

  return pack;
}

/**
 * Extract evidence from user-provided attachments.
 */
async function extractAttachments(files: SlackFile[]): Promise<AttachmentEvidence[]> {
  const results: AttachmentEvidence[] = [];

  for (const file of files) {
    try {
      const extracted = await extractAttachmentText(file);
      if (extracted) {
        results.push(extracted);
      }
    } catch (err) {
      logger.warn("Failed to extract attachment", {
        stage: "evidence",
        fileName: file.name,
        error: err,
      });
    }
  }

  return results;
}

/**
 * Check if evidence pack has sufficient content.
 */
export function hasEvidence(pack: EvidencePack): boolean {
  return pack.docs.length > 0 || pack.slackThreads.length > 0;
}

/**
 * Get top evidence items for context building.
 */
export function getTopEvidence(pack: EvidencePack, limit: number = 6): string[] {
  const evidence: Array<{ content: string; similarity: number }> = [];

  // Add docs
  for (const doc of pack.docs) {
    evidence.push({ content: doc.content, similarity: doc.similarity });
  }

  // Add Slack threads
  for (const thread of pack.slackThreads) {
    evidence.push({ content: thread.content, similarity: thread.similarity });
  }

  // Sort by similarity and take top N
  return evidence
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map((e) => e.content);
}

/**
 * Build formatted context string for LLM.
 */
export function buildContextString(pack: EvidencePack): string {
  const sections: string[] = [];
  let citationIndex = 1;

  // Add docs with citation numbers
  for (const doc of pack.docs.slice(0, 6)) {
    const source = doc.metadata.path || doc.source;
    sections.push(`[${citationIndex}] ${source}\n${doc.content}`);
    citationIndex++;
  }

  // Add Slack threads
  for (const thread of pack.slackThreads.slice(0, 3)) {
    sections.push(`[${citationIndex}] Slack: ${thread.topic}\n${thread.content}`);
    citationIndex++;
  }

  // Add attachments if present
  if (pack.attachments && pack.attachments.length > 0) {
    for (const att of pack.attachments) {
      sections.push(`[${citationIndex}] User attachment (${att.type})\n${att.extractedText.slice(0, 500)}`);
      citationIndex++;
    }
  }

  return sections.join("\n\n---\n\n");
}
