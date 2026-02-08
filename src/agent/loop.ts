// ============================================
// Agentic Loop — Tool-use pipeline with GPT-4o
// Two-phase: agentic tools → clean synthesis
// ============================================

import crypto from "crypto";
import { openai, SYNTHESIS_MODEL } from "../llm/client.js";
import {
  AGENTIC_SYSTEM_PROMPT,
  FINAL_ANSWER_PROMPT,
  buildUserContextPrompt,
  buildThreadContextPrompt,
  buildAttachmentContext,
  getMissingContextMessage,
  type UserContext,
} from "../llm/prompts.js";
import { AGENT_TOOLS, executeTool, type ToolResult, type EscalationDraft } from "./tools.js";
import { checkForbiddenPhrases } from "../grounding/forbiddenPhrases.js";
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

const MAX_ITERATIONS = 5;
export const PIPELINE_VERSION = "pipeline.v3.1-agentic";

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
 * Two-phase flow:
 * Phase 1 — Tool-use loop (max 5 iterations):
 *   - LLM calls knowledge_base → gets curated hierarchy (136 articles)
 *   - LLM calls fetch_articles → gets full content via Firecrawl/GitHub
 *   - (optional) LLM calls search_articles or escalate_to_human
 *
 * Phase 2 — Clean synthesis:
 *   - Extract article content from tool results
 *   - Build clean prompt with ONLY article content + user question
 *   - LLM generates final answer with inline citations (no tool history)
 *
 * Post-processing:
 *   - Apply forbidden phrases guardrail
 *   - Format for Slack
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

  // Track fetched articles for two-phase synthesis
  const allArticles: Array<{ title: string; url: string; content: string }> = [];
  const fetchedUrls = new Set<string>();
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
  // Phase 1: Tool-Use Loop
  // ============================================

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

        const result: ToolResult = await executeTool(toolName, args, requestId);

        // Track fetched articles for phase 2 synthesis
        if (result.articles) {
          for (const article of result.articles) {
            if (!fetchedUrls.has(article.url)) {
              fetchedUrls.add(article.url);
              allArticles.push(article);
            }
          }
        }
        if (result.fetchedUrls) {
          for (const u of result.fetchedUrls) fetchedUrls.add(u);
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

    // LLM is done with tools — break out of loop
    break;
  }

  // ============================================
  // Phase 2: Clean Synthesis (no tool history)
  // ============================================

  let finalAnswer = "";

  if (allArticles.length > 0) {
    // Build clean context from fetched articles
    const retrievedContent = allArticles.map(
      (a) => `## ${a.title}\nSource: ${a.url}\n\n${a.content}`
    );

    // Always preserve the first message (thread parent / original question)
    const selectedHistory =
      threadHistory.length > 4
        ? [threadHistory[0]!, ...threadHistory.slice(-3)]
        : threadHistory;

    const cleanMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: FINAL_ANSWER_PROMPT },
      // Include thread history for context (parent always preserved)
      ...selectedHistory.map(
        (m): ChatCompletionMessageParam => ({
          role: m.role,
          content: m.content.slice(0, 300),
        })
      ),
      {
        role: "user",
        content: `Here is the relevant documentation I found for the question:\n\n${retrievedContent.join("\n\n---\n\n")}\n\n---\n\nBased on this documentation, please answer: "${input.text}"`,
      },
    ];

    logger.info("Phase 2: Clean synthesis", {
      stage: "pipeline",
      requestId,
      articleCount: allArticles.length,
    });

    const finalResponse = await openai.chat.completions.create({
      model: SYNTHESIS_MODEL,
      messages: cleanMessages,
      temperature: 0.3,
      max_tokens: 2000,
    });

    finalAnswer = finalResponse.choices[0]?.message?.content ?? "";
  } else if (escalation) {
    // Escalation path — use the last assistant message as the answer
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    finalAnswer =
      (lastAssistant && "content" in lastAssistant ? (lastAssistant.content as string) : null) ?? "";
  } else {
    // No articles found, no escalation — make a final call without tools
    logger.info("No articles found, making final synthesis without tools", {
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

  // Build result
  const latencyMs = Date.now() - startTime;

  const hasContent = fetchedUrls.size > 0 || finalAnswer.length > 0;

  const answer: GroundedAnswer = hasContent
    ? {
        summary: finalAnswer,
        confidence: fetchedUrls.size > 0 ? "confirmed" : "needs_clarification",
        hasAmbiguity: false,
      }
    : {
        summary: getMissingContextMessage(requestId),
        confidence: "needs_clarification",
        hasAmbiguity: false,
      };

  const evidence = {
    articles: [] as Article[],
    retrievalMeta: {
      version: PIPELINE_VERSION,
      indexRunId: requestId,
      totalSearched: fetchedUrls.size,
      queriesUsed: [...fetchedUrls],
    },
  };

  logger.info("Agentic pipeline complete", {
    stage: "pipeline",
    requestId,
    latencyMs,
    iterations: messages.filter((m) => m.role === "assistant").length,
    articlesFetched: fetchedUrls.size,
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
