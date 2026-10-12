-- Red House Catering: menu update requested 12/10/2026 (Emenu_SM.pdf + final_menu.pdf).
-- Run in Supabase -> SQL Editor AFTER db/01 ... db/10. Safe to re-run.
--
-- What it does
--   1. Categories (10 boxes):  1 Beef Meal  2 Chicken Meal  3 Shrimp Meal  4 Tofu  5 Dumpling
--      6 Rice Noodles  7 Side Orders (NEW)  8 Most Popular (virtual, added by the page)
--      9 Dine In  10 Outside Catering
--        - 'tofu'  "Tofu Noodle"      -> "Tofu"
--        - 'soup'  "Soup Rice"        -> "Dumpling"       (key renamed to 'dumpling')
--        - 'salad' "Salad Appetizer"  -> "Rice Noodles"   (key renamed to 'rice-noodles')
--        - 'side-orders' is new
--   2. Exactly 17 dishes are shown: 3 beef, 3 chicken, 1 shrimp, 2 tofu, 3 dumplings, 1 noodle,
--      1 rice, 1 spring roll, 1 mantou, 1 salad. Names, English + Arabic descriptions and calories
--      come from final_menu.pdf.
--   3. Dishes that are no longer on the menu are hidden (is_available = false), NOT deleted, so
--      order history and carts keep working. Re-enable any of them in Admin -> Menu items.
--
-- Not touched: prices of existing dishes, popularity, ratings, orders, carts.
-- Images: dishes whose DISH changed (ids 3, 6, 9) have their old photo cleared so a wrong picture
-- is never shown. Upload the new photos for those three in Admin -> Menu items.
--
-- !! After this, do NOT re-run db/03_insert_menu.sql or db/10_nine_categories.sql: they would
-- !! bring back the old category names and old dishes.
-- !! Prices of the 4 NEW dishes are placeholders (marked below). Confirm them with the client.
-- !! The page itself must also move "Most Popular" from position 7 to 8 (POPULAR_SORT_ORDER in
-- !! frontend/menu-page.html), and show description_ar in Arabic (see notes sent with this file).

begin;

-- ---------------------------------------------------------------------------------------------
-- 0. Guard: the 13 existing dishes this script updates must be the baseline rows from db/03.
--    If someone deleted/re-numbered them, stop here and change nothing.
-- ---------------------------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from menu_items where id in (1,2,3,4,5,6,7,8,9,12,13,16,18);
  if n <> 13 then
    raise exception 'Expected 13 baseline dishes (ids 1-9, 12, 13, 16, 18), found %. Nothing was changed.', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------------------------------
-- keep the same rows (same ids, so dishes stay attached) but give them their new keys
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
  ('dumpling',         'Dumpling',         'دامبلينغ',       'ڈمپلنگ',           '饺子',         5),
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

-- ---------------------------------------------------------------------------------------------
-- 2a. Existing dishes: new names / category / descriptions / calories (matched by id)
-- ---------------------------------------------------------------------------------------------
update menu_items m set
  category_id    = c.id,
  name_en        = v.name_en,
  name_ar        = v.name_ar,
  name_ur        = v.name_ur,
  name_zh        = v.name_zh,
  description_en = v.description_en,
  description_ar = v.description_ar,
  calories       = v.calories,
  is_available   = true
from (values
  -- id, category, name_en, name_ar, name_ur, name_zh, description_en, description_ar, calories
  (1,  'beef',    'Black Pepper Beef',
       'لحم بقر بالفلفل الأسود', 'بلیک پیپر بیف', '黑椒牛肉',
       'Flank steak, black pepper, vegetables, glazed chilli soy sauce.',
       'شريحة لحم الخاصرة، فلفل أسود، خضروات، صلصة الصويا والفلفل الحار (غلايز).', 501),
  (2,  'beef',    'Mongolian Beef',
       'لحم بقر منغولي', 'منگولین بیف', '蒙古牛肉',
       'Flank steak, soy sauce, black pepper, scallions, savory sauce glaze.',
       'شريحة لحم الخاصرة، صلصة الصويا، فلفل أسود، بصل أخضر مقطع، وطبقة لامعة (غلايز) من الصلصة الشهية.', 1020),
  (3,  'beef',    'Sichuan Crispy Beef',
       'لحم بقر سيتشوان المقرمش', 'سیچوان کرسپی بیف', '四川香酥牛肉',
       'Red chili with special Chef''s sauce.',
       'فلفل أحمر حار مع صلصة الشيف الخاصة.', 788),

  (7,  'chicken', 'Kung Pao Chicken',
       'دجاج كونج باو', 'کنگ پاؤ چکن', '宫保鸡丁',
       'Stir-fried chicken, peanuts, red & green bell pepper, chili with Sichuan Kung Pao sauce.',
       'دجاج مقلي مع الفول السوداني والفلفل الحلو الأحمر والأخضر والفلفل الحار بصلصة «كونغ باو» على طريقة سيتشوان.', 1100),
  (8,  'chicken', 'Mandarin Pineapple Chicken',
       'دجاج بالأناناس المندرينية', 'مینڈرن پائن ایپل چکن', '陈皮菠萝鸡',
       'Tender chicken, pineapple, red & green bell pepper, onion, soy sauce.',
       'دجاج طري وأناناس وفلفل حلو أحمر وأخضر وبصل وصلصة الصويا.', 830),
  (9,  'chicken', 'Shredded Chicken with Beijing Sauce',
       'دجاج مبشور مع صلصة بكين', 'بیجنگ ساس کے ساتھ شریڈڈ چکن', '京酱鸡丝',
       'Served with complimentary pancake.',
       'يُقدَّم مع فطيرة بانكيك مجانية.', 780),

  (13, 'shrimp',  'Kung Pao Shrimp',
       'روبيان كونج باو', 'کنگ پاؤ جھینگا', '宫保虾仁',
       'Stir-fried shrimp, peanuts, red & green bell pepper, chili with Sichuan Kung Pao sauce.',
       'روبيان مقلي مع الفول السوداني والفلفل الحلو الأحمر والأخضر والفلفل الحار بصلصة «كونغ باو» على طريقة سيتشوان.', 850),

  (4,  'tofu',    'Roasted Mandarin Tofu',
       'توفو مشوي', 'روسٹڈ مینڈرن توفو', '烤陈皮豆腐',
       'With savory sauce.',
       'مع صلصة غنية بالنكهة.', 398),
  (5,  'tofu',    'Chilli Mapo Tofu',
       'مابو توفو', 'چلی ماپو توفو', '麻婆豆腐',
       'Appetizing silken tofu, minced beef, scallions, with pungent Sichuan sauce.',
       'توفو حريري شهي ولحم بقري مفروم وبصل أخضر مع صلصة سيتشوان النفاذة.', 453),

  (6,  'rice-noodles', 'Vegetable Fried Noodle',
       'نودلز مقلية بالخضار', 'ویجیٹیبل فرائیڈ نوڈلز', '蔬菜炒面',
       'Chinese noodles, carrots, onion, green bell pepper, cabbage.',
       'نودلز صيني وجزر وبصل وفلفل رومي أخضر وملفوف.', null),
  (12, 'rice-noodles', 'Egg Fried Rice',
       'أرز مقلي بالبيض', 'انڈا فرائیڈ رائس', '蛋炒饭',
       'Steamed rice with egg and scallions.',
       'أرز مطهو على البخار مع البيض والبصل الأخضر.', null),

  (16, 'side-orders', 'Spring Roll (4 pcs)',
       'سبرينغ رول (4 قطع)', 'اسپرنگ رول (4 پیس)', '春卷（4个）',
       'Stuffed with chicken, vegetables, carrot, black mushrooms, and cabbage.',
       'محشوة بالدجاج والخضروات والجزر والفطر الأسود والملفوف.', 410),
  -- the PDF gives no description / Arabic text / calories for the salad
  (18, 'side-orders', 'Mix Vegetable Salad',
       'سلطة خضار مشكلة', 'مکس ویجیٹیبل سلاد', '什锦蔬菜沙拉',
       null, null, null)
) as v(id, cat_key, name_en, name_ar, name_ur, name_zh, description_en, description_ar, calories)
join categories c on c.key = v.cat_key
where m.id = v.id;

-- the dish itself changed for ids 3, 6, 9: clear the old photo so a wrong picture is never shown
update menu_items
   set image_path = null, bg_image_url = null, food_png_url = null
 where id in (3, 6, 9);

-- ---------------------------------------------------------------------------------------------
-- 2b. New dishes (3 dumplings + mantou). Prices are PLACEHOLDERS - confirm with the client.
--     Matched by English name so a re-run does not create duplicates.
-- ---------------------------------------------------------------------------------------------
insert into menu_items (
  category_id, name_en, name_ar, name_ur, name_zh,
  description_en, description_ar, price, calories, rating, popularity, is_offer, is_available
)
select c.id, v.name_en, v.name_ar, v.name_ur, v.name_zh,
       v.description_en, v.description_ar, v.price, null, null, v.popularity, false, true
from (values
  ('dumpling',    'Steamed Dumpling Chicken', 'دامبلينغ بالدجاج', 'چکن ڈمپلنگ',   '蒸鸡肉饺子',
   'Served with chef''s unique sauce. 10 pcs.', 'يُقدَّم مع صلصة الشيف الخاصة. 10 حبات.', 8.99::numeric, 6),   -- PLACEHOLDER PRICE
  ('dumpling',    'Steamed Dumpling Beef',    'دامبلينغ بالبقر',  'بیف ڈمپلنگ',   '蒸牛肉饺子',
   'Served with chef''s unique sauce. 10 pcs.', 'يُقدَّم مع صلصة الشيف الخاصة. 10 حبات.', 8.99::numeric, 5),   -- PLACEHOLDER PRICE
  ('dumpling',    'Steamed Dumpling Shrimp',  'دامبلينغ بالروبيان','جھینگا ڈمپلنگ','蒸虾仁饺子',
   'Served with chef''s unique sauce. 10 pcs.', 'يُقدَّم مع صلصة الشيف الخاصة. 10 حبات.', 8.99::numeric, 5),   -- PLACEHOLDER PRICE
  ('side-orders', 'Mantou and Mandarin Rolls', 'مانتو ولفائف الماندرين', 'مانتو اور مینڈرن رولز', '馒头与橘子卷',
   'Chinese handmade steamed flower buns.', 'خبز صيني مصنوع يدويًا ومطهو على البخار على شكل زهرة.', 4.99::numeric, 4)  -- PLACEHOLDER PRICE
) as v(cat_key, name_en, name_ar, name_ur, name_zh, description_en, description_ar, price, popularity)
join categories c on c.key = v.cat_key
where not exists (select 1 from menu_items x where x.name_en = v.name_en);

-- ---------------------------------------------------------------------------------------------
-- 3. Dishes removed from the menu: hidden, not deleted
--    10 Wonton Soup, 11 Vegetable Fried Rice, 14 Sweet & Sour Shrimp,
--    15 New Style Shrimp Spicy, 17 Thai Chicken Salad
-- ---------------------------------------------------------------------------------------------
update menu_items set is_available = false where id in (10, 11, 14, 15, 17);

commit;

-- ---------------------------------------------------------------------------------------------
-- Check: should list 10 boxes' worth of rows (Most Popular is virtual) and 17 dishes in total
--   Beef 3, Chicken 3, Shrimp 1, Tofu 2, Dumpling 3, Rice Noodles 2, Side Orders 3,
--   Dine In 0, Outside Catering 0
-- ---------------------------------------------------------------------------------------------
select c.sort_order, c.key, c.label_en,
       count(m.id) filter (where m.is_available) as dishes_shown
from categories c
left join menu_items m on m.category_id = c.id
group by c.id
order by c.sort_order;
