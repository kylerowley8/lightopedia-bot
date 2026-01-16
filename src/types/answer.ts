import { z } from "zod";

// ============================================
// Structured Answer Contract
// The model outputs this JSON, we validate and render to Slack
// ============================================

/** A source reference for citations */
export const SourceSchema = z.object({
  id: z.number(),
  title: z.string(),
  path: z.string(),
  url: z.string().optional(),
  lines: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .optional(),
  snippet: z.string().optional(),
});

export type Source = z.infer<typeof SourceSchema>;

/** A bullet point with citations */
export const BulletSchema = z.object({
  text: z.string().max(200, "Bullet too long"),
  citations: z.array(z.number()).default([]),
});

export type Bullet = z.infer<typeof BulletSchema>;

/** Confidence level */
export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

/** The full structured answer payload */
export const AnswerPayloadSchema = z.object({
  /** One-sentence direct answer */
  summary: z.string().max(300, "Summary too long"),
  /** Supporting details as bullets with citations */
  bullets: z.array(BulletSchema).max(5, "Too many bullets").default([]),
  /** Sources used */
  sources: z.array(SourceSchema).default([]),
  /** Confidence level */
  confidence: ConfidenceLevelSchema,
  /** Optional follow-up questions */
  followups: z.array(z.string()).optional(),
});

/** Check if all bullets have citations */
export function validateCitations(payload: AnswerPayload): {
  isValid: boolean;
  uncitedCount: number;
} {
  const uncitedBullets = payload.bullets.filter((b) => b.citations.length === 0);
  return {
    isValid: uncitedBullets.length === 0,
    uncitedCount: uncitedBullets.length,
  };
}

export type AnswerPayload = z.infer<typeof AnswerPayloadSchema>;

/** Result of parsing attempt with error details */
export interface ParseResult {
  success: boolean;
  payload: AnswerPayload | null;
  error?: string;
}

/** Parse and validate LLM output with detailed error reporting */
export function parseAnswerPayload(raw: string): AnswerPayload | null {
  const result = parseAnswerPayloadWithDetails(raw);
  return result.payload;
}

/** Parse with detailed error information for retry logic */
export function parseAnswerPayloadWithDetails(raw: string): ParseResult {
  try {
    // Try to extract JSON - use balanced brace matching for robustness
    const jsonStr = extractJson(raw);
    if (!jsonStr) {
      return { success: false, payload: null, error: "No JSON object found in response" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return { success: false, payload: null, error: `JSON parse error: ${e}` };
    }

    const result = AnswerPayloadSchema.safeParse(parsed);

    if (result.success) {
      return { success: true, payload: result.data };
    }

    // Extract first error message for debugging
    const firstError = result.error.issues[0];
    const errorPath = firstError?.path.join(".") || "unknown";
    const errorMsg = firstError?.message || "validation failed";

    return {
      success: false,
      payload: null,
      error: `Validation error at ${errorPath}: ${errorMsg}`,
    };
  } catch (e) {
    return { success: false, payload: null, error: `Unexpected error: ${e}` };
  }
}

/** Extract first complete JSON object from text using brace counting */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // Fallback to greedy regex if brace counting fails
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/** Build sources from retrieved chunks */
export function buildSources(
  chunks: Array<{
    chunkId: string;
    content: string;
    metadata: { source: string; commitSha?: string };
    similarity: number;
  }>,
  repoBaseUrl?: string
): Source[] {
  return chunks.map((chunk, i) => {
    const path = chunk.metadata.source;
    const title = extractFileName(path);

    return {
      id: i + 1,
      title,
      path,
      url: repoBaseUrl ? buildGithubUrl(repoBaseUrl, path, chunk.metadata.commitSha) : undefined,
      snippet: chunk.content.slice(0, 100),
    };
  });
}

function extractFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function buildGithubUrl(repoBaseUrl: string, path: string, commitSha?: string): string {
  // Remove repo prefix from path if present (e.g., "org/repo/src/file.ts" -> "src/file.ts")
  const pathParts = path.split("/");
  const cleanPath = pathParts.length > 2 ? pathParts.slice(2).join("/") : path;

  if (commitSha) {
    return `${repoBaseUrl}/blob/${commitSha}/${cleanPath}`;
  }
  return `${repoBaseUrl}/blob/main/${cleanPath}`;
}
