// ============================================
// Non-Technical Renderer — V3 Slack-Safe Template
// Ship-ready, non-promissory, copy-paste safe for customers
// ============================================

import type { SlackResponse, SlackBlock, SlackButton } from "../app/types.js";
import type { PipelineResult } from "../app/types.js";
import { buildCitationFooter } from "../grounding/citationGate.js";

/**
 * Render a V3 Slack-safe response.
 *
 * Template (enforced structure):
 * 1. Short answer (1 sentence)
 * 2. Conceptual model (how Light thinks)
 * 3. How it works in practice (bulleted flow)
 * 4. Explicit boundaries (what Light does vs does not) - MANDATORY
 * 5. Sales-ready summary (1 sentence)
 */
export function renderNonTechnical(result: PipelineResult): SlackResponse {
  const { answer, metadata, evidence } = result;
  const blocks: SlackBlock[] = [];
  const v3 = answer.v3;

  // If we have V3 structured answer, use the new template
  if (v3 && v3.shortAnswer) {
    // 1. Short answer
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: v3.shortAnswer,
      },
    });

    // 2. Conceptual model
    if (v3.conceptualModel) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*How Light models this:*\n${v3.conceptualModel}`,
        },
      });
    }

    // 3. How it works in practice
    if (v3.howItWorks.length > 0) {
      const steps = v3.howItWorks.map((step) => `• ${step}`).join("\n");
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*In practice:*\n${steps}`,
        },
      });
    }

    // 4. Explicit boundaries (MANDATORY for V3)
    if (v3.boundaries.whatLightDoes.length > 0 || v3.boundaries.whatLightDoesNot.length > 0) {
      blocks.push({ type: "divider" });

      if (v3.boundaries.whatLightDoes.length > 0) {
        const does = v3.boundaries.whatLightDoes.map((item) => `✓ ${item}`).join("\n");
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*What Light does:*\n${does}`,
          },
        });
      }

      if (v3.boundaries.whatLightDoesNot.length > 0) {
        const doesNot = v3.boundaries.whatLightDoesNot.map((item) => `✗ ${item}`).join("\n");
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*What Light does not:*\n${doesNot}`,
          },
        });
      }
    }

    // 5. Sales-ready summary
    if (v3.salesSummary) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `💬 *Sales summary:* ${v3.salesSummary}`,
          },
        ],
      });
    }
  } else {
    // Fallback to legacy format if V3 not available
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: answer.summary,
      },
    });

    if (answer.claims.length > 0) {
      const bullets = answer.claims.map((claim) => `• ${claim.text}`).join("\n");
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: bullets,
        },
      });
    }

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

  // Actions: feedback buttons
  const actions: SlackButton[] = [];

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
    text: v3?.shortAnswer || answer.summary,
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
