// ============================================
// Chunker Tests — Document Chunking Logic
// ============================================

import { describe, it, expect } from "vitest";
import {
  getSourceType,
  extractArticleTitle,
  extractFilePath,
  chunkDocument,
} from "../src/indexer/chunker.js";

// ============================================
// getSourceType()
// ============================================

describe("getSourceType", () => {
  it("returns 'article' for any input", () => {
    expect(getSourceType("docs/guide.md")).toBe("article");
  });

  it("returns 'article' for an empty string", () => {
    expect(getSourceType("")).toBe("article");
  });

  it("returns 'article' for a path that looks like code", () => {
    expect(getSourceType("src/index.ts")).toBe("article");
  });

  it("returns 'article' regardless of input content", () => {
    expect(getSourceType("anything/at/all")).toBe("article");
    expect(getSourceType("light-space/help-articles/README.md")).toBe(
      "article"
    );
  });
});

// ============================================
// extractArticleTitle()
// ============================================

describe("extractArticleTitle", () => {
  it("extracts title from '# My Title\\nSome content'", () => {
    const content = "# My Title\nSome content here.";
    expect(extractArticleTitle(content)).toBe("My Title");
  });

  it("returns undefined when there is no heading", () => {
    const content = "Just some plain text without any headings.";
    expect(extractArticleTitle(content)).toBeUndefined();
  });

  it("does NOT match ## second level headings", () => {
    const content = "## Second Level\nSome content.";
    // The regex is /^#\s+(.+)$/m which requires exactly one # followed by space
    // "## Second Level" has two # chars, but the regex ^#\s+ matches "# " at start
    // Actually let's verify: "##" starts with "#" then the next char is "#" not \s
    // So ^#\s+ does NOT match "## Second Level" -- correct
    expect(extractArticleTitle(content)).toBeUndefined();
  });

  it("extracts the first # heading when multiple exist", () => {
    const content = "Some intro text\n# First Title\n## Sub\n# Second Title";
    expect(extractArticleTitle(content)).toBe("First Title");
  });

  it("trims whitespace from extracted title", () => {
    const content = "#   Spaced Title   \nContent";
    expect(extractArticleTitle(content)).toBe("Spaced Title");
  });

  it("returns undefined for an empty string", () => {
    expect(extractArticleTitle("")).toBeUndefined();
  });
});

// ============================================
// extractFilePath()
// ============================================

describe("extractFilePath", () => {
  it("extracts 'docs/guide.md' from 'light-space/help-articles/docs/guide.md'", () => {
    expect(
      extractFilePath("light-space/help-articles/docs/guide.md")
    ).toBe("docs/guide.md");
  });

  it("returns source as-is if fewer than 3 parts", () => {
    expect(extractFilePath("short")).toBe("short");
    expect(extractFilePath("two/parts")).toBe("two/parts");
  });

  it("handles deeply nested paths by stripping first two segments", () => {
    expect(
      extractFilePath("light-space/help-articles/a/b/c/deep.md")
    ).toBe("a/b/c/deep.md");
  });

  it("strips exactly the first two path segments", () => {
    expect(extractFilePath("org/repo/file.md")).toBe("file.md");
  });
});

// ============================================
// chunkDocument()
// ============================================

describe("chunkDocument", () => {
  it("chunks a short document into 1 chunk", () => {
    const content = "# Short Article\n\nThis is a short article with enough text to pass the minimum filter.";
    const source = "light-space/help-articles/docs/short.md";
    const chunks = chunkDocument(content, source);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("Short Article");
  });

  it("assigns sourceType 'article' to all chunks", () => {
    const content =
      "# Title\n\nParagraph one with enough content to be meaningful.\n\n## Section Two\n\nParagraph two with more meaningful content here.";
    const source = "light-space/help-articles/docs/guide.md";
    const chunks = chunkDocument(content, source);

    for (const chunk of chunks) {
      expect(chunk.metadata.sourceType).toBe("article");
    }
  });

  it("includes title extracted from the first heading", () => {
    const content =
      "# Getting Started\n\nWelcome to the guide. This has enough content to pass the filter.";
    const source = "light-space/help-articles/docs/start.md";
    const chunks = chunkDocument(content, source);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.metadata.title).toBe("Getting Started");
    }
  });

  it("includes filePath extracted from source", () => {
    const content =
      "# Guide\n\nThis is enough content to pass the twenty character filter.";
    const source = "light-space/help-articles/docs/guide.md";
    const chunks = chunkDocument(content, source);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.metadata.filePath).toBe("docs/guide.md");
    }
  });

  it("filters out tiny chunks (< 20 chars)", () => {
    // Create content where some sections would produce very short chunks
    const content = "# Title\n\nOk.\n\n## Section\n\nThis section has enough content to be a meaningful chunk on its own.";
    const source = "light-space/help-articles/docs/mixed.md";
    const chunks = chunkDocument(content, source);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(20);
    }
  });

  it("splits by markdown headings", () => {
    const content = [
      "# Main Title",
      "",
      "Introduction paragraph with enough content to pass the minimum filter threshold.",
      "",
      "## First Section",
      "",
      "First section content that is long enough to not be filtered out by minimum.",
      "",
      "## Second Section",
      "",
      "Second section content that is also long enough to pass the filter threshold.",
    ].join("\n");
    const source = "light-space/help-articles/docs/multi.md";
    const chunks = chunkDocument(content, source);

    // Should have at least 2 chunks (one per heading-delimited section)
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Verify heading metadata varies across sections
    const headings = chunks.map((c) => c.metadata.heading);
    const uniqueHeadings = new Set(headings);
    expect(uniqueHeadings.size).toBeGreaterThanOrEqual(2);
  });

  it("assigns sequential chunk indices", () => {
    const content =
      "# Title\n\nFirst section with enough content to pass the filter.\n\n## Next\n\nSecond section with enough content to pass the filter.";
    const source = "light-space/help-articles/docs/seq.md";
    const chunks = chunkDocument(content, source);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i);
    }
  });

  it("preserves the original source in metadata", () => {
    const content =
      "# Article\n\nBody content that is long enough to pass the twenty character threshold.";
    const source = "light-space/help-articles/docs/article.md";
    const chunks = chunkDocument(content, source);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.metadata.source).toBe(source);
    }
  });

  it("returns an empty array for content that is all tiny", () => {
    // Every section shorter than 20 chars
    const content = "# A\n\nHi";
    const source = "light-space/help-articles/docs/tiny.md";
    const chunks = chunkDocument(content, source);

    // All chunks should be filtered out since they are <= 20 chars
    expect(chunks).toHaveLength(0);
  });
});
