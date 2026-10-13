-- Display order for the menu page (13/10/2026 update).
-- Each dish gets its own whole number (1, 2, 3 ...). The menu page lists dishes in this order by default.
-- Two dishes can never share a number (unique index). Set or change it in Admin -> Menu items.
-- A dish with no number is listed after all numbered dishes.
-- Run in Supabase SQL Editor after 12_menu_design_controls.sql. Safe to re-run.

alter table menu_items
  add column if not exists display_order integer;

-- First run only: number the dishes in the order requested for the menu
--   Beef, Chicken, Shrimp, Tofu, Dumpling, then Fried Noodle, Egg Fried Rice, Spring Roll, Mantou, Salad.
-- Inside a box the dishes keep their database id order. Change any number afterwards in the admin.
-- If any dish already has a number, nothing is changed here.
with ranked as (
  select m.id,
         row_number() over (
           order by
             case c.key
               when 'beef'    then 1
               when 'chicken' then 2
               when 'shrimp'  then 3
               when 'tofu'    then 4
               when 'dumpling' then 5
               else 6
             end,
             case
               when m.name_en ilike 'Vegetable Fried Noodle'  then 1
               when m.name_en ilike 'Egg Fried Rice'          then 2
               when m.name_en ilike 'Spring Roll%'            then 3
               when m.name_en ilike 'Mantou%'                 then 4
               when m.name_en ilike 'Mix Vegetable Salad'     then 5
               else 9
             end,
             m.id
         ) as rn
    from menu_items m
    join categories c on c.id = m.category_id
)
update menu_items m
   set display_order = r.rn
  from ranked r
 where m.id = r.id
   and not exists (select 1 from menu_items where display_order is not null);

-- No two dishes may share a number (dishes without a number are not affected).
create unique index if not exists menu_items_display_order_key
  on menu_items (display_order);

-- Check
select display_order, name_en, c.key as category
  from menu_items m
  join categories c on c.id = m.category_id
 order by display_order nulls last, m.id;
