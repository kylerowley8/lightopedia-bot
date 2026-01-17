# Supabase Migrations — Lightopedia V2

This folder contains the database schema for Lightopedia V2 docs-first retrieval.

## Prerequisites

1. A Supabase project with the `vector` extension enabled
2. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables set

## Migrations

Apply in order:

```bash
# Using Supabase CLI (recommended)
supabase db push

# Or manually in SQL Editor:
# 1. 001_enable_vector.sql       - Enable pgvector extension
# 2. 002_create_docs_table.sql   - Create docs table
# 3. 003_create_slack_threads_table.sql - Create slack_threads table
# 4. 004_create_match_functions.sql - Create RPC functions
```

## Schema

### `docs`

Stores indexed documentation chunks from allowed repos.

| Column     | Type           | Description                          |
|------------|----------------|--------------------------------------|
| id         | uuid           | Primary key                          |
| content    | text           | Raw text content of the chunk        |
| embedding  | vector(1536)   | OpenAI text-embedding-3-large vector |
| metadata   | jsonb          | Indexing metadata (see below)        |
| created_at | timestamptz    | Row creation timestamp               |
| updated_at | timestamptz    | Last update timestamp                |

**Metadata fields:**
- `source_type`: "repo"
- `repo_slug`: e.g., "light-space/light"
- `path`: e.g., "docs/billing.md"
- `section`: Optional section heading
- `commit_sha`: Git SHA at index time
- `indexed_at`: ISO timestamp
- `index_run_id`: UUID for this indexing run
- `retrieval_program_version`: e.g., "retrieval.v1.0"

### `slack_threads`

Stores indexed Slack threads from #lightopedia channel.

| Column     | Type           | Description                          |
|------------|----------------|--------------------------------------|
| id         | uuid           | Primary key                          |
| content    | text           | Concatenated thread messages         |
| embedding  | vector(1536)   | OpenAI text-embedding-3-large vector |
| metadata   | jsonb          | Thread metadata (see below)          |
| created_at | timestamptz    | Row creation timestamp               |
| updated_at | timestamptz    | Last update timestamp                |

**Metadata fields:**
- `permalink`: Slack message permalink
- `topic`: Thread topic/summary
- `channel`: Channel ID (C08SDBFS7BL for #lightopedia)
- `indexed_at`: ISO timestamp
- `index_run_id`: UUID for this indexing run

## RPC Functions

### `match_docs(query_embedding, match_count)`

Vector similarity search on documentation.

```typescript
const { data } = await supabase.rpc("match_docs", {
  query_embedding: embedding,  // float[] of length 1536
  match_count: 10,
});
// Returns: { id, content, metadata, similarity }[]
```

### `match_slack_threads(query_embedding, match_count)`

Vector similarity search on Slack threads.

```typescript
const { data } = await supabase.rpc("match_slack_threads", {
  query_embedding: embedding,  // float[] of length 1536
  match_count: 5,
});
// Returns: { id, content, metadata, similarity }[]
```

## Testing

After applying migrations, run the test script:

```bash
npm run db:test
```

This inserts test data and verifies the RPC functions work.
