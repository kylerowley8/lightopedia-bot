// ============================================
// Router Golden Tests
// Canonical question → expected mode mappings
// ============================================

import { describe, it, expect, beforeAll } from "vitest";
import { classifyWithHeuristics, extractQueryHints, detectPronouns } from "../src/router/heuristics.js";
import { routeQuestion } from "../src/router/routeQuestion.js";
import type { Mode, RouterInput } from "../src/router/types.js";

// ============================================
// Golden Test Cases
// ============================================

interface GoldenCase {
  question: string;
  expectedMode: Mode;
  description: string;
  tags?: string[];
}

/**
 * Capability questions → capability_docs
 */
const CAPABILITY_CASES: GoldenCase[] = [
  {
    question: "Can Light handle multi-currency invoicing?",
    expectedMode: "capability_docs",
    description: "Direct capability question with 'can Light'",
  },
  {
    question: "Does Light support recurring billing?",
    expectedMode: "capability_docs",
    description: "Capability question with 'does Light support'",
  },
  {
    question: "Is it possible to integrate with QuickBooks?",
    expectedMode: "capability_docs",
    description: "Capability question with 'is it possible'",
  },
  {
    question: "What Salesforce integration features are available?",
    expectedMode: "capability_docs",
    description: "Feature availability question",
  },
  {
    question: "Does Light have an API for invoice creation?",
    expectedMode: "capability_docs",
    description: "API capability question",
  },
  {
    question: "What is a contract in Light?",
    expectedMode: "capability_docs",
    description: "Conceptual 'what is' question",
  },
  {
    question: "Explain the ledger model in Light",
    expectedMode: "capability_docs",
    description: "Conceptual explanation request",
  },
  {
    question: "What are the different invoice states?",
    expectedMode: "capability_docs",
    description: "Conceptual 'what are' question",
  },
  {
    question: "How does the Stripe integration work?",
    expectedMode: "capability_docs",
    description: "Integration overview (not deep behavior)",
    tags: ["integration"],
  },
];

/**
 * Enablement questions → enablement_sales
 */
const ENABLEMENT_CASES: GoldenCase[] = [
  {
    question: "How should I explain the billing model to a customer?",
    expectedMode: "enablement_sales",
    description: "Direct enablement with 'how should I explain'",
  },
  {
    question: "What should I say when a prospect asks about pricing?",
    expectedMode: "enablement_sales",
    description: "Enablement with 'what should I say'",
  },
  {
    question: "How do I position Light against competitors?",
    expectedMode: "enablement_sales",
    description: "Positioning question",
  },
  {
    question: "What's the best way to pitch the AR automation feature?",
    expectedMode: "enablement_sales",
    description: "Pitch strategy question",
  },
  {
    question: "How do I handle the objection about implementation time?",
    expectedMode: "enablement_sales",
    description: "Objection handling",
  },
  {
    question: "What's the messaging for enterprise customers?",
    expectedMode: "enablement_sales",
    description: "Messaging question",
  },
  {
    question: "Talk track for the demo next week",
    expectedMode: "enablement_sales",
    description: "Talk track request",
  },
];

/**
 * How-to questions → onboarding_howto
 */
const HOWTO_CASES: GoldenCase[] = [
  {
    question: "How do I configure Salesforce sync?",
    expectedMode: "onboarding_howto",
    description: "Configuration how-to",
  },
  {
    question: "How do I set up a new billing schedule?",
    expectedMode: "onboarding_howto",
    description: "Setup how-to",
  },
  {
    question: "Step by step guide to enable webhooks",
    expectedMode: "onboarding_howto",
    description: "Step-by-step request",
  },
  {
    question: "How to create a new contract template?",
    expectedMode: "onboarding_howto",
    description: "Creation how-to",
  },
  {
    question: "Getting started with the API",
    expectedMode: "onboarding_howto",
    description: "Getting started request",
  },
  {
    question: "Walkthrough for setting up payment methods",
    expectedMode: "onboarding_howto",
    description: "Walkthrough request",
  },
];

/**
 * Out-of-scope questions → out_of_scope
 * These ask about code behavior, runtime details, or customer data
 */
const OUT_OF_SCOPE_CASES: GoldenCase[] = [
  {
    question: "What happens when an invoice is marked as paid?",
    expectedMode: "out_of_scope",
    description: "Code behavior question with 'what happens when'",
  },
  {
    question: "What happens if the payment fails?",
    expectedMode: "out_of_scope",
    description: "Code behavior question with 'what happens if'",
  },
  {
    question: "Where is the retry logic for failed payments?",
    expectedMode: "out_of_scope",
    description: "Code location question",
  },
  {
    question: "How is the invoice total calculated internally?",
    expectedMode: "out_of_scope",
    description: "Internal calculation question",
  },
  {
    question: "Why did this customer's invoice fail?",
    expectedMode: "out_of_scope",
    description: "Customer-specific debugging",
  },
  {
    question: "What's in the cache for this invoice?",
    expectedMode: "out_of_scope",
    description: "Runtime/infra question",
  },
  {
    question: "How does the queue process invoice events?",
    expectedMode: "out_of_scope",
    description: "Queue/infra behavior",
  },
  {
    question: "Why does the sync retry 3 times?",
    expectedMode: "out_of_scope",
    description: "Runtime configuration question",
  },
  {
    question: "What happens when Invoice.markPaid() is called?",
    expectedMode: "out_of_scope",
    description: "Code method behavior",
  },
  {
    question: "This specific invoice looks wrong, why?",
    expectedMode: "out_of_scope",
    description: "Specific customer data question",
    tags: ["customer-specific"],
  },
];

/**
 * Follow-up questions → followup
 * These need thread context to be detected properly
 */
const FOLLOWUP_CASES: GoldenCase[] = [
  {
    question: "What about for enterprise customers?",
    expectedMode: "followup",
    description: "Follow-up with 'what about'",
  },
  {
    question: "And for multi-currency?",
    expectedMode: "followup",
    description: "Follow-up with 'and'",
  },
  {
    question: "How does that work?",
    expectedMode: "followup",
    description: "Follow-up with pronoun 'that'",
  },
  {
    question: "Can it handle that?",
    expectedMode: "followup",
    description: "Short follow-up with 'it'",
  },
  {
    question: "Why?",
    expectedMode: "followup",
    description: "Single word follow-up",
  },
  {
    question: "More details please",
    expectedMode: "followup",
    description: "Short continuation request",
  },
];

/**
 * Ambiguous questions → clarify
 */
const CLARIFY_CASES: GoldenCase[] = [
  {
    question: "Invoice",
    expectedMode: "clarify",
    description: "Single word, no context",
  },
  {
    question: "Help",
    expectedMode: "clarify",
    description: "Single word request",
  },
  {
    question: "??",
    expectedMode: "clarify",
    description: "Just punctuation",
  },
];

// ============================================
// Heuristic Classification Tests
// ============================================

describe("Router Heuristics", () => {
  describe("Capability Questions", () => {
    it.each(CAPABILITY_CASES)(
      "$description: '$question' → $expectedMode",
      ({ question, expectedMode }) => {
        const result = classifyWithHeuristics(question, false);
        // Allow null (needs LLM) or correct mode
        if (result !== null) {
          expect(result.mode).toBe(expectedMode);
        }
      }
    );
  });

  describe("Enablement Questions", () => {
    it.each(ENABLEMENT_CASES)(
      "$description: '$question' → $expectedMode",
      ({ question, expectedMode }) => {
        const result = classifyWithHeuristics(question, false);
        if (result !== null) {
          expect(result.mode).toBe(expectedMode);
        }
      }
    );
  });

  describe("How-To Questions", () => {
    it.each(HOWTO_CASES)(
      "$description: '$question' → $expectedMode",
      ({ question, expectedMode }) => {
        const result = classifyWithHeuristics(question, false);
        if (result !== null) {
          expect(result.mode).toBe(expectedMode);
        }
      }
    );
  });

  describe("Out-of-Scope Questions", () => {
    it.each(OUT_OF_SCOPE_CASES)(
      "$description: '$question' → $expectedMode",
      ({ question, expectedMode }) => {
        const result = classifyWithHeuristics(question, false);
        // Out-of-scope should be detected by heuristics
        if (result !== null) {
          expect(result.mode).toBe(expectedMode);
        }
      }
    );
  });

  describe("Follow-up Questions (with thread history)", () => {
    const mockHistory = [
      { role: "user" as const, content: "What is a contract?", timestamp: "1" },
      { role: "assistant" as const, content: "A contract is...", timestamp: "2" },
    ];

    it.each(FOLLOWUP_CASES)(
      "$description: '$question' → $expectedMode",
      ({ question, expectedMode }) => {
        const result = classifyWithHeuristics(question, true);
        if (result !== null) {
          expect(result.mode).toBe(expectedMode);
        }
      }
    );

    it("should NOT detect follow-up without thread history", () => {
      const result = classifyWithHeuristics("What about that?", false);
      // Without thread history, this should not be classified as follow-up
      if (result !== null) {
        expect(result.mode).not.toBe("followup");
      }
    });
  });

  describe("Ambiguous Questions", () => {
    it.each(CLARIFY_CASES)(
      "$description: '$question' → should be ambiguous",
      ({ question }) => {
        const result = classifyWithHeuristics(question, false);
        // Ambiguous questions should return null (needs LLM) or clarify
        expect(result === null || result.mode === "clarify").toBe(true);
      }
    );
  });
});

// ============================================
// Query Hint Extraction Tests
// ============================================

describe("Query Hint Extraction", () => {
  it("should extract quoted phrases", () => {
    const hints = extractQueryHints('How does "invoice finalization" work?');
    expect(hints).toContain("invoice finalization");
  });

  it("should extract PascalCase identifiers", () => {
    const hints = extractQueryHints("What is the InvoiceService?");
    expect(hints).toContain("InvoiceService");
  });

  it("should extract snake_case identifiers", () => {
    const hints = extractQueryHints("What does invoice_status mean?");
    expect(hints).toContain("invoice_status");
  });

  it("should extract known technical terms", () => {
    const hints = extractQueryHints("How does the Salesforce integration work?");
    expect(hints).toContain("salesforce");
    expect(hints).toContain("integration");
  });

  it("should deduplicate hints", () => {
    const hints = extractQueryHints("Invoice invoice INVOICE");
    const invoiceHints = hints.filter((h) => h.toLowerCase() === "invoice");
    expect(invoiceHints.length).toBe(1);
  });
});

// ============================================
// Pronoun Detection Tests
// ============================================

describe("Pronoun Detection", () => {
  it("should detect 'it'", () => {
    const pronouns = detectPronouns("Can it handle that?");
    expect(pronouns).toContain("it");
  });

  it("should detect 'that'", () => {
    const pronouns = detectPronouns("How does that work?");
    expect(pronouns).toContain("that");
  });

  it("should detect 'they'", () => {
    const pronouns = detectPronouns("What do they do?");
    expect(pronouns).toContain("they");
  });

  it("should detect multiple pronouns", () => {
    const pronouns = detectPronouns("Can it do that for them?");
    expect(pronouns).toContain("it");
    expect(pronouns).toContain("that");
    expect(pronouns).toContain("they");
  });

  it("should return empty for no pronouns", () => {
    const pronouns = detectPronouns("How does the invoice system work?");
    expect(pronouns).toHaveLength(0);
  });
});

// ============================================
// Full Router Tests (with mocked LLM)
// ============================================

describe("Full Router (routeQuestion)", () => {
  // Note: These tests may call LLM for ambiguous cases
  // In CI, mock the LLM or skip these

  describe("High-confidence heuristic cases", () => {
    it("should route capability question correctly", async () => {
      const input: RouterInput = {
        question: "Can Light handle multi-currency invoicing?",
        channelType: "channel",
      };

      const result = await routeQuestion(input);

      expect(result.mode).toBe("capability_docs");
      expect(result.confidence).toMatch(/high|medium/);
    });

    it("should route out-of-scope question correctly", async () => {
      const input: RouterInput = {
        // Use a question with multiple out-of-scope signals
        question: "What happens when payment fails and the retry logic kicks in?",
        channelType: "channel",
      };

      const result = await routeQuestion(input);

      expect(result.mode).toBe("out_of_scope");
    });

    it("should include query hints", async () => {
      const input: RouterInput = {
        question: "How does the Salesforce integration work?",
        channelType: "channel",
      };

      const result = await routeQuestion(input);

      expect(result.queryHints).toContain("salesforce");
      expect(result.queryHints).toContain("integration");
    });

    it("should detect follow-up with thread history", async () => {
      const input: RouterInput = {
        question: "What about for enterprise?",
        channelType: "channel",
        threadHistory: [
          { role: "user", content: "How does billing work?", timestamp: "1" },
          { role: "assistant", content: "Billing in Light works by...", timestamp: "2" },
        ],
      };

      const result = await routeQuestion(input);

      expect(result.mode).toBe("followup");
    });
  });
});

// ============================================
// Edge Cases
// ============================================

describe("Edge Cases", () => {
  it("should handle empty question", () => {
    const result = classifyWithHeuristics("", false);
    expect(result === null || result.mode === "clarify").toBe(true);
  });

  it("should handle very long question", () => {
    const longQuestion = "Can Light " + "handle ".repeat(100) + "multi-currency?";
    const result = classifyWithHeuristics(longQuestion, false);
    // Should still classify based on patterns
    if (result !== null) {
      expect(result.mode).toBe("capability_docs");
    }
  });

  it("should handle question with special characters", () => {
    const result = classifyWithHeuristics("Can Light handle invoices with $$$?", false);
    if (result !== null) {
      expect(result.mode).toBe("capability_docs");
    }
  });

  it("should handle mixed-case questions", () => {
    const result = classifyWithHeuristics("CAN LIGHT SUPPORT MULTI-CURRENCY?", false);
    if (result !== null) {
      expect(result.mode).toBe("capability_docs");
    }
  });

  it("should prioritize out-of-scope over capability for behavior questions", () => {
    // This question mentions capability but asks about behavior
    const result = classifyWithHeuristics(
      "What happens when Light processes a payment?",
      false
    );
    if (result !== null) {
      expect(result.mode).toBe("out_of_scope");
    }
  });
});

// ============================================
// Regression Tests
// ============================================

describe("Regression Tests", () => {
  it("should not classify 'how does X work' as out-of-scope for integrations", () => {
    // Integration questions should be capability, not out-of-scope
    const result = classifyWithHeuristics(
      "How does the Stripe integration work?",
      false
    );
    if (result !== null) {
      // Should be capability (integration overview) not out-of-scope
      expect(result.mode).toBe("capability_docs");
    }
  });

  it("should classify code-specific 'how does' as out-of-scope", () => {
    // But code-specific questions should be out-of-scope
    const result = classifyWithHeuristics(
      "How is the invoice total calculated in the backend?",
      false
    );
    if (result !== null) {
      expect(result.mode).toBe("out_of_scope");
    }
  });
});

// ============================================
// Snapshot Tests for Golden Cases
// ============================================

describe("Golden Case Snapshots", () => {
  const allCases = [
    ...CAPABILITY_CASES,
    ...ENABLEMENT_CASES,
    ...HOWTO_CASES,
    ...OUT_OF_SCOPE_CASES,
  ];

  it("should match golden case expectations", () => {
    const results = allCases.map((c) => {
      const result = classifyWithHeuristics(c.question, false);
      return {
        question: c.question,
        expected: c.expectedMode,
        actual: result?.mode ?? "needs_llm",
        confidence: result?.confidence ?? 0,
        matched: result?.mode === c.expectedMode || result === null,
      };
    });

    // Log failures for debugging
    const failures = results.filter((r) => !r.matched && r.actual !== "needs_llm");
    if (failures.length > 0) {
      console.log("Golden case failures:");
      failures.forEach((f) => {
        console.log(`  "${f.question}": expected ${f.expected}, got ${f.actual}`);
      });
    }

    // Allow some cases to need LLM, but explicit mismatches should fail
    const explicitMismatches = results.filter(
      (r) => r.actual !== "needs_llm" && r.actual !== r.expected
    );
    expect(explicitMismatches).toHaveLength(0);
  });
});
