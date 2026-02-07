// ============================================
// Integration Tests — V3 Agentic Pipeline
// ============================================
// Tests pipeline components with mocked database and LLM.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("../src/db/supabase.js", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

vi.mock("../src/retrieval/embeddings.js", () => ({
  embedQuery: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
  embedChunks: vi.fn().mockImplementation((texts: string[]) =>
    Promise.resolve(texts.map(() => new Array(1536).fill(0.1)))
  ),
  EMBEDDING_MODEL: "text-embedding-3-large",
  EMBEDDING_DIMENSIONS: 1536,
}));

vi.mock("../src/llm/client.js", () => ({
  openai: {
    chat: { completions: { create: vi.fn() } },
    embeddings: { create: vi.fn() },
  },
  SYNTHESIS_MODEL: "gpt-4o",
  FAST_MODEL: "gpt-4o-mini",
}));

// Import after mocks
import { applyCitationGate } from "../src/grounding/citationGate.js";
import { validateInlineCitations } from "../src/grounding/citationGate.js";
import { supabase } from "../src/db/supabase.js";
import { RETRIEVAL_VERSION, type EvidencePack, type DraftAnswer } from "../src/evidence/types.js";
import { fetchArticlesByPath } from "../src/retrieval/search.js";

// ============================================
// fetchArticlesByPath Integration
// ============================================

describe("fetchArticlesByPath Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return articles for given paths", async () => {
    const mockData = [
      {
        id: "chunk-1",
        content: "Invoices are created when billing cycles complete.",
        metadata: {
          path: "billing/invoices.md",
          indexedAt: "2024-01-01T00:00:00Z",
          indexRunId: "run-123",
          retrievalProgramVersion: RETRIEVAL_VERSION,
        },
      },
      {
        id: "chunk-2",
        content: "Payment retry happens after 24 hours.",
        metadata: {
          path: "billing/payments.md",
          indexedAt: "2024-01-01T00:00:00Z",
          indexRunId: "run-123",
          retrievalProgramVersion: RETRIEVAL_VERSION,
        },
      },
    ];

    // Mock the supabase chain: from().select().or().order()
    const mockOrder = vi.fn().mockResolvedValue({ data: mockData, error: null });
    const mockOr = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ or: mockOr });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ select: mockSelect });

    const articles = await fetchArticlesByPath(["billing/invoices.md", "billing/payments.md"]);

    expect(articles).toHaveLength(2);
    expect(articles[0]!.path).toBe("billing/invoices.md");
    expect(articles[1]!.path).toBe("billing/payments.md");
  });

  it("should return empty array for empty paths input", async () => {
    const articles = await fetchArticlesByPath([]);
    expect(articles).toHaveLength(0);
  });

  it("should group chunks by path", async () => {
    const mockData = [
      {
        id: "chunk-1",
        content: "Part 1 of billing article.",
        metadata: {
          path: "billing/invoices.md",
          indexedAt: "2024-01-01T00:00:00Z",
          indexRunId: "run-123",
          retrievalProgramVersion: RETRIEVAL_VERSION,
        },
      },
      {
        id: "chunk-2",
        content: "Part 2 of billing article.",
        metadata: {
          path: "billing/invoices.md",
          indexedAt: "2024-01-01T00:00:00Z",
          indexRunId: "run-123",
          retrievalProgramVersion: RETRIEVAL_VERSION,
        },
      },
    ];

    const mockOrder = vi.fn().mockResolvedValue({ data: mockData, error: null });
    const mockOr = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ or: mockOr });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ select: mockSelect });

    const articles = await fetchArticlesByPath(["billing/invoices.md"]);

    // Should group into 1 article with combined content
    expect(articles).toHaveLength(1);
    expect(articles[0]!.content).toContain("Part 1");
    expect(articles[0]!.content).toContain("Part 2");
  });
});

// ============================================
// Citation Gate Integration
// ============================================

describe("Citation Gate Integration", () => {
  it("should pass answers with valid citations", () => {
    const mockEvidence: EvidencePack = {
      articles: [
        {
          id: "doc-1",
          path: "docs/billing.md",
          content: "Invoices are created automatically.",
          score: 0.85,
          repoSlug: "light-space/help-articles",
          metadata: {
            path: "docs/billing.md",
            indexedAt: "2024-01-01T00:00:00Z",
            indexRunId: "run-123",
            retrievalProgramVersion: RETRIEVAL_VERSION,
          },
        },
      ],
      retrievalMeta: {
        version: RETRIEVAL_VERSION,
        indexRunId: "run-123",
        totalSearched: 10,
        queriesUsed: ["invoices"],
      },
    };

    const draft: DraftAnswer = {
      summary: "Light automatically creates invoices.",
      suggestedConfidence: "confirmed",
    };

    const result = applyCitationGate(draft, mockEvidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBeDefined();
    }
  });

  it("should reject answers with functional language but no articles", () => {
    const mockEvidence: EvidencePack = {
      articles: [],
      retrievalMeta: {
        version: RETRIEVAL_VERSION,
        indexRunId: "run-123",
        totalSearched: 0,
        queriesUsed: [],
      },
    };

    const draft: DraftAnswer = {
      summary: "Light does X, Y, and Z.",
      suggestedConfidence: "confirmed",
    };

    const result = applyCitationGate(draft, mockEvidence);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBeDefined();
    }
  });

  it("should pass answers with functional language when articles exist", () => {
    const mockEvidence: EvidencePack = {
      articles: [
        {
          id: "doc-1",
          path: "docs/billing.md",
          content: "Invoices are created automatically.",
          score: 0.85,
          repoSlug: "light-space/help-articles",
          metadata: {
            path: "docs/billing.md",
            indexedAt: "2024-01-01T00:00:00Z",
            indexRunId: "run-123",
            retrievalProgramVersion: RETRIEVAL_VERSION,
          },
        },
      ],
      retrievalMeta: {
        version: RETRIEVAL_VERSION,
        indexRunId: "run-123",
        totalSearched: 10,
        queriesUsed: ["invoices"],
      },
    };

    const draft: DraftAnswer = {
      summary: "Light invoices have many features and supports billing.",
      suggestedConfidence: "confirmed",
    };

    const result = applyCitationGate(draft, mockEvidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBe("confirmed");
    }
  });
});

// ============================================
// Inline Citation Validation Integration
// ============================================

describe("Inline Citation Validation Integration", () => {
  it("validates citations against fetched article paths", () => {
    const text = "Light supports billing [[1]](billing/invoices.md) and payments [[2]](billing/payments.md).";
    const fetchedPaths = new Set(["billing/invoices.md", "billing/payments.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(true);
    expect(result.citedPaths).toHaveLength(2);
  });

  it("detects invalid citation paths", () => {
    const text = "See [[1]](billing/invoices.md) and [[2]](nonexistent/path.md).";
    const fetchedPaths = new Set(["billing/invoices.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(false);
    expect(result.invalidPaths).toContain("nonexistent/path.md");
  });
});

// ============================================
// Version Constants
// ============================================

describe("Version Constants", () => {
  it("should have consistent retrieval version string", () => {
    expect(RETRIEVAL_VERSION).toMatch(/^retrieval\.v\d+\.\d+$/);
  });
});

// ============================================
// Indexer Config Integration
// ============================================

describe("Indexer Config Integration", () => {
  it("should validate complete indexing requests", async () => {
    const { validateIndexRequest } = await import("../src/indexer/config.js");

    const valid = validateIndexRequest("light-space/help-articles", "docs/billing.md");
    expect(valid.allowed).toBe(true);

    const badRepo = validateIndexRequest("other/repo", "docs/billing.md");
    expect(badRepo.allowed).toBe(false);
    expect(badRepo.reason).toContain("Repo not in allowlist");

    const badPath = validateIndexRequest("light-space/help-articles", "src/Main.java");
    expect(badPath.allowed).toBe(false);
    expect(badPath.reason).toContain("Path not allowed");
  });

  it("should validate allowed repos", async () => {
    const { isAllowedRepo } = await import("../src/indexer/config.js");

    expect(isAllowedRepo("light-space/help-articles")).toBe(true);
    expect(isAllowedRepo("other/repo")).toBe(false);
  });
});
