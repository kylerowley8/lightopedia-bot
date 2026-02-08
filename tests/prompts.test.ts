// ============================================
// Tests for LLM Prompts (Two-Phase Agentic)
// ============================================

import { describe, it, expect } from "vitest";
import {
  AGENTIC_SYSTEM_PROMPT,
  FINAL_ANSWER_PROMPT,
  buildUserContextPrompt,
  buildThreadContextPrompt,
  buildAttachmentContext,
  getMissingContextMessage,
} from "../src/llm/prompts.js";

// ============================================
// AGENTIC_SYSTEM_PROMPT (Phase 1: Tool-use)
// ============================================

describe("AGENTIC_SYSTEM_PROMPT", () => {
  it("mentions Lightopedia as the assistant name", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Lightopedia");
  });

  it("includes tool usage instructions", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("knowledge_base");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("fetch_articles");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("search_articles");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("escalate_to_human");
  });

  it("describes the workflow", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Your Workflow");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Call knowledge_base");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("fetch_articles exactly ONCE");
  });

  it("includes user attachment handling instructions", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("User Attachments");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("PRIMARY CONTEXT");
  });

  it("instructs to stop after fetching articles", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("stop calling tools");
  });
});

// ============================================
// FINAL_ANSWER_PROMPT (Phase 2: Clean synthesis)
// ============================================

describe("FINAL_ANSWER_PROMPT", () => {
  it("mentions Lightopedia as the assistant name", () => {
    expect(FINAL_ANSWER_PROMPT).toContain("Lightopedia");
  });

  it("includes inline citation instructions with URL format", () => {
    expect(FINAL_ANSWER_PROMPT).toContain("[[1]](url)");
    expect(FINAL_ANSWER_PROMPT).toContain("Citation Format");
  });

  it("includes forbidden language section", () => {
    expect(FINAL_ANSWER_PROMPT).toContain("Forbidden Language");
    expect(FINAL_ANSWER_PROMPT).toContain("Automatically");
    expect(FINAL_ANSWER_PROMPT).toContain("Out of the box");
    expect(FINAL_ANSWER_PROMPT).toContain("Seamlessly");
  });

  it("includes approved language patterns", () => {
    expect(FINAL_ANSWER_PROMPT).toContain("Approved Language");
    expect(FINAL_ANSWER_PROMPT).toContain("Light supports this workflow by");
    expect(FINAL_ANSWER_PROMPT).toContain("Light is designed to handle");
  });

  it("includes critical terminology for AR vs AP", () => {
    expect(FINAL_ANSWER_PROMPT).toContain("Accounts Receivable");
    expect(FINAL_ANSWER_PROMPT).toContain("Accounts Payable");
  });

  it("specifies Slack-compatible markdown format", () => {
    expect(FINAL_ANSWER_PROMPT).toContain("single asterisks");
    expect(FINAL_ANSWER_PROMPT).toContain("NEVER use **double asterisks**");
  });

  it("includes product boundary rule", () => {
    expect(FINAL_ANSWER_PROMPT).toContain("Product Boundary Rule");
  });
});

// ============================================
// buildUserContextPrompt
// ============================================

describe("buildUserContextPrompt", () => {
  it("returns empty string when no context", () => {
    expect(buildUserContextPrompt()).toBe("");
    expect(buildUserContextPrompt(undefined)).toBe("");
  });

  it("includes display name when provided", () => {
    const result = buildUserContextPrompt({ displayName: "Jane Doe" });
    expect(result).toContain("Jane Doe");
    expect(result).toContain("User Context");
  });

  it("includes title when provided", () => {
    const result = buildUserContextPrompt({ title: "Solutions Engineer" });
    expect(result).toContain("Solutions Engineer");
    expect(result).toContain("Role:");
  });

  it("includes timezone when provided", () => {
    const result = buildUserContextPrompt({ timezone: "America/New_York" });
    expect(result).toContain("America/New_York");
    expect(result).toContain("Timezone:");
  });

  it("includes all fields when fully populated", () => {
    const result = buildUserContextPrompt({
      displayName: "Jane Doe",
      title: "SE",
      timezone: "US/Pacific",
    });
    expect(result).toContain("Jane Doe");
    expect(result).toContain("SE");
    expect(result).toContain("US/Pacific");
  });
});

// ============================================
// buildThreadContextPrompt
// ============================================

describe("buildThreadContextPrompt", () => {
  it("returns empty string for empty history", () => {
    expect(buildThreadContextPrompt([])).toBe("");
  });

  it("includes previous conversation header", () => {
    const result = buildThreadContextPrompt([
      { role: "user", content: "How does billing work?" },
    ]);
    expect(result).toContain("Previous Conversation");
  });

  it("formats user and assistant messages", () => {
    const result = buildThreadContextPrompt([
      { role: "user", content: "How does billing work?" },
      { role: "assistant", content: "Billing in Light works by..." },
    ]);
    expect(result).toContain("User: How does billing work?");
    expect(result).toContain("Assistant: Billing in Light works by...");
  });

  it("limits to last 4 messages", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));

    const result = buildThreadContextPrompt(history);

    expect(result).not.toContain("Message 0");
    expect(result).not.toContain("Message 1");
    expect(result).toContain("Message 2");
    expect(result).toContain("Message 5");
  });

  it("truncates long messages to 300 characters", () => {
    const longContent = "A".repeat(500);
    const result = buildThreadContextPrompt([
      { role: "user", content: longContent },
    ]);

    const aCount = (result.match(/A/g) || []).length;
    expect(aCount).toBe(300);
  });
});

// ============================================
// buildAttachmentContext
// ============================================

describe("buildAttachmentContext", () => {
  it("returns empty string for no attachments", () => {
    expect(buildAttachmentContext([])).toBe("");
  });

  it("includes attachment type and text", () => {
    const result = buildAttachmentContext([
      { type: "image", text: "Error message on screen" },
    ]);
    expect(result).toContain("Attachment 1 (image)");
    expect(result).toContain("Error message on screen");
    expect(result).toContain("USER ATTACHMENTS");
  });

  it("handles multiple attachments", () => {
    const result = buildAttachmentContext([
      { type: "image", text: "Screenshot content" },
      { type: "pdf", text: "Document content" },
    ]);
    expect(result).toContain("Attachment 1 (image)");
    expect(result).toContain("Attachment 2 (pdf)");
  });

  it("truncates long attachment text to 2000 characters", () => {
    const longText = "B".repeat(3000);
    const result = buildAttachmentContext([
      { type: "log", text: longText },
    ]);

    const bCount = (result.match(/B/g) || []).length;
    expect(bCount).toBe(2000);
  });
});

// ============================================
// getMissingContextMessage
// ============================================

describe("getMissingContextMessage", () => {
  it("mentions help article", () => {
    const msg = getMissingContextMessage("req-123");
    expect(msg).toContain("help article");
  });

  it("includes the requestId", () => {
    const msg = getMissingContextMessage("req-abc-456");
    expect(msg).toContain("req-abc-456");
  });

  it("includes actionable suggestions", () => {
    const msg = getMissingContextMessage("req-789");
    expect(msg).toContain("more context");
  });

  it("mentions Linear for feature requests", () => {
    const msg = getMissingContextMessage("req-xyz");
    expect(msg).toContain("Linear");
  });

  it("returns a non-empty string", () => {
    const msg = getMissingContextMessage("any-id");
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("formats requestId in italics for Slack", () => {
    const msg = getMissingContextMessage("req-test-id");
    expect(msg).toContain("_req-test-id_");
  });
});
