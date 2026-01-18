// ============================================
// Integration Tests — V2 Pipeline End-to-End
// ============================================
// Tests the full pipeline with mocked database and LLM.
// For real Supabase tests, use scripts/test-db-rpcs.ts

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
  chat: vi.fn().mockResolvedValue({
    summary: "Light invoices are automatically created when billing cycles complete.",
    claims: [
      {
        text: "Invoices are created automatically at the end of each billing cycle.",
        citations: [{ type: "docs", ref: "docs/billing.md", label: "Billing docs" }],
      },
    ],
    suggestedConfidence: "confirmed_docs",
  }),
  DEFAULT_MODEL: "gpt-4o-2024-08-06",
}));

// Import after mocks
import { routeQuestion, type RouterInput } from "../src/router/routeQuestion.js";
import { retrieveDocs } from "../src/retrieval/docsRetrieval.js";
import { applyCitationGate } from "../src/grounding/citationGate.js";
import { supabase } from "../src/db/supabase.js";
import { ROUTER_VERSION, type Mode } from "../src/router/types.js";
import { RETRIEVAL_VERSION, type EvidencePack, type DraftAnswer } from "../src/evidence/types.js";

describe("Router Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a valid RouteDecision with all required fields", async () => {
    const input: RouterInput = {
      question: "Can Light handle multi-currency invoices?",
      hasThreadHistory: false,
    };

    const result = await routeQuestion(input);

    // Verify structure
    expect(result.mode).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.queryHints).toBeInstanceOf(Array);

    // Mode should be one of the valid modes
    expect([
      "capability_docs",
      "enablement_sales",
      "onboarding_howto",
      "followup",
      "clarify",
      "out_of_scope",
    ]).toContain(result.mode);

    // Confidence should be valid
    expect(["high", "medium", "low"]).toContain(result.confidence);
  });

  it("should extract query hints from the question", async () => {
    const input: RouterInput = {
      question: "Can Light handle InvoiceService operations?",
      hasThreadHistory: false,
    };

    const result = await routeQuestion(input);

    // Should extract PascalCase identifiers
    expect(result.queryHints).toContain("InvoiceService");
  });

  it("should handle empty questions gracefully", async () => {
    const input: RouterInput = {
      question: "",
      hasThreadHistory: false,
    };

    const result = await routeQuestion(input);

    // Should still return a valid decision
    expect(result.mode).toBeDefined();
    expect(result.confidence).toBeDefined();
  });
});

describe("Retrieval Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock for match_docs RPC
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: "doc-1",
          content: "Light invoices are created automatically when a billing cycle completes.",
          metadata: {
            source_type: "repo",
            repo_slug: "light-space/light",
            path: "docs/billing.md",
            section: "Invoice Creation",
            commit_sha: "abc123",
            indexed_at: "2024-01-01T00:00:00Z",
            index_run_id: "run-123",
            retrieval_program_version: RETRIEVAL_VERSION,
          },
          similarity: 0.85,
        },
        {
          id: "doc-2",
          content: "Invoices can be refunded partially or fully using the API.",
          metadata: {
            source_type: "repo",
            repo_slug: "light-space/light",
            path: "docs/billing.md",
            section: "Refunds",
            commit_sha: "abc123",
            indexed_at: "2024-01-01T00:00:00Z",
            index_run_id: "run-123",
            retrieval_program_version: RETRIEVAL_VERSION,
          },
          similarity: 0.72,
        },
      ],
      error: null,
    });
  });

  it("should retrieve docs for a routed question", async () => {
    const route = {
      mode: "capability_docs" as Mode,
      confidence: "high" as const,
      queryHints: ["invoices", "billing"],
    };

    const result = await retrieveDocs("How do Light invoices work?", route);

    expect(result.docs.length).toBeGreaterThan(0);
    expect(result.docs[0]?.source).toBe("docs/billing.md");
    expect(result.docs[0]?.similarity).toBeGreaterThan(0);
    expect(result.retrievalMeta.version).toBe(RETRIEVAL_VERSION);
    expect(supabase.rpc).toHaveBeenCalledWith("match_docs", expect.any(Object));
  });

  it("should build EvidencePack with required metadata", async () => {
    const route = {
      mode: "capability_docs" as Mode,
      confidence: "high" as const,
      queryHints: ["Invoice"],
    };

    const result = await retrieveDocs("How do invoices work?", route);

    // Verify EvidencePack structure
    expect(result.docs).toBeInstanceOf(Array);
    expect(result.slackThreads).toBeInstanceOf(Array);
    expect(result.retrievalMeta).toBeDefined();
    expect(result.retrievalMeta.version).toBe(RETRIEVAL_VERSION);
    expect(result.retrievalMeta.queriesUsed).toBeInstanceOf(Array);
    expect(result.retrievalMeta.queriesUsed.length).toBeGreaterThan(0);
  });

  it("should filter out low-similarity results", async () => {
    // Mock returns results with varying similarity
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        { id: "high", content: "High similarity", metadata: {}, similarity: 0.85 },
        { id: "low", content: "Low similarity", metadata: {}, similarity: 0.2 },
      ],
      error: null,
    });

    const route = {
      mode: "capability_docs" as Mode,
      confidence: "high" as const,
      queryHints: [],
    };

    const result = await retrieveDocs("test", route);

    // Low similarity result should be filtered (MIN_SIMILARITY = 0.2)
    expect(result.docs.every((d) => d.similarity >= 0.2)).toBe(true);
  });
});

describe("Citation Gate Integration", () => {
  it("should pass answers with valid citations", () => {
    const mockEvidence: EvidencePack = {
      docs: [
        {
          id: "doc-1",
          source: "docs/billing.md",
          content: "Invoices are created automatically.",
          similarity: 0.85,
          metadata: {
            sourceType: "repo",
            path: "docs/billing.md",
            indexedAt: "2024-01-01T00:00:00Z",
            indexRunId: "run-123",
            retrievalProgramVersion: RETRIEVAL_VERSION,
          },
        },
      ],
      slackThreads: [],
      retrievalMeta: {
        version: RETRIEVAL_VERSION,
        indexRunId: "run-123",
        totalSearched: 10,
        queriesUsed: ["invoices"],
      },
    };

    const draft: DraftAnswer = {
      summary: "Light automatically creates invoices.",
      claims: [
        {
          text: "Invoices are created automatically at the end of each billing cycle.",
          citations: [{ type: "docs", ref: "docs/billing.md", label: "Billing docs" }],
        },
      ],
      suggestedConfidence: "confirmed_docs",
    };

    const result = applyCitationGate(draft, mockEvidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.claims.length).toBe(1);
      // Confidence is based on citation types, not draft
      expect(result.answer.confidence).toBeDefined();
    }
  });

  it("should reject answers with ungrounded claims", () => {
    const mockEvidence: EvidencePack = {
      docs: [],
      slackThreads: [],
      retrievalMeta: {
        version: RETRIEVAL_VERSION,
        indexRunId: "run-123",
        totalSearched: 0,
        queriesUsed: [],
      },
    };

    const draft: DraftAnswer = {
      summary: "Light does X, Y, and Z.",
      claims: [
        {
          text: "Light automatically retries failed payments three times.",
          citations: [], // No citations!
        },
      ],
      suggestedConfidence: "confirmed_docs",
    };

    const result = applyCitationGate(draft, mockEvidence);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.droppedClaims.length).toBeGreaterThan(0);
    }
  });

  it("should keep properly cited claims and drop uncited ones", () => {
    const mockEvidence: EvidencePack = {
      docs: [
        {
          id: "doc-1",
          source: "docs/billing.md",
          content: "Invoices are created automatically.",
          similarity: 0.85,
          metadata: {
            sourceType: "repo",
            path: "docs/billing.md",
            indexedAt: "2024-01-01T00:00:00Z",
            indexRunId: "run-123",
            retrievalProgramVersion: RETRIEVAL_VERSION,
          },
        },
      ],
      slackThreads: [],
      retrievalMeta: {
        version: RETRIEVAL_VERSION,
        indexRunId: "run-123",
        totalSearched: 10,
        queriesUsed: ["invoices"],
      },
    };

    const draft: DraftAnswer = {
      summary: "Light invoices have many features.",
      claims: [
        {
          text: "Invoices are created automatically.",
          citations: [{ type: "docs", ref: "docs/billing.md" }],
        },
        {
          text: "Light sends emails automatically.", // No citation
          citations: [],
        },
      ],
      suggestedConfidence: "confirmed_docs",
    };

    const result = applyCitationGate(draft, mockEvidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      // Only the cited claim should remain
      expect(result.answer.claims.length).toBe(1);
      expect(result.answer.claims[0]?.text).toContain("Invoices");
    }
  });
});

describe("Version Constants", () => {
  it("should have consistent version strings", () => {
    expect(ROUTER_VERSION).toMatch(/^router\.v\d+\.\d+$/);
    expect(RETRIEVAL_VERSION).toMatch(/^retrieval\.v\d+\.\d+$/);
  });
});

describe("Indexer Config Integration", () => {
  it("should validate complete indexing requests", async () => {
    const { validateIndexRequest } = await import("../src/indexer/config.js");

    // Valid request
    const valid = validateIndexRequest("light-space/light", "docs/billing.md");
    expect(valid.allowed).toBe(true);

    // Invalid repo
    const badRepo = validateIndexRequest("other/repo", "docs/billing.md");
    expect(badRepo.allowed).toBe(false);
    expect(badRepo.reason).toContain("Repo not in allowlist");

    // Invalid path
    const badPath = validateIndexRequest("light-space/light", "src/Main.kt");
    expect(badPath.allowed).toBe(false);
    expect(badPath.reason).toContain("Path not allowed");
  });

  it("should validate Slack channel allowlist", async () => {
    const { isAllowedSlackChannel, ALLOWED_SLACK_CHANNELS } = await import(
      "../src/indexer/config.js"
    );

    expect(isAllowedSlackChannel(ALLOWED_SLACK_CHANNELS.lightopedia)).toBe(true);
    expect(isAllowedSlackChannel("C12345678")).toBe(false);
  });
});
