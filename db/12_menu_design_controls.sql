-- Per-item layout and card color controls for the menu design editor.
-- Run in Supabase SQL Editor after 09_menu_card_images.sql. Safe to re-run.

alter table menu_items
  add column if not exists food_scale integer,
  add column if not exists food_x integer,
  add column if not exists food_y integer,
  add column if not exists bg_x integer,
  add column if not exists bg_y integer,
  add column if not exists bg_scale integer,
  add column if not exists card_color text;