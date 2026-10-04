-- Red House Catering: per-item images for the 3-layer menu card.
-- Run in Supabase SQL Editor after 08_contact_whatsapp.sql. Safe to re-run.
--
--   bg_image_url  layer 1: background picture behind the card (left side of the row)
--   food_png_url  layer 3: transparent food PNG drawn over the background and the card
--
-- Both are optional. When food_png_url is empty the menu card falls back to the
-- item's existing image_path, so current items keep working until they are updated.

alter table menu_items
  add column if not exists bg_image_url text,
  add column if not exists food_png_url text;
