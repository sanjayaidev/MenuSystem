-- Fix: "new row violates row-level security policy for table profiles"
-- Run this in Supabase -> SQL Editor after 01/02/03.
--
-- Root cause note: the server is supposed to talk to Supabase using the
-- service_role key, which bypasses RLS entirely. If you're seeing this
-- error, first double-check SUPABASE_SERVICE_ROLE_KEY in your server's
-- env vars actually is the *service_role* secret (Project Settings ->
-- API), not the anon/public key. See db/supabase.js for a startup check
-- that will now shout loudly if the wrong key is configured.
--
-- This policy is a safety net regardless: it lets a logged-in user
-- create their own profile row even if a request ever reaches Postgres
-- as `authenticated` instead of `service_role`.

drop policy if exists "Users insert own profile" on profiles;
create policy "Users insert own profile"
  on profiles for insert
  with check (auth.uid() = id);
