-- Red House Catering — database, file 3 of 4: MENU AND CATEGORIES
-- Run after 02_relations.sql. Safe to re-run.
--
-- Categories (the boxes on the menu page, in this order):
--   1 Beef Meal  2 Chicken Meal  3 Shrimp Meal  4 Tofu  5 Dumpling  6 Rice Noodles  7 Side Orders
--   (8 = Most Popular: not a database row, the menu page adds that box itself)  9 Dine In  10 Outside Catering
-- Dishes: the 17 dishes of the 13/10/2026 menu with their actual prices, numbered 1-17 in the requested display order
--   (3 Beef, 3 Chicken, 1 Shrimp, 2 Tofu, 3 Dumpling, Fried Noodle, Egg Fried Rice, Spring Roll, Mantou, Salad).
--
-- Re-running resets these 17 dishes (matched by English name) to the data below, including price and display
-- order, so edits made in Admin -> Menu items to these dishes are overwritten. Dishes added in the admin and
-- the picture position/size settings (food_scale, food_x ...) are left alone. Order history is not touched.
-- Dine In and Outside Catering start empty: give them dishes in Admin -> Menu items.
-- The Arabic / Urdu / Chinese names of Dine In and Outside Catering are drafts to be confirmed by a native speaker
-- (Admin -> Categories edits them any time).

begin;

-- 1. Categories (matched by key) ---------------------------------------------------------------------
insert into categories (key, label_en, label_ar, label_ur, label_zh, sort_order) values
  ('beef',             'Beef Meal',        'وجبة لحم بقر',   'بیف میل',          '牛肉套餐',     1),
  ('chicken',          'Chicken Meal',     'وجبة دجاج',      'چکن میل',          '鸡肉套餐',     2),
  ('shrimp',           'Shrimp Meal',      'وجبة روبيان',    'جھینگا میل',       '虾仁套餐',     3),
  ('tofu',             'Tofu',             'توفو',           'ٹوفو',             '豆腐',         4),
  ('dumpling',         'Dumpling',         'الزلابية',       'ڈمپلنگ',           '饺子',         5),
  ('rice-noodles',     'Rice Noodles',     'أرز ونودلز',     'رائس نوڈلز',       '米饭与面条',   6),
  ('side-orders',      'Side Orders',      'أطباق جانبية',   'سائیڈ آرڈرز',      '配菜',         7),
  ('dine-in',          'Dine In',          'داخل المطعم',    'ڈائن اِن',         '堂食',         9),
  ('outside-catering', 'Outside Catering', 'تموين خارجي',    'آؤٹ سائیڈ کیٹرنگ', '外部餐饮服务', 10)
on conflict (key) do update set
  label_en   = excluded.label_en,
  label_ar   = excluded.label_ar,
  label_ur   = excluded.label_ur,
  label_zh   = excluded.label_zh,
  sort_order = excluded.sort_order;

-- 2. Dishes (matched by English name) -----------------------------------------------------------------
create temporary table _dishes on commit drop as
select * from (values
  ('beef', 'Mongolian Beef', 'لحم بقر منغولي', 'منگولین بیف', '蒙古牛肉', 'Flank steak, soy sauce, black pepper, scallions, savory sauce glaze.', 'شريحة لحم الخاصرة، صلصة الصويا، فلفل أسود، بصل أخضر مقطع، طبقة طلاء (غليز) من الصلصة.', 'فلینک اسٹیک، سویا ساس، کالی مرچ، ہری پیاز، لذیذ ساس کی گلیز۔', '牛腹肉、酱油、黑胡椒、小葱，浓郁酱汁收汁。', 11.99, null, false, 10, true, 1020, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/9HZDWCwc/Mongolian-Beef.png', 1),
  ('beef', 'Sichuan Crispy Beef', 'لحم بقر سيتشوان المقرمش', 'سیچوان کرسپی بیف', '川味酥脆牛肉', 'Red chili with special Chef''s sauce.', 'فلفل أحمر حار مع صلصة الشيف الخاصة.', 'سرخ مرچ کے ساتھ شیف کی خاص ساس۔', '红辣椒配主厨特制酱汁。', 11.99, null, false, 8, true, 788, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/pBJcrhQW/Sichuan-Crispy-Beef.png', 2),
  ('beef', 'Black Pepper Beef', 'لحم بقر بالفلفل الأسود', 'بلیک پیپر بیف', '黑椒牛肉', 'Flank steak, black pepper, vegetables, glazed chilli soy sauce.', 'شريحة لحم الخاصرة، فلفل أسود، خضروات، صلصة الصويا والفلفل الحار (غليز).', 'فلینک اسٹیک، کالی مرچ، سبزیاں، چلی سویا ساس کی گلیز۔', '牛腹肉、黑胡椒、蔬菜，淋辣味酱油汁。', 11.99, 'https://dveqfyawqztrdvbkrucy.supabase.co/storage/v1/object/public/videos/menu/1791775299926-bbc2add0.png', false, 9, true, 501, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://dveqfyawqztrdvbkrucy.supabase.co/storage/v1/object/public/videos/menu/1791775299926-bbc2add0.png', 3),
  ('chicken', 'Mandarin Pineapple Chicken', 'دجاج بالأناناس المندرينية', 'مینڈرن پائن ایپل چکن', '陈皮菠萝鸡', 'Tender chicken, pineapple, red & green bell pepper, onion, soy sauce.', 'دجاج طري، أناناس، فلفل حلو أحمر وأخضر، بصل، صلصة الصويا.', 'نرم چکن، انناس، سرخ اور ہری شملہ مرچ، پیاز، سویا ساس۔', '嫩鸡肉、菠萝、红绿甜椒、洋葱、酱油。', 10.99, null, false, 8, true, 830, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/Rkg5n3Y8/Mandarin-Pineapple-Chicken.png', 4),
  ('chicken', 'Kung Pao Chicken', 'دجاج كونج باو', 'کنگ پاؤ چکن', '宫保鸡丁', 'Stir-fried chicken, peanuts, red & green bell pepper, chili with Sichuan Kung Pao sauce.', 'دجاج مقلي مع الفول السوداني والفلفل الحلو الأحمر والأخضر والفلفل الحار بصلصة «كونغ باو» على طريقة سيتشوان.', 'تلا ہوا چکن، مونگ پھلی، سرخ اور ہری شملہ مرچ، سیچوان کنگ پاؤ ساس کے ساتھ مرچ۔', '爆炒鸡丁、花生、红绿甜椒、辣椒，配四川宫保酱汁。', 10.99, null, false, 10, true, 1100, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/tMsbPCMf/Kung-Pao-Chicken.png', 5),
  ('chicken', 'Shredded Chicken with Beijing Sauce', 'دجاج مبشور مع صلصة بكين', 'بیجنگ ساس کے ساتھ کٹا ہوا چکن', '京酱鸡丝', 'Shredded chicken with Beijing sauce, served with complimentary pancake.', 'دجاج مبشور مع صلصة بكين، يُقدَّم مع فطيرة بانكيك.', 'بیجنگ ساس کے ساتھ کٹا ہوا چکن، ساتھ مفت پین کیک۔', '京酱鸡丝，附赠薄饼。', 10.99, null, false, 7, true, 780, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/mCxPPzMc/Shredded-Chicken-with-Beijing-Sauce.png', 6),
  ('shrimp', 'Kung Pao Shrimp', 'روبيان كونج باو', 'کنگ پاؤ جھینگا', '宫保虾仁', 'Stir-fried shrimp, peanuts, red & green bell pepper, chili with Sichuan Kung Pao sauce.', 'روبيان مقلي مع الفول السوداني والفلفل الحلو الأحمر والأخضر والفلفل الحار بصلصة «كونغ باو» على طريقة سيتشوان.', 'تلے ہوئے جھینگے، مونگ پھلی، سرخ اور ہری شملہ مرچ، سیچوان کنگ پاؤ ساس کے ساتھ مرچ۔', '爆炒虾仁、花生、红绿甜椒、辣椒，配四川宫保酱汁。', 12.99, null, false, 8, true, 850, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/yc7Tr1YC/Kung-Pao-Shrimp.png', 7),
  ('tofu', 'Roasted Mandarin Tofu', 'توفو مشوي', 'روسٹڈ مینڈرن توفو', '烤陈皮豆腐', 'With savory sauce.', 'مع صلصة غنية بالنكهة.', 'لذیذ ساس کے ساتھ۔', '配美味酱汁。', 9.99, null, false, 5, true, 398, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/2X9nNz8/Roasted-Mandarin-Tofu.png', 8),
  ('tofu', 'Chilli Mapo Tofu', 'مابو توفو', 'چلی مابو توفو', '麻婆豆腐', 'Appetizing silken tofu, minced beef, scallions, with pungent Sichuan sauce.', 'توفو حريري شهي ولحم بقري مفروم، بصل أخضر مع صلصة سيتشوان النفاذة.', 'نرم ریشمی توفو، قیمہ، ہری پیاز، تیز سیچوان ساس کے ساتھ۔', '嫩滑豆腐、牛肉末、小葱，配麻辣川味酱汁。', 9.99, null, false, 7, true, 453, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/HLXKh8vf/Chilli-Mapo-Tofu.png', 9),
  ('dumpling', 'Steamed Dumpling Shrimp', 'الزلابية روبيان', 'اسٹیمڈ ڈمپلنگ جھینگا', '蒸饺（虾仁）', 'Served with chef''s unique sauce, 10 pcs.', 'يُقدَّم مع صلصة الشيف الخاصة، 10 حبات.', 'شیف کی خاص ساس کے ساتھ، 10 عدد۔', '配主厨特制酱汁，10个。', 7.99, null, false, 5, true, null, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/Kpr4rJyg/Steamed-Dumpling-Shrimp.png', 10),
  ('dumpling', 'Steamed Dumpling Chicken', 'الزلابية لحم دجاج', 'اسٹیمڈ ڈمپلنگ چکن', '蒸饺（鸡肉）', 'Served with chef''s unique sauce, 10 pcs.', 'يُقدَّم مع صلصة الشيف الخاصة، 10 حبات.', 'شیف کی خاص ساس کے ساتھ، 10 عدد۔', '配主厨特制酱汁，10个。', 7.99, null, false, 5, true, null, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/Xf6HkcxR/Steamed-Dumpling-Chicken.png', 11),
  ('dumpling', 'Steamed Dumpling Beef', 'الزلابية بقر', 'اسٹیمڈ ڈمپلنگ بیف', '蒸饺（牛肉）', 'Served with chef''s unique sauce, 10 pcs.', 'يُقدَّم مع صلصة الشيف الخاصة، 10 حبات.', 'شیف کی خاص ساس کے ساتھ، 10 عدد۔', '配主厨特制酱汁，10个。', 7.99, null, false, 5, true, null, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/R4BTvVrQ/Steamed-Dumpling-Beef.png', 12),
  ('rice-noodles', 'Vegetable Fried Noodle', 'نودلز مقلية بالخضار', 'ویجیٹیبل فرائیڈ نوڈلز', '蔬菜炒面', 'Chinese noodles, carrots, onion, green bell pepper, cabbage.', 'نودلز صيني، جزر، بصل، فلفل رومي أخضر، ملفوف.', 'چینی نوڈلز، گاجر، پیاز، ہری شملہ مرچ، بند گوبھی۔', '中式面条、胡萝卜、洋葱、青椒、卷心菜。', 9.99, null, false, 6, true, null, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/WpzBVwhq/Vegetable-Fried-Noodle.png', 13),
  ('rice-noodles', 'Egg Fried Rice', 'أرز مقلي بالبيض', 'انڈا فرائیڈ رائس', '蛋炒饭', 'Steamed rice with egg and scallions.', 'أرز مطهو على البخار مع البيض وأوراق البصل.', 'بھاپ میں پکے چاول انڈے اور ہری پیاز کے ساتھ۔', '清蒸米饭配鸡蛋和葱花。', 7.99, null, false, 6, true, null, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/cccc6cZx/Egg-Fried-Rice.png', 14),
  ('side-orders', 'Spring Roll (4pcs)', 'سبرينغ رول', 'اسپرنگ رول (4 عدد)', '春卷（4个）', 'Stuffed with chicken, vegetables, carrot, black mushrooms, and cabbage.', 'محشوة بالدجاج والخضروات والجزر والفطر الأسود والملفوف.', 'چکن، سبزیوں، گاجر، کالے مشروم اور بند گوبھی سے بھرے ہوئے۔', '内馅有鸡肉、蔬菜、胡萝卜、黑木耳和卷心菜。', 7.99, null, false, 5, true, 410, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/Mx0hwrHd/Spring-Roll-4pcs.png', 15),
  ('side-orders', 'Mantou and Mandarin Rolls', 'مانتو ولفائف الماندرين', 'منٹو اور مینڈرن رولز', '馒头和花卷', 'Chinese handmade steamed flower buns.', 'خبز صيني مطهو على البخار ولفائف الماندرين.', 'چینی ہاتھ سے بنے بھاپ میں پکے پھول نما بن۔', '中式手工蒸馒头和花卷。', 7.99, null, false, 4, true, null, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/mrFqqcHW/Mantou-and-Mandarin-Rolls.png', 16),
  ('side-orders', 'Mix Vegetable Salad', 'سلطة خضار مشكلة', 'مکس ویجیٹیبل سلاد', '什锦蔬菜沙拉', 'Fresh lettuce, cabbage, carrot, cucumber and red pepper with house dressing.', 'خس وملفوف وجزر وخيار وفلفل أحمر طازج مع صلصة خاصة.', 'تازہ سلاد پتے، بند گوبھی، گاجر، کھیرا اور سرخ شملہ مرچ، ہاؤس ڈریسنگ کے ساتھ۔', '新鲜生菜、卷心菜、胡萝卜、黄瓜和红椒，配特制酱汁。', 7.99, null, false, 4, true, null, 4.5, 'https://i.postimg.cc/d1RgGcZ7/bg.png', 'https://i.ibb.co/3mk9hjVB/Mix-Vegetable-Salad.png', 17)
) as v(cat_key, name_en, name_ar, name_ur, name_zh,
       description_en, description_ar, description_ur, description_zh,
       price, image_path, is_offer, popularity, is_available,
       calories, rating, bg_image_url, food_png_url, display_order);

-- display numbers are unique: free them first so the dishes can take their numbers in any order
update menu_items m
   set display_order = null
  from _dishes d
 where m.name_en = d.name_en;

update menu_items m
   set category_id    = c.id,
       name_ar        = d.name_ar,
       name_ur        = d.name_ur,
       name_zh        = d.name_zh,
       description_en = d.description_en,
       description_ar = d.description_ar,
       description_ur = d.description_ur,
       description_zh = d.description_zh,
       price          = d.price::numeric,
       image_path     = d.image_path,
       is_offer       = d.is_offer::boolean,
       popularity     = d.popularity::int,
       is_available   = d.is_available::boolean,
       calories       = d.calories::int,
       rating         = d.rating::numeric,
       bg_image_url   = d.bg_image_url,
       food_png_url   = d.food_png_url,
       display_order  = d.display_order::int
  from _dishes d
  join categories c on c.key = d.cat_key
 where m.name_en = d.name_en;

insert into menu_items (
  category_id, name_en, name_ar, name_ur, name_zh,
  description_en, description_ar, description_ur, description_zh,
  price, image_path, is_offer, popularity, is_available,
  calories, rating, bg_image_url, food_png_url, display_order
)
select c.id, d.name_en, d.name_ar, d.name_ur, d.name_zh,
       d.description_en, d.description_ar, d.description_ur, d.description_zh,
       d.price::numeric, d.image_path, d.is_offer::boolean, d.popularity::int, d.is_available::boolean,
       d.calories::int, d.rating::numeric, d.bg_image_url, d.food_png_url, d.display_order::int
  from _dishes d
  join categories c on c.key = d.cat_key
 where not exists (select 1 from menu_items m where m.name_en = d.name_en);

commit;

-- Check: dishes per box -> Beef 3, Chicken 3, Shrimp 1, Tofu 2, Dumpling 3, Rice Noodles 2, Side Orders 3, Dine In 0, Outside Catering 0
select c.sort_order, c.key, c.label_en,
       count(m.id) filter (where m.is_available) as dishes_shown,
       string_agg(m.display_order::text || ' ' || m.name_en, ', ' order by m.display_order) as dishes
  from categories c
  left join menu_items m on m.category_id = c.id
 group by c.id
 order by c.sort_order;
