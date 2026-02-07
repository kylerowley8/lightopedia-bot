// ============================================
// API Handler — /api/v1/ask endpoint
// ============================================

import type { Response } from "express";
import crypto from "crypto";
import { executeAgenticPipeline, PIPELINE_VERSION } from "../agent/loop.js";
import { logger } from "../lib/logger.js";
import { wrapError } from "../lib/errors.js";
import type { SlackInput } from "../app/types.js";
import type { ThreadHistoryMessage } from "../app/types.js";
import type { AuthenticatedRequest, AskRequest } from "./middleware.js";

// ============================================
// Types
// ============================================

export interface AskResponse {
  requestId: string;
  answer: {
    summary: string;
    confidence: "confirmed" | "needs_clarification";
  };
  metadata: {
    mode: string;
    latencyMs: number;
    pipelineVersion: string;
  };
  evidence?: {
    articlesCount: number;
    topSources: Array<{
      type: string;
      path: string;
      score: number;
    }>;
  };
  escalation?: {
    title: string;
    requestType: string;
    problemStatement: string;
  };
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

// ============================================
// Handler
// ============================================

/**
 * Handle /api/v1/ask requests.
 *
 * This endpoint exposes the Lightopedia Q&A pipeline via REST API.
 * It reuses the same agentic pipeline as Slack but returns structured JSON.
 */
export async function handleAskRequest(
  req: AuthenticatedRequest & { body: AskRequest; requestId?: string },
  res: Response
): Promise<void> {
  const requestId = req.requestId ?? crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  const { question, conversationHistory, options } = req.body;

  logger.info("API request received", {
    stage: "api",
    requestId,
    apiKeyId: req.apiKeyId,
    apiKeyName: req.apiKeyName,
    questionLength: question.length,
    hasHistory: Boolean(conversationHistory?.length),
  });

  try {
    // Build SlackInput-compatible object (we reuse the pipeline)
    const input: SlackInput = {
      text: question,
      userId: `api:${req.apiKeyId ?? "unknown"}`,
      channelId: "api",
      threadTs: requestId,
      messageTs: requestId,
      channelType: "dm", // Treat API requests like DMs (no channel context)
    };

    // Convert conversation history to ThreadHistoryMessage format
    const threadHistory: ThreadHistoryMessage[] = (conversationHistory ?? []).map(
      (msg: { role: "user" | "assistant"; content: string }, idx: number) => ({
        role: msg.role,
        content: msg.content,
        timestamp: String(idx), // Synthetic timestamps for ordering
      })
    );

    // Execute the agentic pipeline
    const result = await executeAgenticPipeline({
      input,
      threadHistory,
    });

    // Build response
    const response: AskResponse = {
      requestId,
      answer: {
        summary: result.answer.summary,
        confidence: result.answer.confidence,
      },
      metadata: {
        mode: result.metadata.mode,
        latencyMs: result.metadata.latencyMs,
        pipelineVersion: PIPELINE_VERSION,
      },
    };

    // Optionally include evidence details
    if (options?.includeEvidence) {
      response.evidence = {
        articlesCount: result.evidence.articles.length,
        topSources: result.evidence.articles.slice(0, 5).map((a) => ({
          type: "article" as const,
          path: a.path,
          score: a.score,
        })),
      };
    }

    // Include escalation if present
    if (result.escalation) {
      response.escalation = result.escalation;
    }

    const totalLatency = Date.now() - startTime;

    logger.info("API request completed", {
      stage: "api",
      requestId,
      apiKeyId: req.apiKeyId,
      mode: result.metadata.mode,
      confidence: result.answer.confidence,
      latencyMs: totalLatency,
    });

    res.status(200).json(response);
  } catch (err) {
    const appError = wrapError(err, requestId);

    logger.error("API request failed", {
      stage: "api",
      requestId,
      apiKeyId: req.apiKeyId,
      error: err,
      errorCode: appError.code,
    });

    // Return generic error to client (don't leak internal details)
    const errorResponse: ApiErrorResponse = {
      error: "INTERNAL_ERROR",
      message: "An error occurred processing your request. Please try again.",
      requestId,
    };

    res.status(500).json(errorResponse);
  }
}

// ============================================
// Health Check Response
// ============================================

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  timestamp: string;
}

/**
 * API health check endpoint.
 */
export function handleHealthCheck(
  _req: AuthenticatedRequest,
  res: Response
): void {
  const response: HealthResponse = {
    status: "ok",
    version: "v3.0.0",
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(response);
}
