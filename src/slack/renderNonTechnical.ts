// ============================================
// Non-Technical Renderer — Default Slack output
// Customer-ready, sales-safe, no code or jargon
// ============================================

import type { SlackResponse, SlackBlock, SlackButton } from "../app/types.js";
import type { PipelineResult } from "../app/types.js";
import { buildCitationFooter } from "../grounding/citationGate.js";

/**
 * Render a non-technical Slack response.
 *
 * Format:
 * - Customer-ready answer (1-3 sentences)
 * - Internal notes / next steps (if any)
 * - Confidence + source indicator
 * - "Show technical details" button
 */
export function renderNonTechnical(result: PipelineResult): SlackResponse {
  const { answer, metadata, evidence } = result;
  const blocks: SlackBlock[] = [];

  // Main answer section
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: answer.summary,
    },
  });

  // Claims as bullet points (simplified, no code references)
  if (answer.claims.length > 0) {
    const bullets = answer.claims
      .map((claim) => `• ${claim.text}`)
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: bullets,
      },
    });
  }

  // Internal notes (if present)
  if (answer.internalNotes) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📝 *Internal note:* ${answer.internalNotes}`,
        },
      ],
    });
  }

  // Footer with confidence and source
  const footer = buildCitationFooter(answer, evidence);
  if (footer) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: footer,
        },
      ],
    });
  }

  // Actions: Show technical details + feedback
  const actions: SlackButton[] = [];

  // Only show technical details button if we have evidence
  if (evidence.docs.length > 0 || evidence.slackThreads.length > 0) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "Show technical details" },
      action_id: "show_technical",
      value: JSON.stringify({ requestId: metadata.requestId }),
    });
  }

  // Feedback buttons
  actions.push({
    type: "button",
    text: { type: "plain_text", text: "✓ Helpful" },
    action_id: "feedback_helpful",
    value: metadata.requestId,
  });

  actions.push({
    type: "button",
    text: { type: "plain_text", text: "✗ Not helpful" },
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
    text: answer.summary,
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
