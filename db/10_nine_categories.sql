-- Red House Catering: the nine category boxes on the menu page.
-- Run after db/03_insert_menu.sql (safe to re-run; menu items and orders are not touched).
--
--   1 Beef Meal   2 Chicken Meal   3 Shrimp Meal   4 Tofu Noodle   5 Soup Rice
--   6 Salad Appetizer   7 Most Popular   8 Dine In   9 Outside Catering
--
-- "Most Popular" (7) is not a database row: the menu page adds that box itself and fills it with the
-- best-selling dishes. This script renames the six food categories to the client's wording and adds
-- Dine In and Outside Catering as normal categories. They start empty: assign dishes to them in
-- Admin -> Menu items (a dish belongs to one category) or rename / re-order them in Admin -> Categories.
--
-- The Arabic, Urdu and Chinese names of Dine In and Outside Catering are first drafts: please have a
-- native speaker confirm them (Admin -> Categories lets you edit them any time).

begin;

insert into categories (key, label_en, label_ar, label_ur, label_zh, sort_order) values
  ('beef',             'Beef Meal',         'وجبة لحم بقر',   'بیف میل',          '牛肉套餐',     1),
  ('chicken',          'Chicken Meal',      'وجبة دجاج',      'چکن میل',          '鸡肉套餐',     2),
  ('shrimp',           'Shrimp Meal',       'وجبة روبيان',    'جھینگا میل',       '虾仁套餐',     3),
  ('tofu',             'Tofu Noodle',       'توفو ونودلز',    'توفو اور نوڈلز',   '豆腐面食',     4),
  ('soup',             'Soup Rice',         'شوربة وأرز',     'سوپ اور چاول',     '汤与米饭',     5),
  ('salad',            'Salad Appetizer',   'سلطة ومقبلات',   'سلاد اور شروعات',  '沙拉与开胃菜', 6),
  ('dine-in',          'Dine In',           'داخل المطعم',    'ڈائن اِن',         '堂食',         8),
  ('outside-catering', 'Outside Catering',  'تموين خارجي',    'آؤٹ سائیڈ کیٹرنگ', '外部餐饮服务', 9)
on conflict (key) do update set
  label_en = excluded.label_en,
  label_ar = excluded.label_ar,
  label_ur = excluded.label_ur,
  label_zh = excluded.label_zh,
  sort_order = excluded.sort_order;

commit;
