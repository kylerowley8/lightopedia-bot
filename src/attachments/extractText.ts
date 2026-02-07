// ============================================
// Attachment Text Extraction
// ============================================

import { logger } from "../lib/logger.js";
import { analyzeImage } from "../llm/client.js";
import { config } from "../config/env.js";
import type { AttachmentEvidence } from "../evidence/types.js";
import type { SlackFile } from "../app/types.js";

/**
 * Image analysis prompt.
 * Extracts text, UI elements, and context from screenshots.
 */
const IMAGE_ANALYSIS_PROMPT = `Analyze this screenshot and extract all relevant information.

Focus on:
1. **Text content** - Extract all visible text, labels, buttons, menu items
2. **UI context** - What screen/dialog/form is shown? What application?
3. **Data shown** - Any IDs, numbers, dates, status values, error messages
4. **User action** - What is the user trying to do or asking about?

Format your response as:
TEXT: [all visible text, line by line]
CONTEXT: [1-2 sentence description of what this screenshot shows]
IDENTIFIERS: [any IDs, error codes, or specific values that could help search]
USER_INTENT: [what the user might be asking about based on this image]`;

/**
 * Extract text and identifiers from a Slack file attachment.
 *
 * Supports:
 * - Plain text / log files
 * - Images (screenshots, UI captures) via GPT-4V
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

  // Handle text/log files
  if (type === "log") {
    return await extractLogFile(file);
  }

  // Handle images via GPT-4V vision
  if (type === "image") {
    return await extractImageFile(file);
  }

  // PDF extraction not yet implemented
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
 * Extract content from an image file using GPT-4V vision.
 */
async function extractImageFile(file: SlackFile): Promise<AttachmentEvidence | null> {
  try {
    logger.info("Analyzing image with GPT-4V", {
      stage: "attachments",
      fileName: file.name,
    });

    // Use Slack bot token to authenticate the image download
    const authHeader = `Bearer ${config.slack.botToken}`;

    // Analyze image with GPT-4V
    const analysis = await analyzeImage(file.url, IMAGE_ANALYSIS_PROMPT, {
      authHeader,
      maxTokens: 1500,
    });

    // Extract identifiers from the analysis
    const identifiers = extractIdentifiersFromAnalysis(analysis);

    logger.info("Image analysis complete", {
      stage: "attachments",
      fileName: file.name,
      extractedLength: analysis.length,
      identifierCount: identifiers.length,
    });

    return {
      type: "image",
      extractedText: analysis,
      identifiers,
      slackFileId: file.id,
    };
  } catch (err) {
    logger.error("Failed to analyze image", {
      stage: "attachments",
      fileName: file.name,
      error: err,
    });
    return null;
  }
}

/**
 * Extract identifiers from GPT-4V analysis output.
 */
function extractIdentifiersFromAnalysis(analysis: string): string[] {
  const identifiers: string[] = [];

  // Look for IDENTIFIERS section
  const identifiersMatch = analysis.match(/IDENTIFIERS:\s*(.+?)(?:\n[A-Z_]+:|$)/s);
  if (identifiersMatch) {
    const idText = identifiersMatch[1]!;
    // Split by commas, newlines, or common separators
    const ids = idText.split(/[,\n;]/).map((s) => s.trim()).filter((s) => s.length > 0 && s !== "None" && s !== "N/A");
    identifiers.push(...ids);
  }

  // Also extract any UUIDs found in the full text
  const uuids = analysis.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (uuids) {
    identifiers.push(...uuids.slice(0, 5));
  }

  // Extract error codes
  const errorCodes = analysis.match(/\b[A-Z][A-Z0-9_]{3,30}\b/g);
  if (errorCodes) {
    // Filter out common words that aren't identifiers
    const filtered = errorCodes.filter((code) =>
      !["TEXT", "CONTEXT", "IDENTIFIERS", "USER_INTENT", "NONE", "THE", "AND", "FOR"].includes(code)
    );
    identifiers.push(...filtered.slice(0, 5));
  }

  return [...new Set(identifiers)];
}

/**
 * Extract text from a log/text file.
 */
async function extractLogFile(file: SlackFile): Promise<AttachmentEvidence | null> {
  try {
    // Fetch file content with Slack auth - handle redirects manually
    // Authorization header gets stripped on cross-origin redirects
    let finalResponse: Response;
    const authHeader = `Bearer ${config.slack.botToken}`;

    // First request: check for redirect
    const initialResponse = await fetch(file.url, {
      headers: { Authorization: authHeader },
      redirect: "manual",
    });

    if (initialResponse.status >= 300 && initialResponse.status < 400) {
      // Redirect - Slack's redirect URL has auth baked in
      const redirectUrl = initialResponse.headers.get("location");
      if (!redirectUrl) {
        throw new Error("Redirect without Location header");
      }
      // Follow redirect WITHOUT auth header
      finalResponse = await fetch(redirectUrl);
    } else {
      finalResponse = initialResponse;
    }

    if (!finalResponse.ok) {
      throw new Error(`Failed to fetch: ${finalResponse.status}`);
    }

    const text = await finalResponse.text();

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
