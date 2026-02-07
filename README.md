# Lightopedia

Internal Q&A bot for the Light platform. Answers sales, CS, and RevOps questions using help articles as the single source of truth.

## What It Does

Lightopedia answers questions about Light by:

1. **Routing** — Classifies questions into modes (capability, enablement, how-to, etc.)
2. **Retrieving** — Searches indexed help articles via vector + keyword search
3. **Synthesizing** — Uses LLM to explain evidence in customer-ready language
4. **Grounding** — Ensures every functional claim is backed by article evidence
5. **Rendering** — Formats for Slack with feedback buttons

## Knowledge Source

Help articles from `light-space/help-articles` are the single source of truth. If the articles don't cover a topic, Lightopedia says so honestly.

## Architecture

```
User Question (Slack / API)
       ↓
┌──────────────────┐
│  Router          │  ← Policy selector (never answers)
│  - Heuristics    │
│  - LLM fallback  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Retrieval       │  ← Help articles only
│  - Vector search │
│  - Keyword search│
│  - Reranking     │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Synthesis       │  ← LLM explains evidence
│  - GPT-4o        │
│  - Guardrails    │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Citation Gate   │  ← Functional claims need evidence
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Slack Render    │  ← Non-technical, customer-ready
│  - Summary       │
│  - Feedback      │
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
    search.ts                # Vector + keyword search
    keywordSearch.ts          # Keyword search
    rerank.ts                # LLM reranking
    embeddings.ts            # OpenAI embeddings
  evidence/
    types.ts                 # Evidence contracts (Article, EvidencePack, etc.)
    buildEvidencePack.ts     # Evidence assembly
  grounding/
    citationGate.ts          # Citation enforcement
    forbiddenPhrases.ts      # Language guardrails
  indexer/
    index.ts                 # Doc indexing entrypoint
    docsIndexer.ts           # Help article indexing
    chunker.ts               # Document chunking
    config.ts                # Allowed repos, file patterns
  llm/
    client.ts                # OpenAI wrapper
    prompts.ts               # System prompts
    synthesize.ts            # Answer generation
    routerLLM.ts             # LLM-based routing
  slack/
    renderNonTechnical.ts    # Slack output formatting
    actions.ts               # Button handlers
  github/
    webhook.ts               # Auto-reindex on push
  server.ts                  # Express + Slack Bolt server
```

## Database Schema

### `docs` table
Stores indexed help article chunks:

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `content` | Chunk text |
| `embedding` | Vector (1536 dimensions) |
| `metadata` | JSON with repo_slug, path, title, section, etc. |

## Indexing

```bash
# Index help articles
npx tsx src/scripts/reindexRepo.ts light-space/help-articles main

# Check index status
npx tsx src/scripts/checkDocsTable.ts
```

GitHub webhook auto-reindexes on push to `light-space/help-articles` main branch.

## Development

```bash
# Install dependencies
npm install

# Run server
npm run dev

# Type check
npx tsc --noEmit

# Run tests
npm test

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

# GitHub App (for webhook auto-reindex)
GITHUB_APP_ID=...
GITHUB_PRIVATE_KEY=...
```

## How to Ask Good Questions

| Good | Why |
|------|-----|
| "Does Light support multi-currency invoicing?" | Clear capability question |
| "How should I explain the ledger to a controller?" | Clear enablement question |
| "How do I configure Salesforce sync?" | Clear how-to question |

| Avoid | Why |
|-------|-----|
| "Why did customer X's invoice fail?" | Requires customer data |
| "Invoice" | Too vague |

## Versioning

```
ROUTER_VERSION = "router.v1.0"
RETRIEVAL_VERSION = "retrieval.v2.0"
PIPELINE_VERSION = "pipeline.v2.0"
```

Each version is logged with every request for replay capability.
