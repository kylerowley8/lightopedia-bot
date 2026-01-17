# Lightopedia V1 — Scope Boundary

## V1 Goal

Lightopedia answers **sales + enablement questions** using **docs-first evidence** from:
- Product docs / READMEs / in-repo docs
- Curated #lightopedia Slack threads (secondary)

---

## In Scope (V1)

| Category | What's Covered |
|----------|----------------|
| Capability questions | "Can Light do X?" with integration framing |
| Conceptual models | Contracts, AR, ledger, workflows — **only when backed by docs** |
| Integration patterns | Salesforce/Stripe/banking — **only when backed by docs** |
| Citations | Repo/path/thread permalink to verify |

## Out of Scope (V1)

| Category | Why |
|----------|-----|
| Deep behavior tracing | Requires multi-service code reading |
| Runtime-flag behavior | Unless explicitly documented |
| Infra behaviors | Queues/retries/caches — unless documented |
| Customer-specific data | "Why did this invoice look like this?" — needs customer data |

**Policy**: If not supported by evidence → clarifying question OR "missing context" fallback + optional Linear feature request.

---

## Indexing Lifecycle

### What We Index (V1)

**Docs-first allowlist:**
```
README.md
docs/**
*.md
*.mdx
config/ docs (not executable code)
```

**Slack:**
- Threads in #lightopedia only

**Explicit denylist:**
```
dist/
build/
.next/
coverage/
node_modules/
*.lock
*.min.js
generated artifacts
```

### When Indexing Runs

| Trigger | When |
|---------|------|
| Primary | GitHub App webhook on push to main |
| Secondary | Nightly backfill reindex (heals missed webhooks) |
| Manual | `/admin/reindex` for debugging |

### Versioning Model

Every chunk/document stores:
```typescript
{
  source_type: "repo" | "slack";
  repo_slug: string;
  path: string;
  commit_sha: string;
  indexed_at: string;
  index_run_id: string;       // UUID
  retrieval_program_version: string;  // e.g., "retrieval.v1.3"
}
```

Answer footer (internal-only):
```
"Indexed from light-space/light@<sha> (index_run_id …)"
```

### Drift Detection

Scheduled "Index Health" job checks:
- Last indexed SHA per repo == latest SHA on main
- Embeddings count grows as expected
- Canonical questions retrieve at least 1 chunk

If drift → alert in #lightopedia + logs.

---

## Determinism & Replayability

### Retrieval Determinism

Pin:
- Embedding model version
- Chunking rules version
- Retrieval SQL function signature + version

Store in every answer log:
- Top-k chunk IDs + similarity scores
- Retrieval version + index_run_id
- Model name

### Replay Capability

Debug endpoint:
```
GET /debug/replay?request_id=...
```

Returns:
- Router decision
- Retrieved chunks + scores
- Prompt + sources used

---

## Router Decay Plan

### Versioning

```typescript
const ROUTER_VERSION = "router.v1.0";
```

Log router output + confidence each request.

### Feedback Loop

Slack reaction workflow:
- ✅ Helpful
- ⚠️ Incorrect
- ❓ Needs more context

Store to Supabase:
- request_id
- label
- optional note

### Safe Updates

Router changes must:
1. Bump version
2. Update golden tests
3. Roll out behind flag (`ROUTER_CANARY=10%`)

---

## Mode Mapping (V1)

| Mode | Evidence Source | Priority |
|------|-----------------|----------|
| `capability_docs` | Docs + Slack threads | Primary |
| `enablement_sales` | Docs + Slack threads | Primary |
| `onboarding_howto` | Docs | Primary |
| `followup` | Thread context + Docs | Primary |
| `clarify` | N/A | Fallback |
| `behavior_code_first` | **OUT OF SCOPE FOR V1** | N/A |

---

*V1 scope locked. Code-first tracing deferred to V2.*
