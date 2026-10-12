-- Red House Catering: category update requested 12/10/2026 (Emenu_SM.pdf).
-- Run in Supabase -> SQL Editor. Safe to re-run.
--
-- ONLY categories, and which category each dish sits in, are changed.
-- Dish names, descriptions, prices, photos, popularity and orders are NOT touched.
--
-- Result (10 boxes):  1 Beef Meal  2 Chicken Meal  3 Shrimp Meal  4 Tofu  5 Dumpling
--   6 Rice Noodles  7 Side Orders (new)  8 Most Popular (virtual, added by the page)
--   9 Dine In  10 Outside Catering
--
--   renamed in place (same ids, so dishes stay attached):
--     'tofu'  "Tofu Noodle"      -> "Tofu"
--     'soup'  "Soup Rice"        -> "Dumpling"       (key becomes 'dumpling')
--     'salad' "Salad Appetizer"  -> "Rice Noodles"   (key becomes 'rice-noodles')
--   new: 'side-orders'
--
--   dishes moved:
--     Dumpling       3 steamed dumplings (chicken, beef, shrimp)
--     Rice Noodles   Egg Fried Rice, Vegetable Fried Noodle
--     Side Orders    Spring Roll, Mantou and Mandarin Rolls, Mix Vegetable Salad
--     (Beef 3, Chicken 3, Shrimp 1, Tofu 2 already match)
--
-- !! Do NOT re-run db/03_insert_menu.sql or db/10_nine_categories.sql afterwards: they would
-- !! re-create the old category names. The page must also move "Most Popular" to slot 8
-- !! (POPULAR_SORT_ORDER in frontend/menu-page.html, included in the same patch).

begin;

-- 1. categories ------------------------------------------------------------------------------
update categories set key = 'dumpling'
 where key = 'soup'
   and not exists (select 1 from categories where key = 'dumpling');

update categories set key = 'rice-noodles'
 where key = 'salad'
   and not exists (select 1 from categories where key = 'rice-noodles');

insert into categories (key, label_en, label_ar, label_ur, label_zh, sort_order) values
  ('beef',             'Beef Meal',        'وجبة لحم بقر',   'بیف میل',          '牛肉套餐',     1),
  ('chicken',          'Chicken Meal',     'وجبة دجاج',      'چکن میل',          '鸡肉套餐',     2),
  ('shrimp',           'Shrimp Meal',      'وجبة روبيان',    'جھینگا میل',       '虾仁套餐',     3),
  ('tofu',             'Tofu',             'توفو',           'ٹوفو',             '豆腐',         4),
  -- Arabic uses the client's own word (الزلابية) so it matches the dish names already in the menu
  ('dumpling',         'Dumpling',         'الزلابية',       'ڈمپلنگ',           '饺子',         5),
  ('rice-noodles',     'Rice Noodles',     'أرز ونودلز',     'رائس نوڈلز',       '米饭与面条',   6),
  ('side-orders',      'Side Orders',      'أطباق جانبية',   'سائیڈ آرڈرز',      '配菜',         7),
  -- 8 = Most Popular (virtual box, added by the page)
  ('dine-in',          'Dine In',          'داخل المطعم',    'ڈائن اِن',         '堂食',         9),
  ('outside-catering', 'Outside Catering', 'تموين خارجي',    'آؤٹ سائیڈ کیٹرنگ', '外部餐饮服务', 10)
on conflict (key) do update set
  label_en   = excluded.label_en,
  label_ar   = excluded.label_ar,
  label_ur   = excluded.label_ur,
  label_zh   = excluded.label_zh,
  sort_order = excluded.sort_order;

-- 2. move the dishes (matched by English name; '%' = any ending, e.g. "Spring Roll (4pcs)") -----
update menu_items m
   set category_id = c.id
  from (values
    ('Steamed Dumpling Chicken',   'dumpling'),
    ('Steamed Dumpling Beef',      'dumpling'),
    ('Steamed Dumpling Shrimp',    'dumpling'),
    ('Egg Fried Rice',             'rice-noodles'),
    ('Vegetable Fried Noodle',     'rice-noodles'),
    ('Spring Roll%',               'side-orders'),
    ('Mantou and Mandarin Rolls',  'side-orders'),
    ('Mix Vegetable Salad',        'side-orders')
  ) as v(name_pattern, cat_key)
  join categories c on c.key = v.cat_key
 where m.name_en ilike v.name_pattern;

-- 3. guard: all 8 dishes must have been found, otherwise undo everything ----------------------
do $$
declare n int;
begin
  select count(*) into n
    from menu_items m
    join categories c on c.id = m.category_id
   where (c.key = 'dumpling'     and m.name_en ilike 'Steamed Dumpling%')
      or (c.key = 'rice-noodles' and m.name_en in ('Egg Fried Rice', 'Vegetable Fried Noodle'))
      or (c.key = 'side-orders'  and (m.name_en ilike 'Spring Roll%'
                                      or m.name_en = 'Mantou and Mandarin Rolls'
                                      or m.name_en = 'Mix Vegetable Salad'));
  if n <> 8 then
    raise exception 'Expected 8 dishes in Dumpling / Rice Noodles / Side Orders, found %. Nothing was changed.', n;
  end if;
end $$;

commit;

-- Check: dishes per box (available dishes only) ------------------------------------------------
--   Beef 3, Chicken 3, Shrimp 1, Tofu 2, Dumpling 3, Rice Noodles 2, Side Orders 3, Dine In 0, Outside Catering 0
select c.sort_order, c.key, c.label_en,
       count(m.id) filter (where m.is_available) as dishes_shown,
       string_agg(m.name_en, ', ' order by m.name_en) filter (where m.is_available) as dishes
from categories c
left join menu_items m on m.category_id = c.id
group by c.id
order by c.sort_order;
