-- Red House Catering: editable site settings (contact details for the
-- homepage call button). Run after 05_order_numbers.sql in the Supabase
-- SQL Editor.
--
-- The server reads/writes this table with the service-role key (which
-- bypasses RLS). RLS is enabled with no policies, so the browser cannot
-- read or write it directly with the anon key.

create table if not exists site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

-- Demo contact details. Admin can change these from the "Contact" tab.
insert into site_settings (key, value)
values (
  'contact',
  '{"phone": "+966 50 000 0000", "address": "123 Demo Street, Riyadh, Saudi Arabia"}'::jsonb
)
on conflict (key) do nothing;
