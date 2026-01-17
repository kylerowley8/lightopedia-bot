-- ============================================
-- Match Functions — V1 Vector Similarity Search RPCs
-- ============================================
-- These functions are called by docsRetrieval.ts via supabase.rpc().
-- They perform cosine similarity search on document embeddings.

-- ============================================
-- match_docs: Search documentation chunks
-- ============================================
-- Returns docs ordered by cosine similarity to query embedding.
-- Matches the DbDocRow interface in docsRetrieval.ts.

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

comment on function match_docs is 'Vector similarity search on documentation chunks. Returns id, content, metadata, similarity.';

-- ============================================
-- match_slack_threads: Search Slack threads
-- ============================================
-- Returns Slack threads ordered by cosine similarity.
-- Matches the DbSlackRow interface in docsRetrieval.ts.

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

comment on function match_slack_threads is 'Vector similarity search on Slack threads. Returns id, content, metadata, similarity.';
