// ============================================
// Agentic Loop — Tool-use pipeline with GPT-4o
// Max 3 iterations, then final synthesis without tools
// ============================================

import crypto from "crypto";
import { openai, SYNTHESIS_MODEL } from "../llm/client.js";
import {
  AGENTIC_SYSTEM_PROMPT,
  buildUserContextPrompt,
  buildThreadContextPrompt,
  buildAttachmentContext,
  getMissingContextMessage,
  type UserContext,
} from "../llm/prompts.js";
import { AGENT_TOOLS, executeTool, type EscalationDraft } from "./tools.js";
import { checkForbiddenPhrases } from "../grounding/forbiddenPhrases.js";
import { validateInlineCitations } from "../grounding/citationGate.js";
import { extractAttachmentText } from "../attachments/extractText.js";
import { logger } from "../lib/logger.js";
import type { SlackInput, PipelineResult } from "../app/types.js";
import type { GroundedAnswer, Article } from "../evidence/types.js";
import type { SlackFile } from "../app/types.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";

// ============================================
// Configuration
// ============================================

const MAX_ITERATIONS = 3;
export const PIPELINE_VERSION = "pipeline.v3.0-agentic";

// ============================================
// Types
// ============================================

export interface AgenticPipelineInput {
  input: SlackInput;
  threadHistory: Array<{ role: "user" | "assistant"; content: string; timestamp: string }>;
  userContext?: UserContext;
}

// ============================================
// Main Agentic Pipeline
// ============================================

/**
 * Execute the agentic pipeline for a question.
 *
 * Flow:
 * 1. Build system prompt (base + user context + thread context)
 * 2. Run tool-use loop (max 3 iterations)
 *    - LLM calls list_articles → gets manifest
 *    - LLM calls fetch_articles → gets full content
 *    - (optional) LLM calls more tools or escalate_to_human
 * 3. Final answer from LLM (no tools)
 * 4. Apply forbidden phrases guardrail
 * 5. Validate inline citations
 * 6. Return PipelineResult
 */
export async function executeAgenticPipeline(
  pipelineInput: AgenticPipelineInput
): Promise<PipelineResult> {
  const { input, threadHistory, userContext } = pipelineInput;
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  logger.info("Agentic pipeline started", {
    stage: "pipeline",
    requestId,
    question: input.text.slice(0, 80),
    hasThread: threadHistory.length > 0,
    hasFiles: (input.files?.length ?? 0) > 0,
    hasUserContext: !!userContext,
  });

  // Track fetched article paths for citation validation
  const fetchedPaths = new Set<string>();
  const fetchedArticles: Article[] = [];
  let escalation: EscalationDraft | undefined;

  // Build system prompt
  const systemPrompt = [
    AGENTIC_SYSTEM_PROMPT,
    buildUserContextPrompt(userContext),
    buildThreadContextPrompt(threadHistory),
  ]
    .filter(Boolean)
    .join("\n");

  // Build user message
  let userMessage = input.text;

  // Extract and include attachment text
  if (input.files && input.files.length > 0) {
    const attachmentTexts = await extractAttachmentTexts(input.files);
    userMessage += buildAttachmentContext(attachmentTexts);
  }

  // Initialize conversation messages
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  // ============================================
  // Tool-Use Loop
  // ============================================

  let finalAnswer = "";

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    logger.info("Agentic loop iteration", {
      stage: "pipeline",
      requestId,
      iteration: iteration + 1,
      messageCount: messages.length,
    });

    const response = await openai.chat.completions.create({
      model: SYNTHESIS_MODEL,
      messages,
      tools: AGENT_TOOLS,
      temperature: 0.3,
      max_tokens: 4000,
    });

    const choice = response.choices[0];
    if (!choice) {
      logger.error("No response choice from LLM", {
        stage: "pipeline",
        requestId,
      });
      break;
    }

    const assistantMessage = choice.message;

    // Add assistant message to conversation
    messages.push(assistantMessage as ChatCompletionAssistantMessageParam);

    // If the LLM wants to use tools
    if (choice.finish_reason === "tool_calls" && assistantMessage.tool_calls) {
      // Filter to function tool calls only (not custom tool calls)
      const functionToolCalls = assistantMessage.tool_calls.filter(
        (tc): tc is typeof tc & { type: "function"; function: { name: string; arguments: string } } =>
          tc.type === "function"
      );

      logger.info("LLM requested tool calls", {
        stage: "pipeline",
        requestId,
        toolCount: functionToolCalls.length,
        tools: functionToolCalls.map((tc) => tc.function.name),
      });

      // Execute all tool calls
      for (const toolCall of functionToolCalls) {
        const toolName = toolCall.function.name;
        let args: Record<string, unknown> = {};

        try {
          args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          logger.warn("Failed to parse tool arguments", {
            stage: "pipeline",
            requestId,
            toolName,
            rawArgs: toolCall.function.arguments,
          });
        }

        const result = await executeTool(toolName, args, requestId);

        // Track fetched paths for citation validation
        if (result.fetchedPaths) {
          for (const p of result.fetchedPaths) {
            fetchedPaths.add(p);
          }
        }

        // Track escalation
        if (result.escalation) {
          escalation = result.escalation;
        }

        // Add tool result to conversation
        const toolMessage: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.content,
        };
        messages.push(toolMessage);
      }

      continue; // Next iteration with tool results
    }

    // LLM is done with tools — this is the final answer
    finalAnswer = assistantMessage.content ?? "";
    break;
  }

  // If we exhausted iterations without a final answer, make one more call without tools
  if (!finalAnswer) {
    logger.info("Making final synthesis call without tools", {
      stage: "pipeline",
      requestId,
    });

    const finalResponse = await openai.chat.completions.create({
      model: SYNTHESIS_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    });

    finalAnswer = finalResponse.choices[0]?.message?.content ?? "";
  }

  // ============================================
  // Post-Processing
  // ============================================

  // Clean ** to * (Slack doesn't support **bold**)
  finalAnswer = finalAnswer.replace(/\*\*([^*]+)\*\*/g, "*$1*");

  // Apply forbidden phrases guardrail
  const phraseCheck = checkForbiddenPhrases(finalAnswer);
  if (phraseCheck.hasForbidden && phraseCheck.cleanedText) {
    logger.warn("Forbidden phrases cleaned", {
      stage: "pipeline",
      requestId,
      found: phraseCheck.found,
    });
    finalAnswer = phraseCheck.cleanedText;
  }

  // Validate inline citations
  const citationResult = validateInlineCitations(finalAnswer, fetchedPaths);

  if (!citationResult.isValid) {
    logger.warn("Invalid citations found", {
      stage: "pipeline",
      requestId,
      invalidPaths: citationResult.invalidPaths,
    });
  }

  // Build result
  const latencyMs = Date.now() - startTime;

  // Handle escalation or no-article fallback
  const hasContent = fetchedPaths.size > 0 || finalAnswer.length > 0;

  const answer: GroundedAnswer = hasContent
    ? {
        summary: finalAnswer,
        confidence: fetchedPaths.size > 0 ? "confirmed" : "needs_clarification",
        hasAmbiguity: false,
      }
    : {
        summary: getMissingContextMessage(requestId),
        confidence: "needs_clarification",
        hasAmbiguity: false,
      };

  // Build a minimal evidence pack for backward compat with renderer
  // The articles are tracked for "More details" and citation footer
  const evidence = {
    articles: fetchedArticles,
    retrievalMeta: {
      version: PIPELINE_VERSION,
      indexRunId: requestId,
      totalSearched: fetchedPaths.size,
      queriesUsed: [...fetchedPaths],
    },
  };

  logger.info("Agentic pipeline complete", {
    stage: "pipeline",
    requestId,
    latencyMs,
    iterations: messages.filter((m) => m.role === "assistant").length,
    articlesFetched: fetchedPaths.size,
    hasEscalation: !!escalation,
    answerLength: finalAnswer.length,
  });

  return {
    route: {
      mode: "capability_docs",
      confidence: "high",
      queryHints: [],
    },
    evidence,
    answer,
    metadata: {
      requestId,
      latencyMs,
      mode: "agentic",
    },
    escalation,
  };
}

// ============================================
// Helpers
// ============================================

async function extractAttachmentTexts(
  files: SlackFile[]
): Promise<Array<{ type: string; text: string }>> {
  const results: Array<{ type: string; text: string }> = [];

  for (const file of files) {
    try {
      const extracted = await extractAttachmentText(file);
      if (extracted) {
        results.push({
          type: extracted.type,
          text: extracted.extractedText,
        });
      }
    } catch (err) {
      logger.warn("Failed to extract attachment text", {
        stage: "pipeline",
        fileName: file.name,
        error: err,
      });
    }
  }

  return results;
}
