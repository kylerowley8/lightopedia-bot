// ============================================
// Attachment Text Extraction
// ============================================

import { logger } from "../lib/logger.js";
import type { AttachmentEvidence } from "../evidence/types.js";
import type { SlackFile } from "../app/types.js";

/**
 * Extract text and identifiers from a Slack file attachment.
 *
 * V1 supports:
 * - Plain text / log files
 * - (Future: Images via OCR, PDFs)
 */
export async function extractAttachmentText(
  file: SlackFile
): Promise<AttachmentEvidence | null> {
  const { mimetype, name, url } = file;

  logger.info("Extracting attachment", {
    stage: "attachments",
    name,
    mimetype,
  });

  // Determine attachment type
  const type = getAttachmentType(mimetype, name);
  if (!type) {
    logger.warn("Unsupported attachment type", {
      stage: "attachments",
      mimetype,
      name,
    });
    return null;
  }

  // For V1, only handle text-based files
  if (type === "log") {
    return await extractLogFile(file);
  }

  // Image and PDF extraction would go here in future
  // For now, return null for unsupported types
  return null;
}

/**
 * Determine attachment type from mimetype and filename.
 */
function getAttachmentType(
  mimetype: string,
  filename: string
): AttachmentEvidence["type"] | null {
  // Text/log files
  if (
    mimetype.startsWith("text/") ||
    mimetype === "application/json" ||
    filename.endsWith(".log") ||
    filename.endsWith(".txt") ||
    filename.endsWith(".json")
  ) {
    return "log";
  }

  // Images
  if (mimetype.startsWith("image/")) {
    return "image";
  }

  // PDFs
  if (mimetype === "application/pdf") {
    return "pdf";
  }

  return null;
}

/**
 * Extract text from a log/text file.
 */
async function extractLogFile(file: SlackFile): Promise<AttachmentEvidence | null> {
  try {
    // Fetch file content
    // Note: In production, would use Slack API with auth token
    // For now, this is a placeholder
    const response = await fetch(file.url, {
      headers: {
        // Would need: Authorization: `Bearer ${slackToken}`
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const text = await response.text();

    // Extract identifiers from the log
    const identifiers = extractIdentifiers(text);

    return {
      type: "log",
      extractedText: text.slice(0, 5000), // Limit size
      identifiers,
      slackFileId: file.id,
    };
  } catch (err) {
    logger.error("Failed to extract log file", {
      stage: "attachments",
      fileName: file.name,
      error: err,
    });
    return null;
  }
}

/**
 * Extract identifiers from text (error codes, UUIDs, endpoints, etc.)
 */
function extractIdentifiers(text: string): string[] {
  const identifiers: string[] = [];

  // UUIDs
  const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (uuids) {
    identifiers.push(...uuids.slice(0, 5));
  }

  // Error codes (e.g., ERR_001, INVOICE_NOT_FOUND)
  const errorCodes = text.match(/\b[A-Z][A-Z0-9_]{3,30}\b/g);
  if (errorCodes) {
    identifiers.push(...errorCodes.slice(0, 5));
  }

  // API endpoints
  const endpoints = text.match(/\/(api|v1|v2)\/[a-z0-9/_-]+/gi);
  if (endpoints) {
    identifiers.push(...endpoints.slice(0, 3));
  }

  // HTTP status codes with context
  const httpErrors = text.match(/\b(4|5)\d{2}\s+\w+/g);
  if (httpErrors) {
    identifiers.push(...httpErrors.slice(0, 3));
  }

  return [...new Set(identifiers)];
}
