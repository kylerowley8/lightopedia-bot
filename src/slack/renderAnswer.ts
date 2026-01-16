import type { AnswerPayload, Source, ConfidenceLevel } from "../types/answer.js";

// ============================================
// Slack Block Kit Renderer
// Converts structured AnswerPayload to Slack blocks
// ============================================

// Slack block types (minimal definitions)
interface TextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

interface SectionBlock {
  type: "section";
  text: TextObject;
  accessory?: ButtonElement;
}

interface ContextBlock {
  type: "context";
  elements: TextObject[];
}

interface DividerBlock {
  type: "divider";
}

interface ActionsBlock {
  type: "actions";
  elements: ButtonElement[];
}

interface ButtonElement {
  type: "button";
  text: TextObject;
  action_id: string;
  value?: string;
  style?: "primary" | "danger";
}

type Block = SectionBlock | ContextBlock | DividerBlock | ActionsBlock;

export interface SlackMessage {
  blocks: Block[];
  text: string; // Fallback text for notifications
}

const MAX_TEXT_LENGTH = 3000; // Slack limit for text blocks
const MAX_BLOCKS = 50; // Slack limit for blocks

/** Render a structured answer to Slack Block Kit format */
export function renderAnswer(payload: AnswerPayload, requestId: string): SlackMessage {
  const blocks: Block[] = [];

  // 1. Summary as main section
  const summaryText = sanitizeMarkdown(payload.summary);
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: summaryText,
    },
  });

  // 2. Bullets with citations
  if (payload.bullets.length > 0) {
    const bulletText = payload.bullets
      .map((b) => {
        const citations = b.citations.length > 0 ? ` [${b.citations.join(", ")}]` : "";
        return `• ${sanitizeMarkdown(b.text)}${citations}`;
      })
      .join("\n");

    if (bulletText.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncateText(bulletText, MAX_TEXT_LENGTH),
        },
      });
    }
  }

  // 3. Sources as compact context block
  if (payload.sources.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: formatSources(payload.sources),
        },
      ],
    });
  }

  // 4. Confidence indicator + request ID
  const confidenceEmoji = getConfidenceEmoji(payload.confidence);
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${confidenceEmoji} Confidence: ${payload.confidence} • _Request ID: ${requestId}_`,
      },
    ],
  });

  // 5. Feedback buttons
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "👍 Helpful", emoji: true },
        action_id: "feedback_helpful",
        value: requestId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "👎 Not helpful", emoji: true },
        action_id: "feedback_not_helpful",
        value: requestId,
      },
    ],
  });

  // Build fallback text
  const fallbackText = buildFallbackText(payload, requestId);

  return {
    blocks: blocks.slice(0, MAX_BLOCKS),
    text: fallbackText,
  };
}

/** Low confidence payload structure */
interface LowConfidencePayload {
  summary: string;
  bullets: Array<{ text: string; citations: number[] }>;
}

/** Render low-confidence response with custom message */
export function renderLowConfidenceResponse(
  requestId: string,
  customMessage?: LowConfidencePayload
): SlackMessage {
  // Build message from custom payload or use default
  let text: string;
  if (customMessage) {
    const bulletText = customMessage.bullets.map((b) => `• ${b.text}`).join("\n");
    text = `${customMessage.summary}\n\n${bulletText}`;
  } else {
    text = `I don't see this covered in the current docs or code.

If this is something you think Light should support, the best next step is to submit a *Feature Request* so the Product team can review it.

*How to submit a feature request:*
1. Hover over this message
2. Click *"…" → "Create Issue in Linear"*
3. Select *Product Team* (not Product Delivery Team)
4. Choose the *Feature Request* template

Feature requests are reviewed by the Product team during regular triage.`;
  }

  return {
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `⚠️ Confidence: low • _Request ID: ${requestId}_`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "👍 Helpful", emoji: true },
            action_id: "feedback_helpful",
            value: requestId,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "👎 Not helpful", emoji: true },
            action_id: "feedback_not_helpful",
            value: requestId,
          },
        ],
      },
    ],
    text: `${customMessage?.summary ?? "I don't see this covered in the current docs."} (Request ID: ${requestId})`,
  };
}

/** Render plain text fallback (when structured output fails) */
export function renderPlainText(text: string, requestId: string, sources?: Source[]): SlackMessage {
  const blocks: Block[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateText(sanitizeMarkdown(text), MAX_TEXT_LENGTH),
      },
    },
  ];

  if (sources && sources.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: formatSources(sources),
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `_Request ID: ${requestId}_`,
      },
    ],
  });

  return {
    blocks,
    text: truncateText(text, 200) + `... (Request ID: ${requestId})`,
  };
}

// ============================================
// Helper functions
// ============================================

function formatSources(sources: Source[]): string {
  return (
    "📚 *Sources:* " +
    sources
      .map((s) => {
        if (s.url) {
          return `<${s.url}|[${s.id}] ${s.title}>`;
        }
        return `[${s.id}] ${s.path}`;
      })
      .join(" • ")
  );
}

function getConfidenceEmoji(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case "high":
      return "✅";
    case "medium":
      return "🔶";
    case "low":
      return "⚠️";
  }
}

function buildFallbackText(payload: AnswerPayload, requestId: string): string {
  let text = payload.summary;
  if (payload.bullets.length > 0) {
    text += "\n\n" + payload.bullets.map((b) => `• ${b.text}`).join("\n");
  }
  text += `\n\n(Request ID: ${requestId})`;
  return truncateText(text, 500);
}

/** Sanitize markdown for Slack compatibility */
export function sanitizeMarkdown(text: string): string {
  // Slack uses different markdown syntax
  let sanitized = text;

  // Convert markdown headers to bold
  sanitized = sanitized.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert **bold** to *bold* (Slack style)
  sanitized = sanitized.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert `code` stays the same
  // Convert ```code blocks``` stays the same

  // Escape special Slack characters that aren't already formatted
  // (but be careful not to break existing formatting)

  // Remove any HTML tags
  sanitized = sanitized.replace(/<[^>]+>/g, "");

  // Collapse multiple newlines
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n");

  return sanitized.trim();
}

/** Truncate text with ellipsis */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
