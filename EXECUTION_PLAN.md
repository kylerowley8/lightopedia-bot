# Lightopedia v2 — Execution Plan

## Non-Negotiable Principles

| Principle | Meaning |
|-----------|---------|
| **Router is policy selector** | Chooses which program to run. Never answers. Never reads code. |
| **Behavior = code-first** | "What happens when X" → read backend code. Docs are fallback. |
| **Non-technical by default** | Every Slack response safe for sales/CS. No code, no jargon. |
| **Technical is opt-in** | "Show technical details" button. Traces inside technical view only. |
| **No ungrounded functional claims** | "does", "happens", "writes" → must cite evidence. |
| **Deterministic retrieval** | Search & ranking = deterministic. LLM only explains evidence. |

---

## System Contracts

```typescript
// Modes (router output)
type Mode =
  | "behavior_code_first"
  | "capability_docs"
  | "enablement_sales"
  | "onboarding_howto"
  | "followup"
  | "clarify";

// Router output (strict JSON, no prose)
type RouteDecision = {
  mode: Mode;
  confidence: "high" | "medium" | "low";
  queryHints: string[];
  missingInfo?: string[];
};

// Evidence types
type CodeUnit = {
  path: string;
  symbol: string;
  kind: "api" | "service" | "domain" | "other";
  language: string;
  repo: string;
  lines: [number, number];
  content: string;
  summary?: string;  // LLM-generated, for retrieval only, never cited
};

type DocChunk = {
  source: string;
  section: string;
  content: string;
};

type AttachmentEvidence = {
  type: "image" | "log" | "pdf";
  extractedText: string;
  identifiers: string[];
};

type EvidencePack = {
  codeUnits: CodeUnit[];
  docs?: DocChunk[];
  apiDocs?: DocChunk[];
  attachments?: AttachmentEvidence[];
  ambiguity?: {
    apiEntrypoints: CodeUnit[];
    domainEntrypoints: CodeUnit[];
  };
};

// Grounded answer
type GroundedClaim = {
  text: string;
  citations: Array<{ type: "code" | "docs"; ref: string }>;
};

type GroundedAnswer = {
  summary: string;
  claims: GroundedClaim[];
  confidence: "confirmed_implementation" | "confirmed_docs" | "needs_clarification";
  hasAmbiguity: boolean;
};
```

---

## Folder Structure

```
src/
  app/
    handleSlackQuestion.ts       # single entrypoint
    pipeline.ts                  # orchestration only
  router/
    routeQuestion.ts             # policy selector
    heuristics.ts                # deterministic classification
  retrieval/
    behaviorCodeFirst.ts         # code-first for behavior questions
    capabilityDocs.ts            # docs-first for capability questions
    enablement.ts                # sales enablement retrieval
    followup.ts                  # thread context handling
  evidence/
    types.ts                     # EvidencePack, CodeUnit, etc.
    buildEvidencePack.ts         # assemble evidence from retrieval
  grounding/
    citationGate.ts              # binary: cited or rejected
  llm/
    client.ts                    # OpenAI client
    prompts.ts                   # all prompts in one place
  slack/
    renderNonTechnical.ts        # customer-ready format
    renderTechnical.ts           # engineer view with citations
    actions.ts                   # button handlers
  attachments/
    extractText.ts               # image/PDF/log extraction
  indexer/
    codeIndexer.ts               # backend code indexing
    docsIndexer.ts               # documentation indexing
  db/
    supabase.ts                  # database client (reuse)
  config/
    env.ts                       # environment validation (reuse)
  lib/
    logger.ts                    # structured logging (reuse)
tests/
  router.test.ts
  retrieval.test.ts
  grounding.test.ts
  golden.test.ts
```

**Rules**:
- No Slack logic inside retrieval
- No retrieval logic inside Slack handlers
- No LLM calls outside `llm/`

---

## Pipeline

```typescript
async function handleSlackQuestion(input: SlackInput): Promise<SlackResponse> {
  // 1. Preprocess (thread + attachments)
  const context = await preprocess(input);

  // 2. Route (policy selection, not answering)
  const route = await routeQuestion(context);

  // 3. Retrieve (deterministic, mode-specific)
  const evidence = await retrieve(route, context);

  // 4. Synthesize (LLM explains evidence)
  const draft = await synthesize(evidence, route);

  // 5. Ground (binary citation gate)
  const grounded = citationGate(draft, evidence);

  // 6. Render (non-technical by default)
  return renderSlackResponse(grounded, route);
}
```

Each step is pure and testable.

---

## Router

### Responsibilities
- Choose mode
- Provide query hints
- Detect ambiguity
- Ask for clarification when needed

### Implementation Rules
- Use heuristics first
- Only call LLM if ambiguous
- Never output prose answers

### Heuristics

| Mode | Signals |
|------|---------|
| `behavior_code_first` | "what happens when", "where is", "why did", "error", "retry", "flow", "calculate" |
| `capability_docs` | "can Light", "does Light support", "is it possible" |
| `enablement_sales` | "how should I explain", "what should I say", "pitch", "positioning" |
| `followup` | short message, pronouns ("it", "that"), "what about" |
| `clarify` | ambiguous, multiple intents, missing info |

---

## Code-First Retrieval

### Indexing Requirements
- Index at function/class level (not arbitrary chunks)
- Stable spans for citation
- Metadata: path, symbol, kind, language, repo
- Optional: LLM-generated summaries (retrieval only, never cited)

### Behavior Retrieval Program (Deterministic)

```
1. Symbol / lexical search (exact > partial)
2. Path-based boosts
3. Optional semantic search over summaries
4. Reference expansion (callers / callees)
5. Build EvidencePack
```

---

## Ambiguity Handling

### Deterministic Condition
Show trace buttons if:
- ≥2 plausible entrypoints with close scores, OR
- Both API + domain entrypoints found but no clear call chain

### Slack Behavior

**Default response**:
- Short non-technical answer
- "Show technical details" button

**Technical view** (after button click):
- Explanation + citations
- If ambiguous, show:
  - "Trace from API endpoint"
  - "Trace from domain service"

Each button reruns same retrieval with different entrypoint bias. No new reasoning.

---

## Response Formats

### Non-Technical (Default)

```
[Customer-ready answer: 1-3 sentences]

[Internal notes / next steps]

[Confidence + source]
• Confirmed from implementation
• Confirmed from docs
• Needs clarification

[Actions]
• Show technical details
```

No code. No file names. No jargon.

### Technical (Opt-in)

Shown after button click or `tech:` prefix.

Includes:
- Evidence-based explanation
- Citations with file paths
- Trace buttons (if ambiguous)

---

## Grounding & Safety

### Citation Rules
- Any functional claim → must have citation
- Invalid citation → drop sentence or ask question
- No "best effort" answers

### Sales-Safe Language
- Capability claims require docs/API evidence
- Code evidence alone → phrase as: "Based on current implementation…"

---

## DO NOT DO List

| ❌ | Why |
|----|-----|
| Let router answer questions | Router is policy selector only |
| Let LLM read raw repos directly | Must go through indexed code units |
| Dump code in shared channels | Non-technical by default |
| Infer user roles from Slack | No implicit role detection |
| Invent roadmap or future features | Only what exists today |
| Weaken the citation gate | Binary: cited or rejected |

---

## Required Tests

1. **Router classification** — golden set of questions → correct modes
2. **Behavior answers cite code** — behavior questions always return code citations
3. **Capability answers don't invent** — capability questions never add features
4. **Ambiguous flows trigger buttons** — multiple entrypoints → trace buttons
5. **Attachments improve retrieval** — screenshots/logs extract identifiers
6. **Citation gate drops unsupported claims** — ungrounded sentences removed

---

## Success Criteria

| Criterion | How to verify |
|-----------|---------------|
| Sales can copy answers to customers | No jargon, no code in default view |
| Engineers trust technical view | Citations link to actual code |
| Ambiguous questions → buttons, not guesses | Trace buttons appear, not invented answers |
| Behavior answers are boringly correct | What the code does, nothing more |
| Codebase is understandable in one read | Clear folder structure, explicit flows |

---

## Execution Order

```
Phase 1 — Contracts & Types
    └─ src/evidence/types.ts
    └─ src/router/types.ts

Phase 2 — Router
    └─ src/router/heuristics.ts
    └─ src/router/routeQuestion.ts

Phase 3 — Code-First Retrieval
    └─ src/retrieval/behaviorCodeFirst.ts
    └─ src/evidence/buildEvidencePack.ts

Phase 4 — Grounding
    └─ src/grounding/citationGate.ts

Phase 5 — LLM Synthesis
    └─ src/llm/client.ts
    └─ src/llm/prompts.ts

Phase 6 — Slack Shell
    └─ src/slack/renderNonTechnical.ts
    └─ src/slack/renderTechnical.ts
    └─ src/app/handleSlackQuestion.ts
    └─ src/app/pipeline.ts

Phase 7 — Tests & Polish
    └─ tests/
    └─ README.md
```

---

*Plan locked. Ready for Phase 1: Contracts & Types.*
