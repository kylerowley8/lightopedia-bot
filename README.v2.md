# Lightopedia V2

Internal Q&A bot for the Light platform. Answers sales and enablement questions using docs-first evidence.

## What It Does

Lightopedia answers questions about Light for sales, CS, and RevOps teams by:

1. **Routing** — Classifies questions into modes (capability, enablement, how-to, etc.)
2. **Retrieving** — Searches indexed docs and curated Slack threads
3. **Synthesizing** — Uses LLM to explain evidence in customer-ready language
4. **Grounding** — Ensures every claim is cited (binary citation gate)
5. **Rendering** — Formats for Slack with "Show technical details" option

## V1 Scope

### In Scope
- "Can Light do X?" capability questions
- Conceptual models (contracts, AR, ledger, workflows)
- Integration patterns (Salesforce, Stripe, banking)
- How-to guides for configuration

### Out of Scope
- Deep code tracing ("what happens when X is called")
- Runtime behavior (queues, retries, caches)
- Customer-specific data

## Architecture

```
User Question (Slack)
       ↓
┌──────────────────┐
│  Router          │  ← Policy selector (never answers)
│  - Heuristics    │
│  - LLM fallback  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Retrieval       │  ← Docs-first (V1)
│  - Docs          │
│  - Slack threads │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Synthesis       │  ← LLM explains evidence
│  - GPT-4o        │
│  - Structured    │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Citation Gate   │  ← Binary: cited or rejected
│  - No heuristics │
│  - Drop uncited  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Slack Render    │  ← Non-technical by default
│  - Summary       │
│  - Actions       │
└──────────────────┘
```

## Modes

| Mode | Description | Example |
|------|-------------|---------|
| `capability_docs` | What Light can/cannot do | "Does Light support X?" |
| `enablement_sales` | How to position Light | "How do I explain X?" |
| `onboarding_howto` | Configuration guides | "How do I set up X?" |
| `followup` | Thread continuation | "What about Y?" |
| `clarify` | Need more context | (ambiguous questions) |
| `out_of_scope` | Code/runtime details | "What happens when X?" |

## Confidence Levels

| Level | Meaning |
|-------|---------|
| `confirmed_implementation` | Grounded in repo docs |
| `confirmed_docs` | Grounded in Slack threads |
| `needs_clarification` | Insufficient evidence |

## Response Format

### Non-Technical (Default)
```
[Customer-ready answer]
• Supporting point [1]
• Another point [2]

Confirmed from docs | Sources: docs/billing.md, docs/api.md

[Show technical details] [✓ Helpful] [✗ Not helpful]
```

### Technical (Opt-in)
After clicking "Show technical details":
- Full citations with file paths
- Similarity scores
- Retrieval metadata

## Folder Structure

```
src/
  app/
    handleSlackQuestion.ts   # Single entrypoint
    pipeline.ts              # Orchestration
    types.ts                 # IO types
  router/
    routeQuestion.ts         # Policy selector
    heuristics.ts            # Deterministic classification
    types.ts                 # Mode definitions
  retrieval/
    docsRetrieval.ts         # Docs-first search
    embeddings.ts            # OpenAI embeddings
  evidence/
    types.ts                 # Evidence contracts
    buildEvidencePack.ts     # Evidence assembly
  grounding/
    citationGate.ts          # Binary citation enforcement
  llm/
    client.ts                # OpenAI wrapper
    prompts.ts               # All prompts
    synthesize.ts            # Answer generation
  slack/
    renderNonTechnical.ts    # Default output
    renderTechnical.ts       # Detailed output
    actions.ts               # Button handlers
```

## Rules

### Router
- Chooses which program to run
- NEVER answers questions
- NEVER reads code
- Uses heuristics first, LLM only if ambiguous

### Retrieval
- Deterministic (same input → same output)
- Docs-first for V1
- Pinned embedding model version

### Citation Gate
- Binary: every functional claim needs citation
- No confidence heuristics
- Drop uncited claims, don't downgrade

### Output
- Non-technical by default
- No code, file names, or jargon in main response
- Technical details are opt-in

## Versioning

```
ROUTER_VERSION = "router.v1.0"
RETRIEVAL_VERSION = "retrieval.v1.0"
PIPELINE_VERSION = "pipeline.v1.0"
```

Each version is logged with every request for replay capability.

## Feedback Loop

Slack reactions for feedback:
- ✅ Helpful
- ⚠️ Incorrect
- ❓ Needs more context

Stored to `feedback` table for analysis.

## How to Ask Good Questions

| Good | Why |
|------|-----|
| "Does Light support multi-currency invoicing?" | Clear capability question |
| "How should I explain the ledger to a controller?" | Clear enablement question |
| "How do I configure Salesforce sync?" | Clear how-to question |

| Avoid | Why |
|-------|-----|
| "How does the invoice flow work?" | Too implementation-focused (out of scope V1) |
| "Why did customer X's invoice fail?" | Requires customer data |
| "Invoice" | Too vague |

## Development

```bash
# Install dependencies
npm install

# Run V2 server
npx tsx src/server.v2.ts

# Type check
npx tsc --noEmit
```

## Environment Variables

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=sk-...
```

## Migration from V1

V2 is a rewrite, not a refactor. Key changes:

1. **Router-first** — Mode selection before retrieval
2. **Docs-first** — No code tracing in V1
3. **Binary citation gate** — No confidence heuristics
4. **Single entrypoint** — No duplicated Slack handlers
5. **Versioned everything** — Replay capability

---

*Lightopedia V2 — Built for sales, grounded in docs.*
