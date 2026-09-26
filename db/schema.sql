-- ============================================================
-- Red House Catering — Supabase schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)
-- ============================================================

-- ---------- CATEGORIES ----------
create table if not exists categories (
  id            bigint generated always as identity primary key,
  key           text unique not null,          -- e.g. 'starters', 'mains'
  label_en      text not null,
  label_ar      text not null,
  label_ur      text not null,
  label_zh      text not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- MENU ITEMS ----------
create table if not exists menu_items (
  id            bigint generated always as identity primary key,
  category_id   bigint not null references categories(id) on delete restrict,
  name_en       text not null,
  name_ar       text not null,
  name_ur       text not null,
  name_zh       text not null,
  description_en text,
  description_ar text,
  description_ur text,
  description_zh text,
  price         numeric(10,2) not null check (price >= 0),
  image_path    text,                          -- e.g. 'mains/butter_chicken.jpg'
  is_offer      boolean not null default false,
  popularity    int not null default 0,        -- higher = more popular, drives "popular" sort
  is_available  boolean not null default true, -- lets you 86 an item without deleting it
  created_at    timestamptz not null default now()
);

create index if not exists idx_menu_items_category on menu_items(category_id);

-- ---------- ORDERS ----------
create table if not exists orders (
  id             bigint generated always as identity primary key,
  customer_name  text,
  customer_phone text,
  customer_email text,
  delivery_type  text not null default 'pickup',  -- 'pickup' | 'delivery'
  delivery_address text,
  status         text not null default 'pending', -- pending | confirmed | preparing | ready | completed | cancelled
  payment_status text not null default 'unpaid',   -- unpaid | paid | failed | refunded (simulated for now)
  payment_method text,                             -- 'simulated_card', 'cash', etc.
  subtotal       numeric(10,2) not null default 0,
  total          numeric(10,2) not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- ORDER ITEMS ----------
-- Snapshot name/price at time of order so historical orders don't change
-- if you later edit the menu item.
create table if not exists order_items (
  id            bigint generated always as identity primary key,
  order_id      bigint not null references orders(id) on delete cascade,
  menu_item_id  bigint references menu_items(id) on delete set null,
  name_snapshot text not null,
  unit_price    numeric(10,2) not null,
  quantity      int not null check (quantity > 0),
  line_total    numeric(10,2) not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_order_items_order on order_items(order_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- Menu/categories: readable by anyone (public menu browsing).
-- Orders/order_items: NOT publicly readable/writable directly —
-- all order creation goes through your Node server using the
-- Supabase SERVICE ROLE key (which bypasses RLS), never the
-- public anon key. This keeps prices/order data tamper-proof.
-- ============================================================

alter table categories enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "Public can read categories"
  on categories for select
  using (true);

create policy "Public can read available menu items"
  on menu_items for select
  using (true);

-- No policies added for orders / order_items => blocked for anon/public.
-- Your server uses the service_role key, which ignores RLS entirely.

-- ============================================================
-- SEED DATA (adjust to your real menu, or delete this section)
-- ============================================================

insert into categories (key, label_en, label_ar, label_ur, label_zh, sort_order) values
  ('starters', 'Starters', 'المقبلات', 'اسٹارٹرز', '开胃菜', 1),
  ('mains',    'Mains',    'الأطباق الرئيسية', 'مین کورس', '主菜', 2),
  ('desserts', 'Desserts', 'الحلويات', 'میٹھا', '甜点', 3),
  ('drinks',   'Drinks',   'المشروبات', 'مشروبات', '饮品', 4)
on conflict (key) do nothing;
