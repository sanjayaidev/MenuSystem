-- Red House Catering: baseline categories and 18 menu items.
-- Run after 01_create_tables.sql and 02_rls_and_constraints.sql.
-- Re-running updates these records without clearing order history.

begin;

insert into categories (key, label_en, label_ar, label_ur, label_zh, sort_order) values
  ('beef',    'Beef Meal',         'وجبة لحم بقر',       'بیف میل',                '牛肉套餐',     1),
  ('chicken', 'Chicken Meal',      'وجبة دجاج',          'چکن میل',                '鸡肉套餐',     2),
  ('shrimp',  'Shrimp Meal',       'وجبة روبيان',        'جھینگا میل',             '虾仁套餐',     3),
  ('tofu',    'Tofu & Noodle',     'توفو ونودلز',        'توفو اور نوڈلز',         '豆腐面食',     4),
  ('soup',    'Soup & Rice',       'شوربة وأرز',         'سوپ اور چاول',           '汤与米饭',     5),
  ('salad',   'Salad & Appetizer', 'سلطة ومقبلات',       'سلاد اور شروعات',        '沙拉与开胃菜', 6)
on conflict (key) do update set
  label_en = excluded.label_en,
  label_ar = excluded.label_ar,
  label_ur = excluded.label_ur,
  label_zh = excluded.label_zh,
  sort_order = excluded.sort_order;

insert into menu_items (
  id, category_id, name_en, name_ar, name_ur, name_zh,
  description_en, price, calories, rating, popularity, is_offer
)
overriding system value
select v.id, c.id, v.name_en, v.name_ar, v.name_ur, v.name_zh,
       v.description_en, v.price, v.calories, v.rating, v.popularity, v.is_offer
from (values
  (1,  'beef',    'Black Pepper Beef',          'لحم بقر بالفلفل الأسود',        'بلیک پیپر بیف',          '黑椒牛肉',       'Tender beef strips, bell peppers, onions, crushed black pepper, soy-garlic glaze', 11.99,  780, 4.6,  9, false),
  (2,  'beef',    'Mongolian Beef',             'لحم بقر منغولي',                'منگولین بیف',             '蒙古牛肉',       'Flank steak, scallions, garlic, ginger, sweet soy reduction, sesame seeds', 11.99, 1020, 4.9, 10, true),
  (3,  'beef',    'Stir Fried Beef With Chili', 'لحم بقر مقلي بالفلفل الحار',    'مرچ کے ساتھ بیف',         '辣椒炒牛肉',     'Sliced beef, fresh red chilies, garlic shoots, soy sauce, sesame oil', 11.99,  850, 4.4,  6, false),
  (4,  'tofu',    'Mandarin Tofu',              'توفو ماندرين',                  'مینڈرن توفو',             '陈皮豆腐',       'Crispy tofu cubes, sweet mandarin orange sauce, green onions, sesame seeds', 9.99,  520, 4.2,  4, false),
  (5,  'tofu',    'Tofu With Minced Beef',      'توفو مع لحم مفروم',             'قیمہ کے ساتھ توفو',       '肉末豆腐',       'Soft tofu, ground beef, chili bean paste, Sichuan pepper, garlic, scallions', 9.99,  610, 4.3,  5, false),
  (6,  'tofu',    'Chicken Fried Noodle',       'نودلز دجاج مقلية',              'چکن فرائیڈ نوڈلز',        '鸡肉炒面',       'Egg noodles, shredded chicken, cabbage, carrots, bean sprouts, savory soy sauce', 9.99,  720, 4.5,  7, false),
  (7,  'chicken', 'Kung Pao Chicken',           'دجاج كونغ باو',                 'کنگ پاؤ چکن',             '宫保鸡丁',       'Diced chicken, peanuts, dried chili peppers, zucchini, Sichuan pepper glaze', 10.99, 890, 4.8, 10, true),
  (8,  'chicken', 'Pineapple Chicken',          'دجاج بالأناناس',               'انناس چکن',               '菠萝鸡',         'Crispy chicken bites, fresh pineapple chunks, bell peppers, sweet & tangy glaze', 10.99, 760, 4.5,  8, false),
  (9,  'chicken', 'Sweet & Sour Chicken',       'دجاج بالحلو والحامض',          'میٹھا اور کھٹا چکن',      '糖醋鸡',         'Batter-fried chicken, bell peppers, onions, pineapple, classic sweet & sour sauce', 10.99, 810, 4.6,  9, false),
  (10, 'soup',    'Wonton Soup',                'شوربة ونتون',                  'وونٹن سوپ',               '馄饨汤',         'Pork & shrimp wontons, clear chicken broth, bok choy, green onions, sesame oil', 8.99,  340, 4.3,  5, false),
  (11, 'soup',    'Vegetable Fried Rice',       'أرز مقلي بالخضار',             'ویجیٹیبل فرائیڈ رائس',    '蔬菜炒饭',       'Jasmine rice, carrots, green peas, corn, spring onions, light soy sauce', 8.99,  610, 4.1,  6, false),
  (12, 'soup',    'Egg Fried Rice',             'أرز مقلي بالبيض',              'انڈا فرائیڈ رائس',        '蛋炒饭',         'Wok-fried jasmine rice, scrambled eggs, scallions, butter, light soy sauce', 8.99,  640, 4.2,  7, false),
  (13, 'shrimp',  'Shrimp With Garlic Sauce',   'روبيان بصلصة الثوم',           'لہسن ساس کے ساتھ جھینگا', '蒜香虾',         'Succulent shrimp, minced garlic, wood ear mushrooms, water chestnuts, sweet chili glaze', 12.99, 680, 4.5, 7, false),
  (14, 'shrimp',  'Sweet & Sour Shrimp',        'روبيان بالحلو والحامض',         'میٹھا اور کھٹا جھینگا',   '糖醋虾',         'Tempura shrimp, pineapple, bell peppers, onions, tangy sweet & sour sauce', 12.99, 700, 4.4, 6, false),
  (15, 'shrimp',  'New Style Shrimp Spicy',     'روبيان حار بالطريقة الجديدة',  'نیو اسٹائل اسپائسی جھینگا','新派麻辣虾',     'Jumbo shrimp, chili oil, garlic, scallions, spicy chili paste, cilantro', 12.99, 730, 4.7, 8, true),
  (16, 'salad',   'Spring Roll',                'سبرينغ رول',                   'اسپرنگ رول',              '春卷',           'Crispy pastry shell, shredded cabbage, carrots, glass noodles, sweet chili dipping sauce', 7.99, 310, 4.3, 5, false),
  (17, 'salad',   'Thai Chicken Salad',         'سلطة دجاج تايلاندية',          'تھائی چکن سلاد',          '泰式鸡肉沙拉',   'Grilled chicken, shredded cabbage, carrots, cilantro, crushed peanuts, thai peanut dressing', 7.99, 420, 4.4, 6, false),
  (18, 'salad',   'Green Salad',                'سلطة خضراء',                   'گرین سلاد',               '绿色沙拉',       'Fresh mixed greens, cucumbers, cherry tomatoes, carrots, house sesame vinaigrette', 7.99, 180, 4.0, 3, false)
) as v(id, cat_key, name_en, name_ar, name_ur, name_zh, description_en, price, calories, rating, popularity, is_offer)
join categories c on c.key = v.cat_key
on conflict (id) do update set
  category_id = excluded.category_id,
  name_en = excluded.name_en,
  name_ar = excluded.name_ar,
  name_ur = excluded.name_ur,
  name_zh = excluded.name_zh,
  description_en = excluded.description_en,
  price = excluded.price,
  calories = excluded.calories,
  rating = excluded.rating,
  popularity = excluded.popularity,
  is_offer = excluded.is_offer;

select setval(pg_get_serial_sequence('categories', 'id'), coalesce(max(id), 1), max(id) is not null)
from categories;
select setval(pg_get_serial_sequence('menu_items', 'id'), coalesce(max(id), 1), max(id) is not null)
from menu_items;

commit;