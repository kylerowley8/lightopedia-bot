-- Migration: Switch to Supabase Auth
-- Drop custom users table and update api_keys to reference auth.users

-- Drop api_keys first (has foreign key to users)
drop table if exists api_keys;

-- Drop custom users table (we'll use auth.users instead)
drop table if exists users;

-- Recreate api_keys referencing Supabase's auth.users
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  key_hash text not null,
  key_prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

create index idx_api_keys_key_hash on api_keys(key_hash) where revoked_at is null;
create index idx_api_keys_user_id on api_keys(user_id);
create index idx_api_keys_active on api_keys(user_id) where revoked_at is null;
