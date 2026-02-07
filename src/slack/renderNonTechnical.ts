// ============================================
// Non-Technical Renderer — Slack-Safe Template
// Ship-ready, non-promissory, copy-paste safe for customers
// Supports inline citations [[n]](path) → Slack links
// ============================================

import type { SlackResponse, SlackBlock, SlackButton } from "../app/types.js";
import type { PipelineResult } from "../app/types.js";

// Slack block text limit is 3000 characters
const SLACK_TEXT_LIMIT = 3000;
const TRUNCATION_BUFFER = 100; // Leave room for ellipsis and suffix

// Base URL for help article links (articles are served from this path)
const HELP_ARTICLES_BASE_URL = "https://help.lightplatform.com/articles";

/**
 * Truncate text to fit within Slack's block text limit.
 * Tries to break at a paragraph or sentence boundary.
 */
function truncateForSlack(text: string, maxLength: number = SLACK_TEXT_LIMIT - TRUNCATION_BUFFER): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Try to break at a paragraph
  const truncated = text.slice(0, maxLength);
  const lastParagraph = truncated.lastIndexOf("\n\n");
  if (lastParagraph > maxLength * 0.5) {
    return truncated.slice(0, lastParagraph) + "\n\n_...response truncated. Ask a more specific question for details._";
  }

  // Try to break at a sentence
  const lastSentence = truncated.lastIndexOf(". ");
  if (lastSentence > maxLength * 0.5) {
    return truncated.slice(0, lastSentence + 1) + "\n\n_...response truncated. Ask a more specific question for details._";
  }

  // Fall back to hard truncation
  return truncated.slice(0, maxLength - 50) + "...\n\n_...response truncated._";
}

/**
 * Transform inline citations [[n]](path) → Slack mrkdwn links.
 * Converts [[1]](integrations/stripe.md) → <url|[1]>
 */
export function transformInlineCitations(text: string): string {
  return text.replace(
    /\[\[(\d+)\]\]\(([^)]+)\)/g,
    (_match, num: string, path: string) => {
      const url = `${HELP_ARTICLES_BASE_URL}/${path.replace(/\.md$/, "")}`;
      return `<${url}|[${num}]>`;
    }
  );
}

/**
 * Render a plain text Slack response.
 * Shows answer with inline citations transformed to Slack links.
 */
export function renderNonTechnical(result: PipelineResult): SlackResponse {
  const { answer, metadata } = result;
  const blocks: SlackBlock[] = [];

  // Transform inline citations to Slack links
  let summaryText = transformInlineCitations(answer.summary);

  // Truncate if needed for Slack's 3000 char limit
  summaryText = truncateForSlack(summaryText);

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: summaryText,
    },
  });

  if (answer.internalNotes) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: truncateForSlack(`\u{1F4DD} *Internal note:* ${answer.internalNotes}`, 500),
        },
      ],
    });
  }

  // Escalation block (when escalate_to_human was triggered)
  if (result.escalation) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `\u{1F3AB} *Escalation Draft*`,
          `*Title:* ${result.escalation.title}`,
          `*Type:* ${result.escalation.requestType.replace(/_/g, " ")}`,
          `*Details:* ${result.escalation.problemStatement}`,
        ].join("\n"),
      },
    });
  }

  // Actions: feedback buttons + escalation submit
  const actions: SlackButton[] = [];

  if (result.escalation) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "Submit to Linear" },
      action_id: "submit_escalation",
      value: JSON.stringify({
        requestId: metadata.requestId,
        ...result.escalation,
      }),
      style: "primary",
    });
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "Cancel" },
      action_id: "cancel_escalation",
      value: metadata.requestId,
    });
  }

  actions.push({
    type: "button",
    text: { type: "plain_text", text: "\u2713 Helpful" },
    action_id: "feedback_helpful",
    value: metadata.requestId,
  });

  actions.push({
    type: "button",
    text: { type: "plain_text", text: "\u2717 Not helpful" },
    action_id: "feedback_not_helpful",
    value: metadata.requestId,
  });

  blocks.push({
    type: "actions",
    elements: actions,
  });

  // Request ID in footer
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `_${metadata.requestId}_`,
      },
    ],
  });

  return {
    text: answer.summary.slice(0, 150),
    blocks,
  };
}

/**
 * Render a clarifying question response.
 */
export function renderClarifyingQuestion(
  question: string,
  requestId: string
): SlackResponse {
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: question,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_${requestId}_`,
        },
      ],
    },
  ];

  return {
    text: question,
    blocks,
  };
}

/**
 * Render a fallback/error message.
 */
export function renderFallback(message: string): SlackResponse {
  return {
    text: message,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message,
        },
      },
    ],
  };
}
