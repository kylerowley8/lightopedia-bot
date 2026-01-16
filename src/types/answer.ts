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
  text: z.string(),
  citations: z.array(z.number()).default([]),
});

export type Bullet = z.infer<typeof BulletSchema>;

/** Confidence level */
export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

/** The full structured answer payload */
export const AnswerPayloadSchema = z.object({
  /** One-sentence direct answer */
  summary: z.string(),
  /** Supporting details as bullets with citations */
  bullets: z.array(BulletSchema).default([]),
  /** Sources used */
  sources: z.array(SourceSchema).default([]),
  /** Confidence level */
  confidence: ConfidenceLevelSchema,
  /** Optional follow-up questions */
  followups: z.array(z.string()).optional(),
});

export type AnswerPayload = z.infer<typeof AnswerPayloadSchema>;

/** Parse and validate LLM output */
export function parseAnswerPayload(raw: string): AnswerPayload | null {
  try {
    // Try to extract JSON from the response (in case there's extra text)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const result = AnswerPayloadSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    return null;
  } catch {
    return null;
  }
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
