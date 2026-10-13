-- 13/10/2026 menu update: every dish costs 39 (the menu page shows it as "39", no decimals).
-- Run in Supabase SQL Editor. Only menu_items.price is changed; past orders keep the price they were placed at.
-- Safe to re-run. To exclude a dish (for example Dine In / Outside Catering items), add: and id not in (...)

update menu_items
   set price = 39;

-- Check
select id, name_en, price from menu_items order by id;
