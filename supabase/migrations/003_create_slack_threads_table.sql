-- ============================================
-- Slack Threads Table — V1 Curated Slack Content
-- ============================================
-- Stores indexed threads from #lightopedia channel only.
-- Channel ID: C08SDBFS7BL per INDEXING_SCOPE.md.

create table if not exists slack_threads (
  id uuid primary key default gen_random_uuid(),

  -- Content (concatenated thread messages)
  content text not null,

  -- Embedding (text-embedding-3-large, 1536 dimensions)
  embedding vector(1536) not null,

  -- V1 Metadata (stored as JSONB for flexibility)
  metadata jsonb not null default '{}'::jsonb,

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for vector search
create index if not exists slack_threads_embedding_idx on slack_threads
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create index if not exists slack_threads_metadata_channel_idx on slack_threads
  ((metadata->>'channel'));

create index if not exists slack_threads_metadata_run_idx on slack_threads
  ((metadata->>'index_run_id'));

-- Trigger to update updated_at
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

-- Comments for documentation
comment on table slack_threads is 'V1 curated Slack threads from #lightopedia channel only';
comment on column slack_threads.content is 'Concatenated thread messages';
comment on column slack_threads.embedding is 'OpenAI text-embedding-3-large vector (1536d)';
comment on column slack_threads.metadata is 'Thread metadata: permalink, topic, channel, indexed_at, index_run_id';
