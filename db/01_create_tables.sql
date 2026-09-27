-- Red House Catering: base tables for a new Supabase project.
-- Run this first in Supabase SQL Editor.

create extension if not exists pgcrypto;

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
  category_id    bigint not null references categories(id) on delete restrict,
  name_en        text not null,
  name_ar        text not null,
  name_ur        text not null,
  name_zh        text not null,
  description_en text,
  description_ar text,
  description_ur text,
  description_zh text,
  price          numeric(10,2) not null check (price >= 0),
  image_path     text,
  is_offer       boolean not null default false,
  popularity     int not null default 0,
  is_available   boolean not null default true,
  calories       int,
  rating         numeric(2,1),
  created_at     timestamptz not null default now()
);

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone        text,
  address      text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists orders (
  id               bigint generated always as identity primary key,
  user_id          uuid references auth.users(id) on delete set null,
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
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

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

create table if not exists cart_items (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  menu_item_id bigint not null references menu_items(id) on delete cascade,
  quantity     int not null check (quantity > 0),
  updated_at   timestamptz not null default now(),
  unique (user_id, menu_item_id)
);