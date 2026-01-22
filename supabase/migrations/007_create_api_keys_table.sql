-- Migration: Create api_keys table for self-service key management
-- Keys are stored as SHA256 hashes for security

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  key_hash text not null,      -- SHA256 hash of the actual key
  key_prefix text not null,    -- "lp_abc123..." for display (first 12 chars)
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

-- Index for key hash lookups during authentication
create index idx_api_keys_key_hash on api_keys(key_hash) where revoked_at is null;

-- Index for user's keys listing
create index idx_api_keys_user_id on api_keys(user_id);

-- Index for active (non-revoked) keys
create index idx_api_keys_active on api_keys(user_id) where revoked_at is null;
