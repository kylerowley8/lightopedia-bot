// ============================================
// Citation Gate Tests
// ============================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyCitationGate, validateInlineCitations } from "../src/grounding/citationGate.js";
import type {
  DraftAnswer,
  EvidencePack,
  Article,
} from "../src/evidence/types.js";

// ============================================
// Test Helpers
// ============================================

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: overrides.id ?? "article-1",
    path: overrides.path ?? "billing/invoices.md",
    section: overrides.section,
    title: Object.hasOwn(overrides, "title") ? overrides.title : "Invoices",
    content: overrides.content ?? "Invoices are created automatically when a billing cycle completes.",
    score: overrides.score ?? 0.85,
    repoSlug: overrides.repoSlug ?? "light-space/help-articles",
    metadata: overrides.metadata ?? {
      path: overrides.path ?? "billing/invoices.md",
      indexedAt: "2024-01-01T00:00:00Z",
      indexRunId: "run-123",
      retrievalProgramVersion: "retrieval.v2.0",
    },
  };
}

function makeDraft(overrides: Partial<DraftAnswer> = {}): DraftAnswer {
  return {
    summary: overrides.summary ?? "Light creates invoices automatically.",
    detailedAnswer: overrides.detailedAnswer,
    suggestedConfidence: overrides.suggestedConfidence ?? "confirmed",
    internalNotes: overrides.internalNotes,
  };
}

function makeEvidencePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    articles: overrides.articles ?? [],
    attachments: overrides.attachments,
    retrievalMeta: overrides.retrievalMeta ?? {
      version: "retrieval.v2.0",
      indexRunId: "run-123",
      totalSearched: 10,
      queriesUsed: ["invoices"],
    },
  };
}

// ============================================
// applyCitationGate
// ============================================

describe("applyCitationGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PASSES when functional language is present and articles exist", () => {
    const draft = makeDraft({ summary: "Light automatically creates invoices." });
    const evidence = makeEvidencePack({ articles: [makeArticle()] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBe("confirmed");
      expect(result.answer.summary).toBe(draft.summary);
      expect(result.answer.hasAmbiguity).toBe(false);
    }
  });

  it("FAILS when functional language is present but no articles exist", () => {
    const draft = makeDraft({ summary: "Light automatically creates invoices." });
    const evidence = makeEvidencePack({ articles: [] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("functional claims");
      expect(result.reason).toContain("no article evidence");
      expect(result.droppedClaims).toBeInstanceOf(Array);
    }
  });

  it("PASSES when no functional language and no articles (explanatory only)", () => {
    const draft = makeDraft({ summary: "Hello, thank you for your question." });
    const evidence = makeEvidencePack({ articles: [] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBe("needs_clarification");
      expect(result.answer.summary).toBe("Hello, thank you for your question.");
    }
  });

  it("PASSES when no functional language and articles exist", () => {
    const draft = makeDraft({ summary: "Thank you for asking about invoicing." });
    const evidence = makeEvidencePack({ articles: [makeArticle()] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBe("confirmed");
    }
  });

  it("preserves detailedAnswer when present", () => {
    const draft = makeDraft({
      summary: "Hello, here is info.",
      detailedAnswer: "More details about the topic.",
    });
    const evidence = makeEvidencePack({ articles: [makeArticle()] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.detailedAnswer).toBe("More details about the topic.");
    }
  });

  it("preserves internalNotes when present", () => {
    const draft = makeDraft({
      summary: "Here is the answer.",
      internalNotes: "Follow up with billing team.",
    });
    const evidence = makeEvidencePack({ articles: [makeArticle()] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.internalNotes).toBe("Follow up with billing team.");
    }
  });

  it("sets confidence to needs_clarification when no articles", () => {
    const draft = makeDraft({ summary: "What is invoicing?" });
    const evidence = makeEvidencePack({ articles: [] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBe("needs_clarification");
    }
  });

  it("detects functional language in detailedAnswer even when summary is clean", () => {
    const draft = makeDraft({
      summary: "Here is some information.",
      detailedAnswer: "The system automatically processes payments.",
    });
    const evidence = makeEvidencePack({ articles: [] });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain("functional claims");
    }
  });

  // ============================================
  // Functional Language Detection
  // ============================================

  describe("functional language detection", () => {
    const functionalWords = [
      { word: "does", sentence: "Light does this automatically." },
      { word: "happens", sentence: "This happens when you submit." },
      { word: "writes", sentence: "The system writes to the ledger." },
      { word: "creates", sentence: "It creates a new invoice." },
      { word: "automatically", sentence: "Invoices are sent automatically." },
      { word: "always", sentence: "This always runs at midnight." },
      { word: "never", sentence: "Light never exposes API keys." },
      { word: "supports", sentence: "Light supports multi-currency." },
      { word: "handles", sentence: "The system handles retries." },
      { word: "triggers", sentence: "This triggers a webhook." },
    ];

    for (const { word, sentence } of functionalWords) {
      it(`detects "${word}" as functional language`, () => {
        const draft = makeDraft({ summary: sentence });
        const evidence = makeEvidencePack({ articles: [] });

        const result = applyCitationGate(draft, evidence);

        expect(result.passed).toBe(false);
        if (!result.passed) {
          expect(result.reason).toContain("functional claims");
        }
      });
    }

    // Additional functional words from the regex patterns
    const additionalFunctional = [
      { word: "do", sentence: "What do the webhooks do?" },
      { word: "did", sentence: "The job did complete." },
      { word: "happen", sentence: "This will happen next." },
      { word: "happened", sentence: "An error happened." },
      { word: "wrote", sentence: "The indexer wrote the data." },
      { word: "written", sentence: "Data is written to the DB." },
      { word: "reads", sentence: "The service reads from the queue." },
      { word: "triggered", sentence: "The event triggered a sync." },
      { word: "calls", sentence: "It calls the Stripe API." },
      { word: "called", sentence: "A function called processInvoice." },
      { word: "sends", sentence: "Light sends notifications." },
      { word: "sent", sentence: "The email was sent." },
      { word: "created", sentence: "An invoice was created." },
      { word: "deletes", sentence: "It deletes old records." },
      { word: "deleted", sentence: "The record was deleted." },
      { word: "updates", sentence: "It updates the ledger." },
      { word: "updated", sentence: "The contract was updated." },
      { word: "processes", sentence: "It processes payments daily." },
      { word: "processed", sentence: "The batch was processed." },
      { word: "stores", sentence: "Light stores data securely." },
      { word: "stored", sentence: "Data is stored in Supabase." },
      { word: "syncs", sentence: "It syncs with Salesforce." },
      { word: "synchronizes", sentence: "The system synchronizes data." },
      { word: "validates", sentence: "It validates the input." },
      { word: "validated", sentence: "The schema was validated." },
      { word: "calculates", sentence: "It calculates the total." },
      { word: "calculated", sentence: "The amount was calculated." },
    ];

    for (const { word, sentence } of additionalFunctional) {
      it(`detects "${word}" as functional language`, () => {
        const draft = makeDraft({ summary: sentence });
        const evidence = makeEvidencePack({ articles: [] });

        const result = applyCitationGate(draft, evidence);

        expect(result.passed).toBe(false);
        if (!result.passed) {
          expect(result.reason).toContain("functional claims");
        }
      });
    }
  });

  describe("non-functional language passes without articles", () => {
    const nonFunctionalPhrases = [
      "Hello",
      "Thank you",
      "What is invoicing?",
      "Good morning!",
      "Let me look into that.",
      "I can help with that.",
      "Sure, one moment.",
      "Invoicing is a common topic.",
    ];

    for (const phrase of nonFunctionalPhrases) {
      it(`"${phrase}" passes as non-functional`, () => {
        const draft = makeDraft({ summary: phrase });
        const evidence = makeEvidencePack({ articles: [] });

        const result = applyCitationGate(draft, evidence);

        expect(result.passed).toBe(true);
      });
    }
  });

  it("functional language with articles passes with confirmed confidence", () => {
    const draft = makeDraft({ summary: "The system automatically handles retries." });
    const evidence = makeEvidencePack({
      articles: [makeArticle(), makeArticle({ id: "article-2", path: "billing/retry.md" })],
    });

    const result = applyCitationGate(draft, evidence);

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.answer.confidence).toBe("confirmed");
    }
  });
});

// ============================================
// validateInlineCitations
// ============================================

describe("validateInlineCitations", () => {
  it("returns valid when all cited paths exist in fetched set", () => {
    const text = "Light supports billing [[1]](billing/invoices.md) and payments [[2]](billing/payments.md).";
    const fetchedPaths = new Set(["billing/invoices.md", "billing/payments.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(true);
    expect(result.invalidPaths).toHaveLength(0);
    expect(result.citedPaths).toContain("billing/invoices.md");
    expect(result.citedPaths).toContain("billing/payments.md");
  });

  it("returns invalid when cited path not in fetched set", () => {
    const text = "Light supports billing [[1]](billing/invoices.md) and CRM [[2]](crm/overview.md).";
    const fetchedPaths = new Set(["billing/invoices.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(false);
    expect(result.invalidPaths).toContain("crm/overview.md");
  });

  it("returns valid when no citations in text", () => {
    const text = "This answer has no citations at all.";
    const fetchedPaths = new Set(["billing/invoices.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(true);
    expect(result.citedPaths).toHaveLength(0);
    expect(result.invalidPaths).toHaveLength(0);
  });

  it("deduplicates cited paths", () => {
    const text = "Billing works [[1]](billing/invoices.md) for all cases [[1]](billing/invoices.md).";
    const fetchedPaths = new Set(["billing/invoices.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(true);
    expect(result.citedPaths).toHaveLength(1);
  });

  it("handles multiple invalid paths", () => {
    const text = "See [[1]](a.md) and [[2]](b.md) and [[3]](c.md).";
    const fetchedPaths = new Set(["a.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(false);
    expect(result.invalidPaths).toHaveLength(2);
    expect(result.invalidPaths).toContain("b.md");
    expect(result.invalidPaths).toContain("c.md");
  });

  it("handles empty fetched paths set", () => {
    const text = "Billing works [[1]](billing/invoices.md).";
    const fetchedPaths = new Set<string>();

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(false);
    expect(result.invalidPaths).toContain("billing/invoices.md");
  });

  it("handles text with no inline citation format (regular markdown links)", () => {
    const text = "See [this link](https://example.com) for details.";
    const fetchedPaths = new Set(["billing/invoices.md"]);

    const result = validateInlineCitations(text, fetchedPaths);

    expect(result.isValid).toBe(true);
    expect(result.citedPaths).toHaveLength(0);
  });
});
