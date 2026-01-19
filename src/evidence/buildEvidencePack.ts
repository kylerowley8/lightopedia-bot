// ============================================
// Build Evidence Pack — V3: Code > Docs > Slack
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
 * V3 Strategy (Code > Docs > Slack):
 * - Primary: Code (ground truth for implementation)
 * - Secondary: Docs (customer commitments)
 * - Tertiary: Slack threads (internal guidance)
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
    logger.info("Processing attachments", {
      stage: "evidence",
      fileCount: files.length,
      fileNames: files.map((f) => f.name),
    });

    const attachments = await extractAttachments(files);
    pack.attachments = attachments;

    logger.info("Attachments extracted", {
      stage: "evidence",
      extractedCount: attachments.length,
      types: attachments.map((a) => a.type),
      textLengths: attachments.map((a) => a.extractedText.length),
    });

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
  return pack.codeChunks.length > 0 || pack.docs.length > 0 || pack.slackThreads.length > 0;
}

/**
 * Get top evidence items for context building.
 */
export function getTopEvidence(pack: EvidencePack, limit: number = 6): string[] {
  const evidence: Array<{ content: string; similarity: number; priority: number }> = [];

  // Add code (highest priority)
  for (const code of pack.codeChunks) {
    evidence.push({ content: code.content, similarity: code.similarity, priority: 3 });
  }

  // Add docs (medium priority)
  for (const doc of pack.docs) {
    evidence.push({ content: doc.content, similarity: doc.similarity, priority: 2 });
  }

  // Add Slack threads (lower priority)
  for (const thread of pack.slackThreads) {
    evidence.push({ content: thread.content, similarity: thread.similarity, priority: 1 });
  }

  // Sort by priority first, then similarity
  return evidence
    .sort((a, b) => b.priority - a.priority || b.similarity - a.similarity)
    .slice(0, limit)
    .map((e) => e.content);
}

/**
 * Build formatted context string for LLM.
 * V3 hierarchy: Code > Docs > Slack
 */
export function buildContextString(pack: EvidencePack): string {
  const sections: string[] = [];
  let citationIndex = 1;

  // 1. CODE (ground truth for implementation)
  if (pack.codeChunks.length > 0) {
    sections.push("=== SOURCE CODE (Ground Truth) ===");
    for (const code of pack.codeChunks.slice(0, 5)) {
      const symbols = code.symbols.length > 0 ? ` [${code.symbols.join(", ")}]` : "";
      const lines = code.startLine > 0 ? `:${code.startLine}-${code.endLine}` : "";
      sections.push(`[${citationIndex}] CODE: ${code.path}${lines}${symbols}\n\`\`\`\n${code.content}\n\`\`\``);
      citationIndex++;
    }
  }

  // 2. DOCS (customer commitments)
  if (pack.docs.length > 0) {
    sections.push("\n=== DOCUMENTATION (Customer Commitments) ===");
    for (const doc of pack.docs.slice(0, 5)) {
      const source = doc.metadata.path || doc.source;
      sections.push(`[${citationIndex}] DOC: ${source}\n${doc.content}`);
      citationIndex++;
    }
  }

  // 3. SLACK (internal guidance)
  if (pack.slackThreads.length > 0) {
    sections.push("\n=== SLACK (Internal Guidance) ===");
    for (const thread of pack.slackThreads.slice(0, 3)) {
      sections.push(`[${citationIndex}] SLACK: ${thread.topic}\n${thread.content}`);
      citationIndex++;
    }
  }

  // 4. Attachments (images get more space since they contain extracted context)
  if (pack.attachments && pack.attachments.length > 0) {
    sections.push("\n=== USER ATTACHMENTS ===");
    for (const att of pack.attachments) {
      const maxLen = att.type === "image" ? 2000 : 500;
      sections.push(`[${citationIndex}] ATTACHMENT (${att.type})\n${att.extractedText.slice(0, maxLen)}`);
      citationIndex++;
    }
  }

  return sections.join("\n\n");
}
