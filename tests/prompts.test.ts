// ============================================
// Tests for LLM Prompts (Agentic)
// ============================================

import { describe, it, expect } from "vitest";
import {
  AGENTIC_SYSTEM_PROMPT,
  buildUserContextPrompt,
  buildThreadContextPrompt,
  buildAttachmentContext,
  getMissingContextMessage,
} from "../src/llm/prompts.js";

// ============================================
// AGENTIC_SYSTEM_PROMPT
// ============================================

describe("AGENTIC_SYSTEM_PROMPT", () => {
  it("mentions Lightopedia as the assistant name", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Lightopedia");
  });

  it("includes help articles as knowledge source", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("help articles");
  });

  it("includes tool usage instructions", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("list_articles");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("fetch_articles");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("escalate_to_human");
  });

  it("includes inline citation instructions", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("[[n]](article-path)");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Inline Citations");
  });

  it("includes forbidden language section", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Forbidden Language");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Automatically");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Out of the box");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Seamlessly");
  });

  it("includes approved language patterns", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Approved Language");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Light supports this workflow by");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Light is designed to handle");
  });

  it("includes critical terminology for AR vs AP", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Accounts Receivable");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("Accounts Payable");
  });

  it("does NOT reference code structures as knowledge source", () => {
    const knowledgeSection = AGENTIC_SYSTEM_PROMPT.slice(
      AGENTIC_SYSTEM_PROMPT.indexOf("## Knowledge Source"),
      AGENTIC_SYSTEM_PROMPT.indexOf("## User Attachments")
    );
    expect(knowledgeSection).not.toContain("code");
  });

  it("includes user attachment handling instructions", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("User Attachments");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("PRIMARY CONTEXT");
  });

  it("specifies Slack-compatible markdown format", () => {
    expect(AGENTIC_SYSTEM_PROMPT).toContain("single asterisks");
    expect(AGENTIC_SYSTEM_PROMPT).toContain("NEVER use **double asterisks**");
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

    // Should contain messages 2-5 (last 4), not 0-1
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

    // The content should be truncated
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
