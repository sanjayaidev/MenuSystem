-- ============================================================
-- Run AFTER schema.sql + profile_auth.sql (+ reset_and_seed_menu.sql).
-- Adds: admin role flag, server-side cart storage, a per-order
-- lookup token (so order ids can't just be guessed), and RLS
-- policies for defense-in-depth.
--
-- NOTE: your Node server always talks to Supabase with the
-- SERVICE ROLE key, which bypasses RLS entirely. These policies
-- do not change how the app behaves today — they only matter if
-- something (now or later) ever queries Supabase directly with
-- the public anon key. We add them anyway as defense-in-depth.
-- ============================================================

-- ---------- ADMIN ROLE ----------
alter table profiles add column if not exists is_admin boolean not null default false;

-- To make someone an admin, run (with their auth.users UUID):
--   update profiles set is_admin = true where id = '<user-uuid>';

-- ---------- CART ITEMS (server-side cart for logged-in users) ----------
create extension if not exists pgcrypto;

create table if not exists cart_items (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  menu_item_id  bigint not null references menu_items(id) on delete cascade,
  quantity      int not null check (quantity > 0),
  updated_at    timestamptz not null default now(),
  unique (user_id, menu_item_id)
);
create index if not exists idx_cart_items_user on cart_items(user_id);

alter table cart_items enable row level security;
drop policy if exists "Users manage own cart" on cart_items;
create policy "Users manage own cart"
  on cart_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- ORDER LOOKUP TOKEN ----------
-- A random, unguessable token returned once at order creation, so a
-- guest checkout can look up their own order confirmation without an
-- account, while a stranger can't just walk sequential order ids.
alter table orders add column if not exists order_token uuid not null default gen_random_uuid();
create unique index if not exists idx_orders_token on orders(order_token);

-- ---------- RLS: profiles ----------
drop policy if exists "Users read own profile" on profiles;
create policy "Users read own profile"
  on profiles for select
  using (auth.uid() = id);

drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------- RLS: orders ----------
drop policy if exists "Users read own orders" on orders;
create policy "Users read own orders"
  on orders for select
  using (auth.uid() = user_id);

-- ---------- RLS: order_items ----------
drop policy if exists "Users read own order items" on order_items;
create policy "Users read own order items"
  on order_items for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and o.user_id = auth.uid()
    )
  );

-- No insert/update/delete policies are added for profiles/orders/order_items/
-- cart_items beyond the above — all writes happen through the Node server
-- using the service_role key, which ignores RLS entirely regardless.
