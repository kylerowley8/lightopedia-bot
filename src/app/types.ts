// ============================================
// Application Types — Slack IO contracts
// ============================================

import type { GroundedAnswer, EvidencePack } from "../evidence/types.js";
import type { RouteDecision } from "../router/types.js";

/**
 * Raw input from Slack.
 * Preprocessed into RouterInput before routing.
 */
export type SlackInput = {
  /** User's message text (mention stripped) */
  text: string;

  /** User ID */
  userId: string;

  /** Channel ID */
  channelId: string;

  /** Thread timestamp (for threading replies) */
  threadTs: string;

  /** Message timestamp (for updating) */
  messageTs: string;

  /** Channel type */
  channelType: "dm" | "channel";

  /** Team/workspace ID */
  teamId?: string;

  /** Attached files if any */
  files?: SlackFile[];
};

/**
 * Slack file attachment.
 */
export type SlackFile = {
  id: string;
  name: string;
  mimetype: string;
  url: string;
  size: number;
};

/**
 * Response to send back to Slack.
 */
export type SlackResponse = {
  /** Plain text fallback */
  text: string;

  /** Block Kit blocks for rich formatting */
  blocks: SlackBlock[];

  /** Whether to update existing message or post new */
  updateTs?: string;
};

/**
 * Slack Block Kit block (simplified).
 */
export type SlackBlock =
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "divider" }
  | { type: "context"; elements: Array<{ type: "mrkdwn"; text: string }> }
  | { type: "actions"; elements: SlackButton[] };

/**
 * Slack button action.
 */
export type SlackButton = {
  type: "button";
  text: { type: "plain_text"; text: string };
  action_id: string;
  value: string;
  style?: "primary" | "danger";
};

/**
 * Context passed through the pipeline.
 * Accumulated during preprocessing and routing.
 */
export type PipelineContext = {
  /** Original Slack input */
  input: SlackInput;

  /** Request ID for tracing */
  requestId: string;

  /** Preprocessed thread history */
  threadHistory: ThreadHistoryMessage[];

  /** Extracted attachment hints */
  attachmentHints: string[];

  /** Start time for latency tracking */
  startTime: number;
};

/**
 * Thread history message (preprocessed).
 */
export type ThreadHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

/**
 * Complete pipeline result.
 * Passed to renderer.
 */
export type PipelineResult = {
  /** Routing decision */
  route: RouteDecision;

  /** Retrieved evidence */
  evidence: EvidencePack;

  /** Grounded answer (passed citation gate) */
  answer: GroundedAnswer;

  /** Request metadata for tracing */
  metadata: {
    requestId: string;
    latencyMs: number;
    mode: string;
  };
};

/**
 * Action payload for button clicks.
 */
export type ActionPayload = {
  /** Action type */
  action: "show_technical" | "trace_api" | "trace_domain" | "feedback_helpful" | "feedback_not_helpful";

  /** Original request ID */
  requestId: string;

  /** Additional action-specific data */
  data?: Record<string, string>;
};

// ============================================
// Render mode
// ============================================

/**
 * Rendering mode for Slack output.
 */
export type RenderMode = "non_technical" | "technical";
