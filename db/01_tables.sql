-- Red House Catering — database, file 1 of 4: TABLES
-- Run the four files in this order in Supabase -> SQL Editor (new project):
--   01_tables.sql                  this file: every table and column (no links between tables yet)
--   02_relations.sql               links between tables, indexes, uniqueness, order numbers, row-level security
--   03_menu_and_categories.sql     categories + the 17 dishes (prices 39, display order, images)
--   04_site_data.sql               contact phone numbers / address / map link and the menu texts
-- Every file is safe to re-run. A database that is already set up does not need any of them again.

create extension if not exists pgcrypto;

-- Menu ---------------------------------------------------------------------------------------------

create table if not exists categories (
  id         bigint generated always as identity primary key,
  key        text not null unique,
  label_en   text not null,
  label_ar   text not null,
  label_ur   text not null,
  label_zh   text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists menu_items (
  id             bigint generated always as identity primary key,
  category_id    bigint not null,                        -- -> categories (02_relations.sql)
  name_en        text not null,
  name_ar        text not null,
  name_ur        text not null,
  name_zh        text not null,
  description_en text,
  description_ar text,
  description_ur text,
  description_zh text,
  price          numeric(10,2) not null check (price >= 0),
  image_path     text,                                   -- plain product photo (fallback for the food PNG)
  is_offer       boolean not null default false,
  popularity     int not null default 0,
  is_available   boolean not null default true,
  calories       int,
  rating         numeric(2,1),
  -- 3-layer menu card: background (layer 1) and transparent food PNG (layer 3)
  bg_image_url   text,
  food_png_url   text,
  -- menu design editor: position / size of the layers and the card colour
  food_scale     integer,
  food_x         integer,
  food_y         integer,
  bg_x           integer,
  bg_y           integer,
  bg_scale       integer,
  card_color     text,
  -- order of the dishes on the menu page (1 first); each number can be used by one dish only
  display_order  integer,
  created_at     timestamptz not null default now()
);

-- Customers and orders -----------------------------------------------------------------------------

create table if not exists profiles (
  id           uuid primary key,                         -- = auth.users.id (02_relations.sql)
  display_name text not null default '',
  phone        text,
  address      text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists orders (
  id               bigint generated always as identity primary key,
  user_id          uuid,                                 -- -> auth.users (02_relations.sql)
  customer_name    text,
  customer_phone   text,
  customer_email   text,
  delivery_type    text not null default 'pickup',
  delivery_address text,
  status           text not null default 'pending',
  payment_status   text not null default 'unpaid',
  payment_method   text,
  subtotal         numeric(10,2) not null default 0,
  total            numeric(10,2) not null default 0,
  notes            text,
  order_token      uuid not null default gen_random_uuid(),
  order_number     text,                                 -- RH-YYMMDD-NNNN, filled by a trigger (02_relations.sql)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists order_items (
  id            bigint generated always as identity primary key,
  order_id      bigint not null,                         -- -> orders
  menu_item_id  bigint,                                  -- -> menu_items (kept as null if the dish is deleted)
  name_snapshot text not null,
  unit_price    numeric(10,2) not null,
  quantity      int not null check (quantity > 0),
  line_total    numeric(10,2) not null,
  created_at    timestamptz not null default now()
);

create table if not exists cart_items (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,                            -- -> auth.users
  menu_item_id bigint not null,                          -- -> menu_items
  quantity     int not null check (quantity > 0),
  updated_at   timestamptz not null default now(),
  unique (user_id, menu_item_id)
);

-- Site settings (contact details, menu design and texts, poster, music) -----------------------------
-- Read and written by the server with the service-role key only.

create table if not exists site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- "Special" section (currently paused on the menu page): one video per category + five featured dishes

create table if not exists special_sections (
  category_id bigint primary key,                        -- -> categories
  video_path  text,
  updated_at  timestamptz not null default now()
);

create table if not exists special_section_items (
  category_id  bigint not null,                          -- -> categories
  slot         int not null check (slot between 1 and 5),
  menu_item_id bigint not null,                          -- -> menu_items
  created_at   timestamptz not null default now(),
  primary key (category_id, slot),
  unique (category_id, menu_item_id)
);

-- Bring a database created with the older scripts up to this schema (does nothing on a new one) ------

alter table profiles   add column if not exists is_admin      boolean not null default false;
alter table orders     add column if not exists order_token   uuid not null default gen_random_uuid();
alter table orders     add column if not exists order_number  text;
alter table menu_items add column if not exists calories      int;
alter table menu_items add column if not exists rating        numeric(2,1);
alter table menu_items add column if not exists bg_image_url  text;
alter table menu_items add column if not exists food_png_url  text;
alter table menu_items add column if not exists food_scale    integer;
alter table menu_items add column if not exists food_x        integer;
alter table menu_items add column if not exists food_y        integer;
alter table menu_items add column if not exists bg_x          integer;
alter table menu_items add column if not exists bg_y          integer;
alter table menu_items add column if not exists bg_scale      integer;
alter table menu_items add column if not exists card_color    text;
alter table menu_items add column if not exists display_order integer;
