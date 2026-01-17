-- ============================================
-- Docs Table — V1 Documentation Chunks
-- ============================================
-- Stores indexed documentation from allowed repos.
-- Only markdown files (*.md, *.mdx) per INDEXING_SCOPE.md.

create table if not exists docs (
  id uuid primary key default gen_random_uuid(),

  -- Content
  content text not null,

  -- Embedding (text-embedding-3-large, 1536 dimensions)
  embedding vector(1536) not null,

  -- V1 Metadata (stored as JSONB for flexibility)
  metadata jsonb not null default '{}'::jsonb,

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists docs_embedding_idx on docs
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists docs_metadata_repo_idx on docs
  using gin ((metadata->'repo_slug'));

create index if not exists docs_metadata_path_idx on docs
  using gin ((metadata->'path'));

create index if not exists docs_metadata_run_idx on docs
  ((metadata->>'index_run_id'));

-- Trigger to update updated_at
create or replace function trigger_docs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists docs_updated_at on docs;
create trigger docs_updated_at
  before update on docs
  for each row execute function trigger_docs_updated_at();

-- Comments for documentation
comment on table docs is 'V1 documentation chunks from allowed repos (docs-first retrieval)';
comment on column docs.content is 'Raw text content of the documentation chunk';
comment on column docs.embedding is 'OpenAI text-embedding-3-large vector (1536d)';
comment on column docs.metadata is 'Indexing metadata: source_type, repo_slug, path, commit_sha, indexed_at, index_run_id, retrieval_program_version';
