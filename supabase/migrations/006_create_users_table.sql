-- Migration: Create users table for Google OAuth
-- Stores authenticated users who can manage API keys

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  google_id text not null unique,
  name text,
  picture_url text,
  created_at timestamptz default now(),
  last_login_at timestamptz default now()
);

-- Index for email lookups
create index idx_users_email on users(email);

-- Index for Google ID lookups during OAuth
create index idx_users_google_id on users(google_id);
