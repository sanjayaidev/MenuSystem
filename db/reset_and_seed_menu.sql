-- ============================================================
-- Reset & reseed menu data (categories + menu_items) so the
-- Supabase tables match frontend/homepage.html exactly.
--
-- Run this in Supabase: Project > SQL Editor > New query.
-- Safe to re-run any time — it fully clears menu_items and
-- categories first, then reseeds from scratch.
--
-- NOTE: this does NOT touch orders / order_items / profiles.
-- Existing orders keep their name/price snapshot; their
-- order_items.menu_item_id will just be set to NULL (the FK
-- is ON DELETE SET NULL), since the old menu_item ids go away.
-- ============================================================

begin;

-- ---------- 1. wipe existing menu data ----------
-- menu_items must go first (categories has ON DELETE RESTRICT)
delete from menu_items;
delete from categories;

-- keep identity sequences sane after a manual wipe
alter sequence if exists categories_id_seq restart with 1;
alter sequence if exists menu_items_id_seq restart with 1;

-- ---------- 2. make sure the extra columns exist ----------
-- (harmless if already present)
alter table menu_items add column if not exists calories int;
alter table menu_items add column if not exists rating numeric(2,1);

-- ---------- 3. categories, matching CATS in homepage.html ----------
insert into categories (key, label_en, label_ar, label_ur, label_zh, sort_order) values
  ('beef',    'Beef Meal',          'وجبة لحم بقر',        'بیف میل',              '牛肉套餐',   1),
  ('chicken', 'Chicken Meal',       'وجبة دجاج',           'چکن میل',              '鸡肉套餐',   2),
  ('shrimp',  'Shrimp Meal',        'وجبة روبيان',         'جھینگا میل',           '虾仁套餐',   3),
  ('tofu',    'Tofu & Noodle',      'توفو ونودلز',         'توفو اور نوڈلز',       '豆腐面食',   4),
  ('soup',    'Soup & Rice',        'شوربة وأرز',          'سوپ اور چاول',         '汤与米饭',   5),
  ('salad',   'Salad & Appetizer',  'سلطة ومقبلات',        'سلاد اور شروعات',      '沙拉与开胃菜', 6);

-- ---------- 4. menu items, matching ITEMS in homepage.html ----------
-- ids are forced to 1-18 (overriding system value) so they line up
-- with the ids the frontend currently hardcodes.
-- description_en is the real ingredient line from the physical menu photo.
insert into menu_items (id, category_id, name_en, name_ar, name_ur, name_zh, description_en, price, calories, rating, popularity, is_offer)
overriding system value
select v.id, c.id, v.name_en, v.name_ar, v.name_ur, v.name_zh, v.description_en, v.price, v.calories, v.rating, v.popularity, v.is_offer
from (values
  (1,  'beef',    'Black Pepper Beef',          'لحم بقر بالفلفل الأسود',       'بلیک پیپر بیف',         '黑椒牛肉',   'Tender beef strips, bell peppers, onions, crushed black pepper, soy-garlic glaze', 11.99, 780,  4.6, 9,  false),
  (2,  'beef',    'Mongolian Beef',             'لحم بقر منغولي',               'منگولین بیف',            '蒙古牛肉',   'Flank steak, scallions, garlic, ginger, sweet soy reduction, sesame seeds', 11.99, 1020, 4.9, 10, true),
  (3,  'beef',    'Stir Fried Beef With Chili', 'لحم بقر مقلي بالفلفل الحار',   'مرچ کے ساتھ بیف',        '辣椒炒牛肉', 'Sliced beef, fresh red chilies, garlic shoots, soy sauce, sesame oil', 11.99, 850,  4.4, 6,  false),
  (4,  'tofu',    'Mandarin Tofu',              'توفو ماندرين',                 'مینڈرن توفو',            '陈皮豆腐',   'Crispy tofu cubes, sweet mandarin orange sauce, green onions, sesame seeds', 9.99,  520,  4.2, 4,  false),
  (5,  'tofu',    'Tofu With Minced Beef',      'توفو مع لحم مفروم',            'قیمہ کے ساتھ توفو',      '肉末豆腐',   'Soft tofu, ground beef, chili bean paste, Sichuan pepper, garlic, scallions', 9.99,  610,  4.3, 5,  false),
  (6,  'tofu',    'Chicken Fried Noodle',       'نودلز دجاج مقلية',             'چکن فرائیڈ نوڈلز',       '鸡肉炒面',   'Egg noodles, shredded chicken, cabbage, carrots, bean sprouts, savory soy sauce', 9.99,  720,  4.5, 7,  false),
  (7,  'chicken', 'Kung Pao Chicken',           'دجاج كونغ باو',                'کنگ پاؤ چکن',            '宫保鸡丁',   'Diced chicken, peanuts, dried chili peppers, zucchini, Sichuan pepper glaze', 10.99, 890,  4.8, 10, true),
  (8,  'chicken', 'Pineapple Chicken',          'دجاج بالأناناس',               'انناس چکن',              '菠萝鸡',     'Crispy chicken bites, fresh pineapple chunks, bell peppers, sweet & tangy glaze', 10.99, 760,  4.5, 8,  false),
  (9,  'chicken', 'Sweet & Sour Chicken',       'دجاج بالحلو والحامض',          'میٹھا اور کھٹا چکن',     '糖醋鸡',     'Batter-fried chicken, bell peppers, onions, pineapple, classic sweet & sour sauce', 10.99, 810,  4.6, 9,  false),
  (10, 'soup',    'Wonton Soup',                'شوربة ونتون',                  'وونٹن سوپ',              '馄饨汤',     'Pork & shrimp wontons, clear chicken broth, bok choy, green onions, sesame oil', 8.99,  340,  4.3, 5,  false),
  (11, 'soup',    'Vegetable Fried Rice',       'أرز مقلي بالخضار',             'ویجیٹیبل فرائیڈ رائس',   '蔬菜炒饭',   'Jasmine rice, carrots, green peas, corn, spring onions, light soy sauce', 8.99,  610,  4.1, 6,  false),
  (12, 'soup',    'Egg Fried Rice',             'أرز مقلي بالبيض',              'انڈا فرائیڈ رائس',       '蛋炒饭',     'Wok-fried jasmine rice, scrambled eggs, scallions, butter, light soy sauce', 8.99,  640,  4.2, 7,  false),
  (13, 'shrimp',  'Shrimp With Garlic Sauce',   'روبيان بصلصة الثوم',           'لہسن ساس کے ساتھ جھینگا', '蒜香虾',    'Succulent shrimp, minced garlic, wood ear mushrooms, water chestnuts, sweet chili glaze', 12.99, 680,  4.5, 7,  false),
  (14, 'shrimp',  'Sweet & Sour Shrimp',        'روبيان بالحلو والحامض',        'میٹھا اور کھٹا جھینگا',   '糖醋虾',    'Tempura shrimp, pineapple, bell peppers, onions, tangy sweet & sour sauce', 12.99, 700,  4.4, 6,  false),
  (15, 'shrimp',  'New Style Shrimp Spicy',     'روبيان حار بالطريقة الجديدة',  'نیو اسٹائل اسپائسی جھینگا','新派麻辣虾', 'Jumbo shrimp, chili oil, garlic, scallions, spicy chili paste, cilantro', 12.99, 730,  4.7, 8,  true),
  (16, 'salad',   'Spring Roll',                'سبرينغ رول',                   'اسپرنگ رول',              '春卷',      'Crispy pastry shell, shredded cabbage, carrots, glass noodles, sweet chili dipping sauce', 7.99,  310,  4.3, 5,  false),
  (17, 'salad',   'Thai Chicken Salad',         'سلطة دجاج تايلاندية',          'تھائی چکن سلاد',          '泰式鸡肉沙拉', 'Grilled chicken, shredded cabbage, carrots, cilantro, crushed peanuts, thai peanut dressing', 7.99, 420,  4.4, 6,  false),
  (18, 'salad',   'Green Salad',                'سلطة خضراء',                   'گرین سلاد',               '绿色沙拉',   'Fresh mixed greens, cucumbers, cherry tomatoes, carrots, house sesame vinaigrette', 7.99,  180,  4.0, 3,  false)
) as v(id, cat_key, name_en, name_ar, name_ur, name_zh, description_en, price, calories, rating, popularity, is_offer)
join categories c on c.key = v.cat_key;

-- keep the identity sequence ahead of the ids we just inserted manually
select setval(pg_get_serial_sequence('menu_items','id'), 18, true);
select setval(pg_get_serial_sequence('categories','id'), 6, true);

commit;

-- ---------- sanity check ----------
select c.key as category, c.sort_order, count(*) as items
from menu_items m join categories c on c.id = m.category_id
group by c.key, c.sort_order
order by c.sort_order;
