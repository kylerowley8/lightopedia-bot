-- ============================================
-- Lightopedia V2 — Combined Migration
-- ============================================
-- Run this once in Supabase SQL Editor to set up V2 tables and RPCs.
--
-- USAGE:
-- 1. Open your Supabase project dashboard
-- 2. Go to SQL Editor
-- 3. Paste this entire file
-- 4. Click "Run"
-- 5. Verify: SELECT COUNT(*) FROM docs; (should return 0)
-- ============================================

-- ============================================
-- 1. Enable pgvector Extension
-- ============================================

create extension if not exists vector with schema extensions;

-- ============================================
-- 2. Create docs table
-- ============================================

create table if not exists docs (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists docs_embedding_idx on docs
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists docs_metadata_repo_idx on docs
  using gin ((metadata->'repo_slug'));

create index if not exists docs_metadata_path_idx on docs
  using gin ((metadata->'path'));

create index if not exists docs_metadata_run_idx on docs
  ((metadata->>'index_run_id'));

-- Updated at trigger
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

comment on table docs is 'V2 documentation chunks from allowed repos';

-- ============================================
-- 3. Create slack_threads table
-- ============================================

create table if not exists slack_threads (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists slack_threads_embedding_idx on slack_threads
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create index if not exists slack_threads_metadata_channel_idx on slack_threads
  ((metadata->>'channel'));

create index if not exists slack_threads_metadata_run_idx on slack_threads
  ((metadata->>'index_run_id'));

-- Updated at trigger
create or replace function trigger_slack_threads_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists slack_threads_updated_at on slack_threads;
create trigger slack_threads_updated_at
  before update on slack_threads
  for each row execute function trigger_slack_threads_updated_at();

comment on table slack_threads is 'V2 curated Slack threads from #lightopedia';

-- ============================================
-- 4. Create match_docs RPC
-- ============================================

create or replace function match_docs(
  query_embedding vector(1536),
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
security definer
as $$
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from docs d
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;

comment on function match_docs is 'Vector similarity search on documentation chunks';

-- ============================================
-- 5. Create match_slack_threads RPC
-- ============================================

create or replace function match_slack_threads(
  query_embedding vector(1536),
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
security definer
as $$
begin
  return query
  select
    s.id,
    s.content,
    s.metadata,
    1 - (s.embedding <=> query_embedding) as similarity
  from slack_threads s
  order by s.embedding <=> query_embedding
  limit match_count;
end;
$$;

comment on function match_slack_threads is 'Vector similarity search on Slack threads';

-- ============================================
-- 6. Create feedback table
-- ============================================

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  channel_id text not null,
  thread_ts text not null,
  message_ts text not null,
  user_id text not null,
  feedback_type text not null check (feedback_type in ('helpful', 'not_helpful')),
  question text,
  route_mode text,
  docs_count int,
  slack_count int,
  top_similarity float,
  created_at timestamptz not null default now()
);

create index if not exists feedback_request_idx on feedback (request_id);
create index if not exists feedback_channel_idx on feedback (channel_id);
create index if not exists feedback_type_idx on feedback (feedback_type);
create index if not exists feedback_created_idx on feedback (created_at);

comment on table feedback is 'V2 user feedback from Slack reactions';

-- ============================================
-- 7. Verification query
-- ============================================
-- After running, execute this to verify:
-- SELECT
--   (SELECT COUNT(*) FROM docs) as docs_count,
--   (SELECT COUNT(*) FROM slack_threads) as slack_count,
--   (SELECT COUNT(*) FROM feedback) as feedback_count;

select 'Migration complete! Tables: docs, slack_threads, feedback. RPCs: match_docs, match_slack_threads.' as status;
