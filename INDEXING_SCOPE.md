# Indexing Scope — V1 Contract

This document defines exactly what Lightopedia indexes. No exceptions.

---

## Repos

| Repo | Description |
|------|-------------|
| `light-space/light` | Core backend |
| `light-space/axolotl` | API layer |
| `light-space/mobile-app` | Mobile client |

---

## Included Files

```
README.md
docs/**
**/*.md
**/*.mdx
```

Only documentation. No executable code.

---

## Excluded Files

```
# Executable code
**/*.kt
**/*.kts
**/*.java
**/*.ts
**/*.tsx
**/*.js
**/*.jsx
**/*.py
**/*.go
**/*.rs
**/*.swift
**/*.scala

# Config (executable)
**/*.json
**/*.yaml
**/*.yml
**/*.toml
**/*.xml
**/*.gradle
**/*.properties

# Build artifacts
dist/**
build/**
.next/**
coverage/**
node_modules/**
target/**
out/**

# Generated
**/*.min.js
**/*.min.css
**/*.map
**/*.lock
**/package-lock.json
**/yarn.lock
**/pnpm-lock.yaml

# Tests
**/*.test.*
**/*.spec.*
**/__tests__/**
**/test/**
**/tests/**

# IDE/config
.git/**
.github/**
.vscode/**
.idea/**
```

---

## Slack

| Channel | ID | Indexed |
|---------|-----|---------|
| #lightopedia | `C08SDBFS7BL` | ✅ Yes |
| All others | — | ❌ No |

Only threads from #lightopedia are indexed. No other channels.

---

## Indexing Triggers

| Trigger | When |
|---------|------|
| GitHub webhook | Push to `main` branch |
| Nightly backfill | 2:00 AM UTC (heals missed webhooks) |
| Manual | `/admin/reindex` command |

---

## Versioning

Every indexed chunk stores:

```typescript
{
  source_type: "repo" | "slack",
  repo_slug: string,        // e.g., "light-space/light"
  path: string,             // e.g., "docs/billing.md"
  commit_sha: string,       // Git SHA at index time
  indexed_at: string,       // ISO timestamp
  index_run_id: string,     // UUID for this run
  slack_channel_id?: string // For Slack: "C08SDBFS7BL"
}
```

---

## Enforcement

The indexer MUST:

1. Check repo against allowlist before indexing
2. Check file path against include patterns
3. Check file path against exclude patterns
4. Check Slack channel ID before indexing threads
5. Reject any content outside this scope

---

*V1 scope locked. Code indexing deferred to V2.*
