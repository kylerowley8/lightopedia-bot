-- ============================================
-- Feedback Table — V2 User Feedback Storage
-- ============================================
-- Stores feedback from Slack reactions (helpful/not helpful).
-- Enables quality tracking and retrieval tuning.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),

  -- Request context
  request_id text not null,
  channel_id text not null,
  thread_ts text not null,
  message_ts text not null,
  user_id text not null,

  -- Feedback
  feedback_type text not null check (feedback_type in ('helpful', 'not_helpful')),

  -- Context for debugging
  question text,
  route_mode text,
  docs_count int,
  slack_count int,
  top_similarity float,

  -- Timestamps
  created_at timestamptz not null default now()
);

-- Indexes for analytics queries
create index if not exists feedback_request_idx on feedback (request_id);
create index if not exists feedback_channel_idx on feedback (channel_id);
create index if not exists feedback_type_idx on feedback (feedback_type);
create index if not exists feedback_created_idx on feedback (created_at);

-- Comments
comment on table feedback is 'V2 user feedback from Slack reactions';
comment on column feedback.request_id is 'UUID of the pipeline request';
comment on column feedback.feedback_type is 'helpful or not_helpful';
