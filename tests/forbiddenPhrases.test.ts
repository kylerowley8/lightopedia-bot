// ============================================
// Tests for Forbidden Phrases Guardrail
// ============================================

import { describe, it, expect } from "vitest";
import {
  checkForbiddenPhrases,
  FORBIDDEN_PHRASES,
} from "../src/grounding/forbiddenPhrases.js";

// ============================================
// FORBIDDEN_PHRASES array
// ============================================

describe("FORBIDDEN_PHRASES", () => {
  it("includes expected values", () => {
    expect(FORBIDDEN_PHRASES).toContain("automatically");
    expect(FORBIDDEN_PHRASES).toContain("out of the box");
    expect(FORBIDDEN_PHRASES).toContain("seamlessly");
    expect(FORBIDDEN_PHRASES).toContain("effortlessly");
    expect(FORBIDDEN_PHRASES).toContain("guaranteed");
    expect(FORBIDDEN_PHRASES).toContain("no setup required");
    expect(FORBIDDEN_PHRASES).toContain("fully handles");
    expect(FORBIDDEN_PHRASES).toContain("zero configuration");
    expect(FORBIDDEN_PHRASES).toContain("handles all cases");
  });

  it("is a non-empty array", () => {
    expect(Array.isArray(FORBIDDEN_PHRASES)).toBe(true);
    expect(FORBIDDEN_PHRASES.length).toBeGreaterThan(0);
  });

  it('includes "out-of-the-box" hyphenated variant', () => {
    expect(FORBIDDEN_PHRASES).toContain("out-of-the-box");
  });

  it('includes "seamless" (adjective form)', () => {
    expect(FORBIDDEN_PHRASES).toContain("seamless");
  });

  it('includes "effortless" (adjective form)', () => {
    expect(FORBIDDEN_PHRASES).toContain("effortless");
  });
});

// ============================================
// checkForbiddenPhrases
// ============================================

describe("checkForbiddenPhrases", () => {
  it("returns hasForbidden=false for clean text", () => {
    const result = checkForbiddenPhrases(
      "Light supports this workflow by using invoicing"
    );
    expect(result.hasForbidden).toBe(false);
  });

  it("returns empty found array for clean text", () => {
    const result = checkForbiddenPhrases(
      "Light supports this workflow by using invoicing"
    );
    expect(result.found).toEqual([]);
  });

  it("does not include cleanedText for clean text", () => {
    const result = checkForbiddenPhrases(
      "Light is designed to handle billing workflows"
    );
    expect(result.hasForbidden).toBe(false);
    expect(result.cleanedText).toBeUndefined();
  });

  it('returns hasForbidden=true for "Light automatically handles invoicing"', () => {
    const result = checkForbiddenPhrases(
      "Light automatically handles invoicing"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("automatically");
  });

  it('returns hasForbidden=true for "This works out of the box"', () => {
    const result = checkForbiddenPhrases("This works out of the box");
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("out of the box");
  });

  it('returns hasForbidden=true for "It seamlessly integrates with Salesforce"', () => {
    const result = checkForbiddenPhrases(
      "It seamlessly integrates with Salesforce"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("seamlessly");
  });

  it('replaces "automatically" with "is designed to" in cleaned text', () => {
    const result = checkForbiddenPhrases(
      "Light automatically handles invoicing"
    );
    expect(result.cleanedText).toBeDefined();
    expect(result.cleanedText).toContain("is designed to");
    expect(result.cleanedText).not.toMatch(/automatically/i);
  });

  it('replaces "out of the box" with "with configuration" in cleaned text', () => {
    const result = checkForbiddenPhrases(
      "This works out of the box for all customers"
    );
    expect(result.cleanedText).toBeDefined();
    expect(result.cleanedText).toContain("with configuration");
    expect(result.cleanedText!.toLowerCase()).not.toContain(
      "out of the box"
    );
  });

  it('replaces "seamlessly" with "with proper integration" in cleaned text', () => {
    const result = checkForbiddenPhrases(
      "It seamlessly integrates with Salesforce"
    );
    expect(result.cleanedText).toBeDefined();
    expect(result.cleanedText).toContain("with proper integration");
    expect(result.cleanedText!.toLowerCase()).not.toContain(
      "seamlessly"
    );
  });

  it("handles case insensitivity: AUTOMATICALLY is detected", () => {
    const result = checkForbiddenPhrases(
      "Light AUTOMATICALLY syncs data"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("automatically");
  });

  it("handles case insensitivity: Seamlessly is detected", () => {
    const result = checkForbiddenPhrases(
      "It Seamlessly connects to external systems"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("seamlessly");
  });

  it("handles mixed case in cleaned text replacement", () => {
    const result = checkForbiddenPhrases(
      "Light AUTOMATICALLY handles billing"
    );
    expect(result.cleanedText).toBeDefined();
    // The regex replacement with "gi" flag should replace regardless of case
    expect(result.cleanedText!.toLowerCase()).not.toContain(
      "automatically"
    );
    expect(result.cleanedText).toContain("is designed to");
  });

  it("detects multiple forbidden phrases in one text", () => {
    const result = checkForbiddenPhrases(
      "Light automatically handles invoicing seamlessly with no setup required"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("automatically");
    expect(result.found).toContain("seamlessly");
    expect(result.found).toContain("no setup required");
    expect(result.found.length).toBeGreaterThanOrEqual(3);
  });

  it("cleans text with multiple forbidden phrases replaced", () => {
    const result = checkForbiddenPhrases(
      "Light automatically handles invoicing seamlessly"
    );
    expect(result.cleanedText).toBeDefined();
    expect(result.cleanedText!.toLowerCase()).not.toContain(
      "automatically"
    );
    expect(result.cleanedText!.toLowerCase()).not.toContain(
      "seamlessly"
    );
  });

  it('detects "guaranteed" as forbidden', () => {
    const result = checkForbiddenPhrases(
      "This outcome is guaranteed by the platform"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("guaranteed");
  });

  it('detects "zero configuration" as forbidden', () => {
    const result = checkForbiddenPhrases(
      "It requires zero configuration to get started"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("zero configuration");
  });

  it('detects "handles all cases" as forbidden', () => {
    const result = checkForbiddenPhrases(
      "Light handles all cases of multi-currency billing"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("handles all cases");
  });

  it('detects "effortlessly" as forbidden', () => {
    const result = checkForbiddenPhrases(
      "Teams can effortlessly manage subscriptions"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("effortlessly");
  });

  it('detects "fully automated" as forbidden', () => {
    const result = checkForbiddenPhrases(
      "The billing cycle is fully automated"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.found).toContain("fully automated");
  });

  it("uses fallback replacement when no safe alternative exists", () => {
    // Phrases like "self-serve without support", "always works", "never fails"
    // don't have explicit entries in SAFE_ALTERNATIVES, so they use "supports"
    const result = checkForbiddenPhrases(
      "The system never fails during sync"
    );
    expect(result.hasForbidden).toBe(true);
    expect(result.cleanedText).toBeDefined();
    // The fallback is "supports"
    expect(result.cleanedText).toContain("supports");
  });
});
