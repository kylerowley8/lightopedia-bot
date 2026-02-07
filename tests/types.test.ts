// ============================================
// Evidence Types Tests — Constants & Factories
// ============================================

import { describe, it, expect } from "vitest";
import {
  RETRIEVAL_VERSION,
  createEmptyEvidencePack,
  type EvidencePack,
  type RetrievalMeta,
  type Article,
  type AttachmentEvidence,
  type Citation,
  type ConfidenceLevel,
  type GroundedAnswer,
  type DraftAnswer,
  type CitationGateResult,
  type IndexMetadata,
} from "../src/evidence/types.js";

// ============================================
// RETRIEVAL_VERSION
// ============================================

describe("RETRIEVAL_VERSION", () => {
  it("is 'retrieval.v2.0'", () => {
    expect(RETRIEVAL_VERSION).toBe("retrieval.v2.0");
  });

  it("matches the retrieval version format", () => {
    expect(RETRIEVAL_VERSION).toMatch(/^retrieval\.v\d+\.\d+$/);
  });
});

// ============================================
// createEmptyEvidencePack()
// ============================================

describe("createEmptyEvidencePack", () => {
  it("returns a pack with empty articles array", () => {
    const pack = createEmptyEvidencePack("run-001");
    expect(pack.articles).toEqual([]);
  });

  it("returns a pack with empty attachments array", () => {
    const pack = createEmptyEvidencePack("run-001");
    expect(pack.attachments).toEqual([]);
  });

  it("returns a pack with correct retrievalMeta structure", () => {
    const pack = createEmptyEvidencePack("run-001");

    expect(pack.retrievalMeta).toBeDefined();
    expect(pack.retrievalMeta.version).toBe(RETRIEVAL_VERSION);
    expect(pack.retrievalMeta.indexRunId).toBe("run-001");
    expect(pack.retrievalMeta.totalSearched).toBe(0);
    expect(pack.retrievalMeta.queriesUsed).toEqual([]);
  });

  it("uses the provided indexRunId", () => {
    const pack = createEmptyEvidencePack("custom-run-id-xyz");
    expect(pack.retrievalMeta.indexRunId).toBe("custom-run-id-xyz");
  });

  it("returns a new object each time (no shared references)", () => {
    const pack1 = createEmptyEvidencePack("run-1");
    const pack2 = createEmptyEvidencePack("run-2");

    expect(pack1).not.toBe(pack2);
    expect(pack1.articles).not.toBe(pack2.articles);
    expect(pack1.attachments).not.toBe(pack2.attachments);
    expect(pack1.retrievalMeta).not.toBe(pack2.retrievalMeta);
    expect(pack1.retrievalMeta.queriesUsed).not.toBe(
      pack2.retrievalMeta.queriesUsed
    );
  });

  it("conforms to the EvidencePack type at runtime", () => {
    const pack: EvidencePack = createEmptyEvidencePack("run-type-check");

    // Verify all required top-level keys are present
    expect(pack).toHaveProperty("articles");
    expect(pack).toHaveProperty("retrievalMeta");

    // retrievalMeta has all required fields
    const meta: RetrievalMeta = pack.retrievalMeta;
    expect(meta).toHaveProperty("version");
    expect(meta).toHaveProperty("indexRunId");
    expect(meta).toHaveProperty("totalSearched");
    expect(meta).toHaveProperty("queriesUsed");
  });
});

// ============================================
// Type compilation checks (runtime validation)
// ============================================

describe("Type compilation checks", () => {
  it("Article type has expected shape", () => {
    const article: Article = {
      id: "chunk-1",
      path: "docs/billing.md",
      section: "Overview",
      title: "Billing Guide",
      content: "Invoices are created automatically.",
      score: 0.85,
      repoSlug: "light-space/help-articles",
      metadata: {
        path: "docs/billing.md",
        indexedAt: "2025-01-01T00:00:00Z",
        indexRunId: "run-001",
        retrievalProgramVersion: RETRIEVAL_VERSION,
      },
    };

    expect(article.id).toBe("chunk-1");
    expect(article.score).toBe(0.85);
    expect(article.metadata.retrievalProgramVersion).toBe(RETRIEVAL_VERSION);
  });

  it("AttachmentEvidence type has expected shape", () => {
    const attachment: AttachmentEvidence = {
      type: "image",
      extractedText: "Error 404 on page",
      identifiers: ["ERR-404", "/api/invoices"],
      slackFileId: "F12345",
    };

    expect(attachment.type).toBe("image");
    expect(attachment.identifiers).toContain("ERR-404");
  });

  it("ConfidenceLevel accepts valid values", () => {
    const confirmed: ConfidenceLevel = "confirmed";
    const needsClarification: ConfidenceLevel = "needs_clarification";

    expect(confirmed).toBe("confirmed");
    expect(needsClarification).toBe("needs_clarification");
  });

  it("Citation type has expected shape", () => {
    const citation: Citation = {
      type: "article",
      ref: "docs/billing.md",
      label: "Billing Guide",
    };

    expect(citation.type).toBe("article");
    expect(citation.ref).toBe("docs/billing.md");
  });

  it("DraftAnswer type has expected shape", () => {
    const draft: DraftAnswer = {
      summary: "Light handles invoicing automatically.",
      suggestedConfidence: "confirmed",
    };

    expect(draft.summary).toBeDefined();
    expect(draft.suggestedConfidence).toBe("confirmed");
  });

  it("CitationGateResult passed variant has answer", () => {
    const result: CitationGateResult = {
      passed: true,
      answer: {
        summary: "Light handles invoicing.",
        confidence: "confirmed",
        hasAmbiguity: false,
      },
    };

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBe("confirmed");
    }
  });

  it("CitationGateResult failed variant has reason and droppedClaims", () => {
    const result: CitationGateResult = {
      passed: false,
      reason: "No grounded claims found",
      droppedClaims: ["Unverified claim about payments"],
    };

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBeDefined();
      expect(result.droppedClaims).toHaveLength(1);
    }
  });

  it("IndexMetadata type has expected shape", () => {
    const meta: IndexMetadata = {
      path: "docs/billing.md",
      indexedAt: "2025-01-01T00:00:00Z",
      indexRunId: "run-001",
      retrievalProgramVersion: RETRIEVAL_VERSION,
      repoSlug: "light-space/help-articles",
      commitSha: "abc123def",
    };

    expect(meta.path).toBe("docs/billing.md");
    expect(meta.repoSlug).toBe("light-space/help-articles");
    expect(meta.commitSha).toBe("abc123def");
  });
});
