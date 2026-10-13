-- Red House Catering — database, file 4 of 4: SITE DATA
-- Contact details (WhatsApp numbers, address, map link) and the menu texts / language settings.
-- Run after 03_menu_and_categories.sql. Safe to re-run: values already saved from the admin are never
-- overwritten (a missing value is added, an existing one is kept).
-- Everything here can be edited later in the admin: Contact tab, Menu design tab.
--
-- Not stored here (the admin creates these when you upload them): menu poster (key menu_poster),
-- background music (key music), custom menu font (inside menu_design), Special section videos.

-- 1. Contact details (shown when customers tap the call button) -------------------------------------
insert into site_settings (key, value)
values (
  'contact',
  '{
    "phone":   "056 928 3982",
    "phone2":  "00966 56 928 3982",
    "address": "",
    "mapUrl":  "https://maps.app.goo.gl/SPNMnoHksw7VcNu66"
  }'::jsonb
)
on conflict (key) do update
  set value = excluded.value || site_settings.value;

-- 2. Menu design: language font / size and the "This meal automatically includes" text --------------
--   lang_style.size_add  extra px added to every text size on the menu page for that language
--                        (Arabic is 2 px bigger); font '' = the built-in font of the language
--   includes_text        text under "This meal automatically includes:" on every dish; an empty text
--                        uses the translation built into the menu page (same wording as below).
--                        The Arabic, Urdu and Chinese texts are drafts to be confirmed by a native speaker.
insert into site_settings (key, value)
values (
  'menu_design',
  '{
    "font_style": "cinzel",
    "font_size":  14,
    "font_color": "#2b2622",
    "lang_style": {
      "en": {"size_add": 0, "font": ""},
      "ar": {"size_add": 2, "font": ""},
      "ur": {"size_add": 0, "font": ""},
      "zh": {"size_add": 0, "font": ""}
    },
    "includes_text": {
      "en": "Seaweed Soup, Fried Egg Rice, Noodles, Salad & Water",
      "ar": "شوربة أعشاب البحر، أرز مقلي بالبيض، نودلز، سلطة وماء",
      "ur": "سمندری کائی کا سوپ، انڈے والے فرائیڈ رائس، نوڈلز، سلاد اور پانی",
      "zh": "紫菜汤、蛋炒饭、面条、沙拉和水"
    }
  }'::jsonb
)
on conflict (key) do update
  set value = excluded.value || site_settings.value;

-- Check
select key, jsonb_pretty(value) as value from site_settings order by key;
