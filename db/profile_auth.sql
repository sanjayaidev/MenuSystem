-- Run this once on an existing database after db/schema.sql.
-- Profiles are keyed by the immutable UUID from auth.users.

create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default '',
  phone         text,
  address       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table profiles enable row level security;

alter table orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_orders_user_id on orders(user_id);