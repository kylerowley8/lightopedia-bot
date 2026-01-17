# Phase 0 — Audit & Teardown

This document captures what is wrong with the current system and establishes the rebuild contract. No code is written in this phase.

---

## 0.1 What Is WRONG With the Current System

### A. Retrieval is conceptually incorrect

| Problem | Why it matters |
|---------|----------------|
| Embeddings favor prose | Docs always beat Kotlin code in similarity |
| "Code-first" is a score tweak (+0.05) | Not a retrieval strategy, just a band-aid |
| No notion of entrypoints/flows/behavior | Can't answer "what actually happens when X" |
| Symbols extracted but unused | `extractKotlinSymbols()` stores data, retrieval ignores it |

**Verdict**: Current retrieval pipeline cannot reliably answer behavior questions.
→ **Must be replaced, not refactored.**

---

### B. Router logic does not exist

| Problem | Why it matters |
|---------|----------------|
| Single retrieval strategy for all questions | "How does Invoice work" and "Can Light do X" use same pipeline |
| No intent separation | Behavior vs capability vs enablement conflated |
| Clarifying questions = failure mode | Only appears when confidence is low |

**Verdict**: Cannot add conversational UX on top of this.
→ **Router must be introduced as first-class concept.**

---

### C. Slack handling is duplicated and leaky

| Problem | Location |
|---------|----------|
| `app_mention` and `message` handlers duplicated | server.ts:140-245 |
| Thread handling fragile (`botUserId` undefined) | threadHistory.ts:77-80 |
| No attachment support | — |
| No interaction lifecycle (buttons, state) | Buttons exist but no state machine |

**Verdict**: Slack IO must be a thin shell around a single entrypoint.
→ **Deduplicate to one handler function.**

---

### D. "Citation gate" is not actually a gate

| Problem | Why it matters |
|---------|----------------|
| Confidence heuristics stack | `calculateCompositeConfidence()` is multi-factor noise |
| Answers can leak uncited claims | Gate checks bullet count, not claim validity |
| "I don't know" appears wrong | Too often (good content rejected) and wrong (bad reasons) |

**Verdict**: Citation enforcement must be binary and deterministic.
→ **Either every claim cites evidence, or the answer is rejected.**

---

### E. Codebase is too clever, not explicit

| Problem | Example |
|---------|---------|
| Multiple confidence systems | Retrieval confidence, model confidence, composite confidence |
| Implicit fallback behavior | `vectorDegraded` triggers hidden code paths |
| Hard-to-reason control flow | `if/else` chains in retrieve.ts spanning 100+ lines |
| Architecture diagram ≠ reality | README describes ideal, code implements hacks |

**Verdict**: New system must favor boring explicit pipelines over heuristics.
→ **One path per intent. No implicit fallbacks.**

---

## 0.2 DELETE vs KEEP Inventory

### 🔥 DELETE (do not reuse)

These encode the wrong mental model:

| File/Module | Reason |
|-------------|--------|
| `src/retrieval/retrieve.ts` | Hybrid search with score tweaks is the core problem |
| `src/retrieval/rerank.ts` | Threshold-based filtering rejects good results |
| `src/answer/generate.ts` | Confidence stacking, rigid JSON output |
| `src/slack/threadHistory.ts` | Fragile botUserId detection |
| `applySourceTypeBoost()` | Band-aid, not strategy |
| `calculateCompositeConfidence()` | Heuristic soup |
| `generateClarifyingOptions()` | Failure-mode-only design |

### ♻️ KEEP (as references or utilities)

Safe to reuse selectively:

| File/Module | What to keep |
|-------------|--------------|
| `src/db/supabase.ts` | Client setup |
| `src/config/env.ts` | Zod validation pattern |
| `src/lib/logger.ts` | Structured logging |
| `src/slack/renderAnswer.ts` | Block Kit helpers (not flow logic) |
| `src/indexer/chunker.ts` | File walking, storage (chunk semantics must change) |
| `src/retrieval/embeddings.ts` | OpenAI embedding call (not search logic) |

**Rule**: Copy concepts, not implementations.

---

## 0.3 Rebuild Order (Strict Sequence)

Claude must follow this order. No skipping.

```
1. Delete / ignore old retrieval pipeline
   └─ Do not import from retrieve.ts, rerank.ts, generate.ts

2. Define new contracts first
   └─ Types: Intent, Evidence, GroundedAnswer
   └─ Modes: behavior | capability | enablement
   └─ Explicit state machines, not implicit fallbacks

3. Implement router
   └─ Classify question intent BEFORE retrieval
   └─ Router decides which retrieval strategy runs

4. Implement behavior_code_first retrieval
   └─ For "what happens when X" questions
   └─ Read Kotlin files directly, not just chunks
   └─ Follow call chains, find entrypoints

5. Implement grounding + citation gate
   └─ Binary: cited or rejected
   └─ No confidence heuristics
   └─ Every claim must link to evidence

6. Implement non-technical renderer
   └─ Output for sales/RevOps, not engineers
   └─ Markdown, not code blocks
   └─ Sources as footnotes, not inline

7. Add Slack interactivity
   └─ Buttons with state
   └─ Trace IDs for debugging
   └─ Attachment support

8. Add enablement/onboarding polish
   └─ Only after core pipeline is solid
```

**Guardrails**:
- If Claude tries to "wire Slack first" → stop
- If Claude tries to "reuse retrieval" → stop
- If Claude adds confidence heuristics → stop

---

## 0.4 New Architecture Principles

### Mindset
> "We are rebuilding Lightopedia as an internal product, not patching a prototype."

### Principles

| Principle | Meaning |
|-----------|---------|
| Clarity over cleverness | No "smart" fallbacks. Explicit paths only. |
| Determinism over heuristics | Same input → same output. No score stacking. |
| Explicit flows over generalized pipelines | Router picks a strategy. Strategy runs to completion. |
| Evidence-first | No claim without citation. No citation without source. |
| Code as truth | Kotlin backend is authoritative. Docs are supplementary. |

---

## 0.5 New Contracts (To Be Defined)

These will be defined in Phase 1 before any implementation:

### Intent Types
```typescript
type Intent =
  | { type: "behavior"; entity: string; action?: string }  // "what happens when X"
  | { type: "capability"; feature: string }                 // "can Light do X"
  | { type: "enablement"; workflow: string }                // "how do I configure X"
  | { type: "clarify"; options: string[] }                  // ambiguous, need more info
  | { type: "unknown" };                                    // cannot classify
```

### Evidence Types
```typescript
type Evidence =
  | { type: "code"; file: string; lines: [number, number]; content: string }
  | { type: "docs"; source: string; section: string; content: string };
```

### Grounded Answer
```typescript
type GroundedAnswer = {
  summary: string;
  claims: Array<{
    text: string;
    evidence: Evidence[];  // Must be non-empty
  }>;
  confidence: "grounded" | "partial" | "ungrounded";
};
```

### Citation Gate
```typescript
function citationGate(answer: GroundedAnswer): boolean {
  // Binary: either all claims have evidence, or reject
  return answer.claims.every(c => c.evidence.length > 0);
}
```

---

## 0.6 Phase Sequence

```
Phase 0 — Audit & Teardown (this document)
    ↓
Phase 1 — Contracts & Types (define, no implementation)
    ↓
Phase 2 — Router Implementation
    ↓
Phase 3 — Code-First Retrieval (behavior questions)
    ↓
Phase 4 — Grounding & Citation Gate
    ↓
Phase 5 — Renderer & Slack Shell
    ↓
Phase 6 — Polish & Enablement
```

---

## 0.7 Success Criteria

The rewrite is successful when:

1. **"What happens when an invoice is marked paid?"** → Returns Kotlin code path, not docs
2. **Thread follow-ups work reliably** → Context preserved, pronouns resolved
3. **No "I don't know" for indexed content** → If it's in the code, we find it
4. **Every claim is cited** → No exceptions, no heuristics
5. **Slack is a thin shell** → All logic in core pipeline, Slack just renders

---

*Phase 0 complete. Ready for Phase 1: Contracts & Types.*
