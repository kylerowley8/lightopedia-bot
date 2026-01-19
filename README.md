# Lightopedia

Internal Q&A bot for the Light platform. Answers sales, CS, and RevOps questions using a docs-first, code-grounded approach.

## What It Does

Lightopedia helps teams get accurate, defensible answers about Light by:

1. **Routing** - Classifies questions into modes (capability, enablement, how-to, etc.)
2. **Retrieving** - Searches indexed code, docs, and curated Slack threads
3. **Synthesizing** - Uses LLM to explain evidence in customer-ready language
4. **Grounding** - Ensures every claim is cited (binary citation gate)
5. **Rendering** - Formats for Slack with "Show technical details" option

## Source Hierarchy (V3)

```
1. CODE (Kotlin, TypeScript)     → Ground Truth for implementation
2. DOCS (Markdown)               → Customer commitments & guarantees
3. SLACK (Curated threads)       → Internal guidance & edge cases
```

**Rule:** Code wins for "how does X work?" questions. Docs win for "can Light do X?" questions.

## Version History

### V3 (Current)
- **Code indexing** - Kotlin (.kt, .kts) and TypeScript (.ts, .tsx) files indexed
- **Function/class chunking** - Code split by semantic boundaries, not character count
- **Symbol extraction** - Class names, function names tracked for better retrieval
- **Forbidden phrases** - Auto-replacement of over-promising language ("seamlessly" → "is designed to")
- **Sales-safe guardrails** - Responses are non-promissory and defensible

### V2
- **Slack KB** - Curated #lightopedia threads indexed
- **Linear fallback** - Graceful handling when docs don't have answers
- **Router-based architecture** - Clean separation of routing, retrieval, synthesis

### V1
- **Docs-only** - Markdown documentation indexed
- **Binary citation gate** - Every claim must be grounded
- **Non-technical by default** - Customer-ready language

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
│  Retrieval       │  ← Code > Docs > Slack
│  - Code chunks   │
│  - Doc chunks    │
│  - Slack threads │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Synthesis       │  ← LLM explains evidence
│  - GPT-4o        │
│  - V3 guardrails │
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
| `out_of_scope` | Customer-specific data | "Why did invoice X fail?" |

## V3 Output Format

Responses follow a structured format:

```json
{
  "shortAnswer": "Direct answer with appropriate framing",
  "conceptualModel": "How Light models/thinks about this",
  "howItWorks": ["Step 1", "Step 2", "Step 3"],
  "boundaries": {
    "whatLightDoes": ["capability 1", "capability 2"],
    "whatLightDoesNot": ["external system X", "manual step Y"]
  },
  "salesSummary": "Reusable line for customer conversations",
  "citations": ["1", "2"]
}
```

## Allowed vs Forbidden Language

### Allowed (Use These)
- "Light models this as..."
- "Light supports this workflow by..."
- "Light is designed to handle..."
- "This is represented at the AR / contract / ledger layer"

### Forbidden (Never Say Unless Docs Explicitly Support)
- "Light automatically does X"
- "Out of the box"
- "No setup required"
- "Seamlessly"
- "Effortlessly"

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
    docsRetrieval.ts         # Code > Docs > Slack search
    embeddings.ts            # OpenAI embeddings
  evidence/
    types.ts                 # Evidence contracts (CodeChunk, DocChunk, etc.)
    buildEvidencePack.ts     # Evidence assembly with hierarchy
  grounding/
    citationGate.ts          # Binary citation enforcement
    forbiddenPhrases.ts      # V3 guardrails
  indexer/
    index.ts                 # Routing between code/doc indexers
    codeIndexer.ts           # Kotlin/TypeScript indexing
    config.ts                # File patterns and config
  llm/
    client.ts                # OpenAI wrapper
    prompts.ts               # All prompts with V3 hierarchy
    synthesize.ts            # Answer generation
  slack/
    renderNonTechnical.ts    # Default output
    renderTechnical.ts       # Detailed output
    actions.ts               # Button handlers
  scripts/
    reindexRepo.ts           # Re-index a GitHub repo
    checkDocsTable.ts        # Database inspection
```

## Database Schema

### `docs` table
Stores all indexed content (code, docs, Slack):

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `content` | Chunk text |
| `embedding` | Vector (1536 dimensions) |
| `metadata` | JSON with source_type, repo_slug, path, symbols, etc. |

### `slack_threads` table
Curated Slack thread summaries:

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `topic` | Thread topic |
| `content` | Summarized content |
| `embedding` | Vector |

## Indexing

### Index a Repository

```bash
# Index a single repo
npx tsx src/scripts/reindexRepo.ts light-space/light

# Index multiple repos
npx tsx src/scripts/reindexRepo.ts light-space/axolotl
npx tsx src/scripts/reindexRepo.ts light-space/mobile-app
```

### Check Index Status

```bash
npx tsx src/scripts/checkDocsTable.ts
```

### Current Index Stats

| Source | Chunks |
|--------|--------|
| Code (Kotlin/TS) | 22,965 |
| Docs (Markdown) | 854 |
| Slack threads | 100 |
| **Total** | **23,919** |

## Development

```bash
# Install dependencies
npm install

# Run server
npx tsx src/server.v2.ts

# Type check
npx tsc --noEmit

# Build
npm run build
```

## Environment Variables

```env
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Supabase
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...

# OpenAI
OPENAI_API_KEY=sk-...

# GitHub App (for code indexing)
GITHUB_APP_ID=...
GITHUB_PRIVATE_KEY=...
```

## How to Ask Good Questions

| Good | Why |
|------|-----|
| "Does Light support multi-currency invoicing?" | Clear capability question |
| "How should I explain the ledger to a controller?" | Clear enablement question |
| "How do I configure Salesforce sync?" | Clear how-to question |
| "How does Light model deferred revenue?" | Clear implementation question (V3) |

| Avoid | Why |
|-------|-----|
| "Why did customer X's invoice fail?" | Requires customer data |
| "Invoice" | Too vague |

## Versioning

```
ROUTER_VERSION = "router.v1.0"
RETRIEVAL_VERSION = "retrieval.v1.0"
PIPELINE_VERSION = "pipeline.v1.0"
```

Each version is logged with every request for replay capability.

---

*Lightopedia V3 - Code-grounded, sales-safe, non-promissory.*
