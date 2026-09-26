-- ============================================================
-- Run AFTER db/schema.sql. Adds columns the item modal needs,
-- then seeds the 18 real menu items so their auto-generated ids
-- (1–18) line up exactly with the client-side ITEMS array ids in
-- homepage.html — same category order: beef, tofu, chicken, soup,
-- shrimp, salad, 3 items each.
-- ============================================================

alter table menu_items add column if not exists calories int;
alter table menu_items add column if not exists rating numeric(2,1);

-- category price lookup used below: beef 11.99, tofu 9.99, chicken 10.99,
-- soup 8.99, shrimp 12.99, salad 7.99 (matches CATS in homepage.html)

insert into menu_items (id, category_id, name_en, name_ar, name_ur, name_zh, price, calories, rating, popularity, is_offer)
overriding system value
select v.id, c.id, v.name_en, v.name_ar, v.name_ur, v.name_zh, v.price, v.calories, v.rating, v.popularity, v.is_offer
from (values
  (1, 'beef', 'Black Pepper Beef', 'لحم بقر بالفلفل الأسود', 'بلیک پیپر بیف', '黑椒牛肉', 11.99, 780, 4.6, 9, false),
  (2, 'beef', 'Mongolian Beef', 'لحم بقر منغولي', 'منگولین بیف', '蒙古牛肉', 11.99, 1020, 4.9, 10, true),
  (3, 'beef', 'Stir Fried Beef With Chili', 'لحم بقر مقلي بالفلفل الحار', 'مرچ کے ساتھ بیف', '辣椒炒牛肉', 11.99, 850, 4.4, 6, false),
  (4, 'tofu', 'Mandarin Tofu', 'توفو ماندرين', 'مینڈرن توفو', '陈皮豆腐', 9.99, 520, 4.2, 4, false),
  (5, 'tofu', 'Tofu With Minced Beef', 'توفو مع لحم مفروم', 'قیمہ کے ساتھ توفو', '肉末豆腐', 9.99, 610, 4.3, 5, false),
  (6, 'tofu', 'Chicken Fried Noodle', 'نودلز دجاج مقلية', 'چکن فرائیڈ نوڈلز', '鸡肉炒面', 9.99, 720, 4.5, 7, false),
  (7, 'chicken', 'Kung Pao Chicken', 'دجاج كونغ باو', 'کنگ پاؤ چکن', '宫保鸡丁', 10.99, 890, 4.8, 10, true),
  (8, 'chicken', 'Pineapple Chicken', 'دجاج بالأناناس', 'انناس چکن', '菠萝鸡', 10.99, 760, 4.5, 8, false),
  (9, 'chicken', 'Sweet & Sour Chicken', 'دجاج بالحلو والحامض', 'میٹھا اور کھٹا چکن', '糖醋鸡', 10.99, 810, 4.6, 9, false),
  (10, 'soup', 'Wonton Soup', 'شوربة ونتون', 'وونٹن سوپ', '馄饨汤', 8.99, 340, 4.3, 5, false),
  (11, 'soup', 'Vegetable Fried Rice', 'أرز مقلي بالخضار', 'ویجیٹیبل فرائیڈ رائس', '蔬菜炒饭', 8.99, 610, 4.1, 6, false),
  (12, 'soup', 'Egg Fried Rice', 'أرز مقلي بالبيض', 'انڈا فرائیڈ رائس', '蛋炒饭', 8.99, 640, 4.2, 7, false),
  (13, 'shrimp', 'Shrimp With Garlic Sauce', 'روبيان بصلصة الثوم', 'لہسن ساس کے ساتھ جھینگا', '蒜香虾', 12.99, 680, 4.5, 7, false),
  (14, 'shrimp', 'Sweet & Sour Shrimp', 'روبيان بالحلو والحامض', 'میٹھا اور کھٹا جھینگا', '糖醋虾', 12.99, 700, 4.4, 6, false),
  (15, 'shrimp', 'New Style Shrimp Spicy', 'روبيان حار بالطريقة الجديدة', 'نیو اسٹائل اسپائسی جھینگا', '新派麻辣虾', 12.99, 730, 4.7, 8, true),
  (16, 'salad', 'Spring Roll', 'سبرينغ رول', 'اسپرنگ رول', '春卷', 7.99, 310, 4.3, 5, false),
  (17, 'salad', 'Thai Chicken Salad', 'سلطة دجاج تايلاندية', 'تھائی چکن سلاد', '泰式鸡肉沙拉', 7.99, 420, 4.4, 6, false),
  (18, 'salad', 'Green Salad', 'سلطة خضراء', 'گرین سلاد', '绿色沙拉', 7.99, 180, 4.0, 3, false)
) as v(id, cat_key, name_en, name_ar, name_ur, name_zh, price, calories, rating, popularity, is_offer)
join categories c on c.key = v.cat_key;

-- keep the identity sequence ahead of the ids we just inserted manually,
-- otherwise the next auto-generated insert could collide with id 1-18.
select setval(pg_get_serial_sequence('menu_items','id'), 18, true);
