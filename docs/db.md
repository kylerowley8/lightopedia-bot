# Lightopedia Database Schema

This document contains the Supabase/PostgreSQL schema for the Lightopedia bot's vector search functionality.

## Prerequisites

```sql
-- Enable pgvector extension (run once)
CREATE EXTENSION IF NOT EXISTS vector;
```

## Schema

### Documents Table

Stores indexed documents (files from repos, docs, etc.)

```sql
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,           -- e.g., "light-space/light/path/to/file.kt"
  content TEXT NOT NULL,          -- full document content
  metadata JSONB DEFAULT '{}',    -- additional metadata
  commit_sha TEXT,                -- git commit SHA when indexed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source)                  -- one document per source path
);

-- Index for source lookups
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_source_like ON documents USING gin(source gin_trgm_ops);
```

### Chunks Table

Stores document chunks with embeddings for vector search.

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',    -- source, chunkIndex, sourceType, symbols, etc.
  embedding vector(1536),         -- OpenAI text-embedding-3-large dimension
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT fk_document
    FOREIGN KEY (document_id)
    REFERENCES documents(id)
    ON DELETE CASCADE             -- CRITICAL: deletes chunks when document is deleted
);

-- CRITICAL: Vector similarity index (HNSW is faster for queries, IVFFlat for updates)
-- Choose ONE of these:

-- Option A: HNSW index (recommended for production, faster queries)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
ON chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Option B: IVFFlat index (faster to build, good for frequent reindexing)
-- CREATE INDEX IF NOT EXISTS idx_chunks_embedding_ivfflat
-- ON chunks USING ivfflat (embedding vector_cosine_ops)
-- WITH (lists = 100);

-- Index for metadata queries
CREATE INDEX IF NOT EXISTS idx_chunks_metadata ON chunks USING gin(metadata);

-- Index for document_id lookups (for cascade deletes)
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
```

## match_chunks RPC Function

This function performs vector similarity search. It's called from the application.

```sql
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

### Important Notes on match_chunks

1. **Input type**: The `query_embedding` parameter accepts a `vector(1536)` type. When calling from JavaScript:
   - Pass the embedding as a `number[]` array, NOT a string
   - Supabase client handles the conversion automatically

2. **Operator**: Uses `<=>` (cosine distance). Lower is more similar.
   - Similarity is calculated as `1 - distance` so higher = more similar

3. **Index usage**: The function will use the HNSW/IVFFlat index if:
   - The embedding column has a proper vector index
   - No casting/wrapping that breaks index usage
   - Query doesn't have complex WHERE clauses that bypass the index

## Cleanup Queries

### Find Orphan Chunks (chunks without documents)

```sql
-- Count orphan chunks
SELECT COUNT(*)
FROM chunks c
LEFT JOIN documents d ON c.document_id = d.id
WHERE d.id IS NULL;

-- Delete orphan chunks
DELETE FROM chunks c
WHERE NOT EXISTS (
  SELECT 1 FROM documents d WHERE d.id = c.document_id
);
```

### Find Chunks Without Embeddings

```sql
-- Count chunks missing embeddings
SELECT COUNT(*) FROM chunks WHERE embedding IS NULL;

-- Find sources with missing embeddings
SELECT metadata->>'source' as source, COUNT(*) as count
FROM chunks
WHERE embedding IS NULL
GROUP BY metadata->>'source'
ORDER BY count DESC;
```

### Vacuum and Analyze (run periodically)

```sql
-- Update statistics for query planner
ANALYZE chunks;
ANALYZE documents;

-- Reclaim space (run during low traffic)
VACUUM (VERBOSE, ANALYZE) chunks;
VACUUM (VERBOSE, ANALYZE) documents;
```

### Check Index Usage

```sql
-- Check if vector index is being used
EXPLAIN ANALYZE
SELECT id, content, 1 - (embedding <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM chunks
WHERE embedding IS NOT NULL
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;

-- Should show "Index Scan using idx_chunks_embedding_hnsw" or similar
```

### Database Statistics

```sql
-- Table sizes
SELECT
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as data_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size
FROM pg_catalog.pg_statio_user_tables
WHERE relname IN ('documents', 'chunks')
ORDER BY pg_total_relation_size(relid) DESC;

-- Row counts
SELECT
  (SELECT COUNT(*) FROM documents) as document_count,
  (SELECT COUNT(*) FROM chunks) as chunk_count,
  (SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL) as chunks_with_embeddings;
```

## Migration: Add ON DELETE CASCADE

If your existing schema doesn't have CASCADE, add it:

```sql
-- Drop existing constraint
ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_document_id_fkey;
ALTER TABLE chunks DROP CONSTRAINT IF EXISTS fk_document;

-- Add new constraint with CASCADE
ALTER TABLE chunks
ADD CONSTRAINT fk_document
FOREIGN KEY (document_id)
REFERENCES documents(id)
ON DELETE CASCADE;
```

## Migration: Add sourceType to metadata

For Phase 1 (code-first retrieval), chunks need a `sourceType` field:

```sql
-- Update existing chunks to have sourceType based on source path
UPDATE chunks
SET metadata = metadata || jsonb_build_object(
  'sourceType',
  CASE
    WHEN metadata->>'source' ~ '\.(kt|kts|java|ts|tsx|js|jsx)$' THEN 'code'
    WHEN metadata->>'source' ~ '\.md$' THEN 'docs'
    WHEN metadata->>'source' LIKE 'notion-%' THEN 'notion'
    ELSE 'unknown'
  END
)
WHERE metadata->>'sourceType' IS NULL;

-- Create index for sourceType queries
CREATE INDEX IF NOT EXISTS idx_chunks_source_type
ON chunks ((metadata->>'sourceType'));
```

## Troubleshooting

### Queries Timing Out

1. Check if vector index exists:
   ```sql
   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE tablename = 'chunks' AND indexdef LIKE '%vector%';
   ```

2. If no index, create one (will take time for large tables):
   ```sql
   CREATE INDEX CONCURRENTLY idx_chunks_embedding_hnsw
   ON chunks USING hnsw (embedding vector_cosine_ops);
   ```

3. Check for bloat from orphan records:
   ```sql
   SELECT COUNT(*) FROM chunks c
   LEFT JOIN documents d ON c.document_id = d.id
   WHERE d.id IS NULL;
   ```

### match_chunks Returns No Results

1. Check embedding dimension matches:
   ```sql
   SELECT array_length(embedding::float[], 1) as dim
   FROM chunks
   WHERE embedding IS NOT NULL
   LIMIT 1;
   -- Should return 1536
   ```

2. Check embeddings exist:
   ```sql
   SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL;
   ```

3. Test function directly:
   ```sql
   SELECT * FROM match_chunks(
     (SELECT embedding FROM chunks WHERE embedding IS NOT NULL LIMIT 1),
     5
   );
   ```
