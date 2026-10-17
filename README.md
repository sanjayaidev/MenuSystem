# Red House Catering — Server

Node/Express API backed by Supabase, deployed on Render.

## Pages
| URL | File | What it is |
|---|---|---|
| `/` | `frontend/index.html` | Landing page (link in bio): logo, text, 4 s autoplay video, MENU / المنيو / 菜单 buttons. One 9:16 screen, dark only. |
| `/menu` (or `/menu-page.html?lang=ar`) | `frontend/menu-page.html` | Logo + single poster image (9:16, no video, no language boxes) sized so logo + poster always make exactly one screen height on every device (the poster box takes `100svh` minus the logo bar; the whole image is fitted into it by width or height, never cropped, and the rest of the box is black), with a round down-arrow button in its bottom-left corner (bottom-right in Arabic / Urdu; icon only, tap to jump to the menu), then straight into the nine scrolling category boxes (left to right, incl. Dine In and Outside Catering; swipe on touch, drag or mouse wheel on desktop), items and basket. Language is carried over from the landing page. The scrolling Special (video) section is commented out for now (planned to return in about 3 months): its HTML is wrapped in a comment and its script lines start with `//~ `; nothing is loaded and `/api/special` is not requested. To bring it back, remove the HTML comment wrapper ("SPECIAL SECTION PAUSED"), strip every `//~ ` prefix, and delete the two code lines marked `SPECIAL-PAUSED` (the replacement `Promise.all` line that leaves out `loadSpecialData()`, and the empty `scheduleLive` stand-in). Menu items are 3-layer cards, see below. |
| `/homepage.html` | `frontend/homepage.html` | The previous single-page app, kept unchanged for reference. |

Images to replace with the high-resolution originals (same file names): `frontend/images/page1-logo.png` (A) and
`frontend/images/page2img.jpeg` (D). Text B is in `index.html` (`.sec-b`).

## 1. Set up the database
Run these four files in Supabase → **SQL Editor** → New query, **in this order** (all are safe to re-run; a database that is already set up does not need them again):
1. `db/01_tables.sql` — **tables**: categories, menu items (with the card image, layout, display order columns), profiles, orders, order items, carts, site settings and the Special section tables.
2. `db/02_relations.sql` — **relations**: foreign keys between the tables, indexes and uniqueness (including the unique dish display order), the public order number (`RH-YYMMDD-NNNN`, e.g. `RH-260928-0042`, built by a database trigger; admin can search by it with `GET /api/admin/orders?q=RH-2609` for a month or `?date=2026-09-28` for a day), and row-level security.
3. `db/03_menu_and_categories.sql` — **menu**: the nine category boxes and the 17 dishes (actual prices, display order 1–17, images). Re-running it resets those 17 dishes (matched by English name) to this data; dishes added in the admin and picture position settings are left alone.
4. `db/04_site_data.sql` — **site data**: contact phone numbers, address and map link, and the menu texts / language font settings ("This meal automatically includes" text in four languages, Arabic +2 px). Values already saved from the admin are never overwritten.

The old numbered scripts (`01`–`14`) were merged into these four on 13/10/2026.

### 13/10/2026 menu update
- **Dish order** — the menu page default sort is now *Menu order* (new first option of the sort box), following `display_order`. Set it per dish in Admin → Menu items → *Display order (unique)*; a number already used by another dish is refused and names that dish. Empty on a new dish = added at the end; dishes without a number are listed last. The *Most Popular* box keeps its best-sellers-first order.
- **Prices** — shown without trailing zeros (39, not 39.00) on the menu, cart and WhatsApp message. A price with real cents keeps two decimals (39.50). The stored prices are not changed by the page code: they come from `db/03_menu_and_categories.sql` (the actual prices) or from Admin → Menu items.
- **"This meal automatically includes" text** — now *Seaweed Soup, Fried Egg Rice, Noodles, Salad & Water* in English, Arabic, Urdu and Chinese (the Arabic, Urdu and Chinese texts are drafts to be confirmed by a native speaker). Each language can be edited in Admin → Menu design → *"This meal automatically includes" text*; an empty box falls back to the built-in text. The title line is unchanged. From 16/10/2026 it shows only on dishes marked as a meal (see below).
- **Font size per language** — every text size on the menu page gets a per-language extra size (`--lang-add`, in px). Arabic starts at +2 px; change it, and pick a font per language, in Admin → Menu design → *Language font and size*. Both are stored in `site_settings` (key `menu_design`, no new SQL).

### 16/10/2026 admin update (client points 2 to 8)

**One-time setup (developer).** In Supabase → **SQL Editor** run `db/01_tables.sql` once (safe to run again). It adds the new columns to `menu_items` and, the first time only, ticks "meal" on the Beef, Chicken and Shrimp Meal dishes. Do **not** re-run `db/03_menu_and_categories.sql` on the live database (it resets the 17 dishes); it is only for new installs and now also sets the meal flag. Run the SQL first, then deploy the code.

**How to read the numbers.** Every number box has a normal value, shown in the instructions below. Plus numbers move a thing right or down, minus numbers move it left or up, and 0 means "the normal place". In Arabic and Urdu the card is mirrored, so left and right moves of the price and the button are mirrored too, and the dish looks the same in every language. Always look at **Live menu preview** (top right of the form) while you type. The settings of a dish are saved only when you click **Save menu item** (or **Create menu item** for a new dish).

#### Point 2: Set the price position on the white card
1. Click **Menu items** in the left menu.
2. Find the dish and click **Edit**.
3. In **Text style** for the selected language, find **Food price**. Use the language buttons above the name fields to switch languages.
4. Set **Move left / right (%)** and **Move up / down (%)** from -50 to 50. 0 = the normal place under the name. Set each language separately if the price should stay in the same place in every language.
5. Look at **Live menu preview**. When it looks right, click **Save menu item**.
6. Refresh the menu page to see it.

An empty position uses the normal place unless the dish has an older shared price offset, which remains as a fallback. Set 0 to override that fallback and return the price to its normal place. If the price disappears, it is hidden behind the dish picture; type a smaller number to bring it back.

#### Point 3: Make the Add to cart button bigger or smaller, or move it
1. **Menu items** → **Edit** next to the dish.
2. Scroll down to the box **Add to cart button**.
3. **Size (%)**: 100 = normal, 150 = one and a half times bigger, 50 = half the size.
4. **Move left / right (%)** and **Move up / down (%)**: numbers from -50 to 50, 0 = the normal place (bottom corner).
5. Click **Save menu item**.

#### Point 4: Change the dish picture and the white card
1. **Menu items** → **Edit** next to the dish.
2. To change the **dish picture**, use the box **Food picture**:
   - **Size (%)** makes the whole dish bigger or smaller (100 = normal).
   - **Width only (%)** makes the dish wider or thinner and does not change its height (100 = normal; the dish is stretched, so keep it near 100 for a natural look).
   - **Move left / right (%)** and **Move up / down (%)** move the dish (0 = normal place).
3. To change the **white background with the text**, use the box **White card (name and price)**:
   - **Width (%)**: bigger = wider white card and less room for the picture on the left (67 = normal; from 40 to 85).
   - **Height (%)**: 100 = the card covers the full height (from 60 to 100).
   - **Color**: the color of the white card.
4. Click **Save menu item**.

The box **Background picture** controls the photo behind the dish (size and position). Only the part that is not covered by the white card can be seen.

#### Point 5: Outline around the category boxes (any color)
1. Click **Menu design** in the left menu.
2. Scroll down to **Category boxes: outline**.
3. Tick **Show a colored outline**.
4. Click **Outline color** and choose any color. Set **Outline thickness (px, 1 to 4)**.
5. Click **Save style settings**, then refresh the menu page.

The outline is the same for all category boxes (Beef Meal, Chicken Meal ...). To go back to the thin grey line, untick **Show a colored outline** and click **Save style settings**.

#### Point 6: "This meal automatically includes" only on the meals
The text (soup, salad, rice, noodles and water) now shows only on dishes that are marked as a meal.
1. **Menu items** → **Edit** next to the dish.
2. Tick or untick **This dish is a meal (shows "This meal automatically includes")**.
3. Click **Save menu item**. For a new dish, tick it before you click **Create menu item**.

After the setup above, the dishes in Beef Meal, Chicken Meal and Shrimp Meal are ticked and all other dishes are not. To change the words of the text itself: **Menu design** → "This meal automatically includes" text → **Save language settings**.

#### Point 7: Cancelled orders (delete or keep)
1. Click **Orders** in the left menu.
2. On the order, choose **Cancelled** in the status list. It saves by itself.
3. The button **Delete order** appears next to the status list. Click it and confirm to delete the order for good. It cannot be brought back.
4. To keep the order for reference, do nothing. Cancelled orders stay in the list. Click the filter button **Cancelled** at the top of the page to see only the cancelled orders.

Only cancelled orders can be deleted. The server refuses to delete any other order.

#### Point 8: Make text bold
1. Click **Menu design** in the left menu and scroll down to **Bold text**.
2. Tick a text to make it bold, untick it to make it normal: **Dish name on the card**, **Price on the card**, **Add to cart button**, **Category boxes**, **Dish description (pop-up)**, **"This meal automatically includes" text (pop-up)**.
3. Click **Save style settings**, then refresh the menu page.

Until you save, the menu page keeps its old look (dish name, price, Add to cart button and category boxes bold, the other two normal).

To make **only some words** bold, type two stars before and after them, for example `**Seaweed Soup**`. This works in the dish description (**Menu items** → **Edit** → Description) and in the "This meal automatically includes" text (**Menu design**).

#### Developer notes (16/10/2026)
- New `menu_items` columns: `food_width`, `card_width`, `card_height`, `price_x`, `price_y`, `add_scale`, `add_x`, `add_y`, `includes_meal` (all empty = the old look; `includes_meal` defaults to false). Validation ranges are in `routes/admin.js` (`layoutFields`).
- The menu page sets them as CSS variables on each card (`--food-width`, `--card-w`, `--card-h`, `--price-x/y`, `--add-x/y`, `--add-scale`). X offsets of the price and button are multiplied by `--dir` (-1 in right-to-left languages). `food_x` is not mirrored (unchanged from before).
- If the API does not return `includes_meal` (database not updated yet), the pop-up behaves as before and shows the text on every dish.
- Category outline and bold settings are stored in `site_settings` (key `menu_design`: `chip_outline_color`, `chip_outline_width`, `bold`), no new table. Route: `PUT /api/admin/design/style`. The menu page applies them as `--chip-line`, `--chip-line-w` and `--bold-*` variables.
- `DELETE /api/admin/orders/:ref` deletes a cancelled order (its items are removed by the database).
- Checked in a headless browser with a mocked API (English and Arabic): moved/resized card, mirrored offsets, meal-only box, bold stars, outline, Delete order only on cancelled orders, edit form values.

### 17/10/2026 text styles per language + card border

**One-time setup (developer).** Run `db/01_tables.sql` in Supabase → SQL Editor once (safe to run again). It adds the column `menu_items.card_style` (jsonb). Run the SQL first, then deploy the code. Until the SQL is run, everything keeps working; saving a dish that uses the new styles shows "The database has no card_style column yet".

**What the admin can set for each dish** (Admin → Menu items → Edit):
- **Text style box for English, Arabic and Chinese** (follows the language buttons above the name fields). For **Food name** and **Food price**: Font, Size (%), Color, Move left / right (%), Move up / down (%). Hindi is not a menu language in this app, so it has no box.
- **White card box**: *Card color* (as before) plus Font, Size (%), Border width (px, 0 hides the line) and Border color. Card Font is the fallback for the name, price and Add to cart button. Card Size scales the name and price; language-specific name/price fonts replace the card font, while their Size multipliers compound with Card Size.
- **Bold text** in Menu design changes font weight independently of the per-item font, size, color and position settings. Per-item card Size and language-specific name/price Size are multipliers, so the percentages compound.
- Empty style boxes (or the **Normal** button next to a color) use the normal look. An empty price-position field falls back to an older dish's shared offset, if present. A language box only affects the menu when it is shown in that language; set price position in that language's **Food price** style box.
- Older dishes keep their shared price position as a fallback; a position set in a language's **Food price** style box takes precedence for that language.
- Size 100 = normal; 50 to 250 allowed. Moves are -50 to 50 and mirrored in Arabic like the existing price / button moves. Fonts: Poppins, Cinzel, Cormorant Garamond, Georgia, Arial, Noto Naskh (Arabic), Noto Nastaliq (Urdu), Noto Sans SC (Chinese), and the uploaded custom font.
- **Live menu preview** shows the language you selected, so switch language and watch it change.

**Display order warning.** Typing a display order number that another dish already has now shows a red warning right under the field (naming that dish and the next free number), outlines the box in red and stops the save. A note under the field explains the rule. The server still refuses it with 409 as before. Editing a dish never warns about its own number.

**Developer notes.** `card_style` shape: `{ card:{font,size,border_w,border_color}, en|ar|zh:{ name:{font,size,color,x,y}, price:{font,size,color,x,y} } }`, validated in `routes/admin.js` (`cardStyleValue`) and re-checked in `cardStyleVars()` of `frontend/menu-page.html`, which sets `--cs-*` CSS variables on each card for the language being shown. `GET /api/menu` already returns it (`select *`). Also fixed: switching the language buttons in the dish form did not refresh the live preview (`form.id` was the hidden `id` input).

### Auto-translate (Arabic + Chinese)
In Admin, **Menu items**, **Categories** and **Menu design → "This meal automatically includes" text** have an **Auto-translate from English (Arabic + Chinese)** button. Type the English text, press the button, and the Arabic and Chinese boxes are filled in. **Nothing is saved by the button**: read the text, fix anything wrong, then press the normal save button. If Arabic or Chinese text is already there, you are asked before it is replaced. Urdu is not translated (it is hidden in the admin).
- Needs `GEMINI_API_KEY` in the server's environment (Render → Environment). Get a key in Google AI Studio. The free tier is enough for a menu this size; on the free tier Google may use the text sent to improve its products, so only menu text is sent (never customer data).
- `POST /api/admin/translate` — `{ "texts": { "name": "Kung Pao Chicken" } }` → `{ "translations": { "name": { "ar": "...", "zh": "..." } } }`. Admin only, up to 10 texts of 600 characters, 30 calls a minute. The code is in `db/translate.js`.
- Machine translation can be wrong (especially Arabic wording for dishes), so have an Arabic and a Chinese reader check new dishes.

### Category boxes (menu page)
*(Current order after `db/03_menu_and_categories.sql`: Beef Meal, Chicken Meal, Shrimp Meal, Tofu, Dumpling, Rice Noodles, Side Orders, **Most Popular**, Dine In, Outside Catering. The paragraph below describes the earlier nine-box version.)*
The category dropdown is now one horizontally scrolling row of nine boxes, in this order: Beef Meal, Chicken Meal, Shrimp Meal, Tofu Noodle, Soup Rice, Salad Appetizer, **Most Popular**, Dine In, Outside Catering. Nothing selected shows every dish; tap a box to filter and tap it again to clear. *Most Popular* is not a database category: it lists the 8 best-selling dishes (`POPULAR_COUNT` in `menu-page.html`). *Dine In* and *Outside Catering* are normal categories and start empty — give dishes to them in Admin → Menu items (a dish belongs to one category). The Arabic / Urdu / Chinese names of those two are drafts to be confirmed by a native speaker.

### Menu page poster (editable in admin)
The image at the top of `/menu`, under the logo, is set in Admin → **Menu poster**: upload a PNG, JPG or WEBP, replace it any time, or press *Use default poster* to go back to `frontend/images/page2img.jpeg`. Use it for the current offer. The banner fits the page width and its height follows the image itself, so any ratio works and nothing is cropped. Files under 4.5 MB are stored as uploaded; larger ones are converted to JPG automatically (the `videos` bucket has a 5 MB limit). The file is stored at `poster/menu-poster-<time>.<ext>` in the `videos` bucket and described in `site_settings` (key `menu_poster`, needs `db/06_site_settings.sql`; no new SQL). The server puts the image URL straight into the menu page HTML (`/menu` and `/menu-page.html`), so there is no flash of the old poster, and falls back to the default if nothing is set. Routes: `GET /api/poster` (public), `POST /api/admin/poster` (field `image`), `DELETE /api/admin/poster`.

### Background music (index + menu pages)
Admin → **Music** sets one track per page (landing page `index`, and `menu`). The file is converted to a 96 kbps MP3 (first 5 minutes, looped), stored in the `videos` bucket at `music/index.mp3` / `music/menu.mp3`, and described in `site_settings` (key `music`, needs `db/06_site_settings.sql`). Each track can be switched off without deleting it, replaced, or removed.
On the public pages `frontend/music.js` adds a small music button (bottom-left on the landing page, in the floating buttons on the menu page). Browsers block sound until the visitor taps, so playback starts straight away when the browser allows it, otherwise on the first tap. The visitor's on/off choice is remembered (`localStorage` key `redhouse_music`) and shared by both pages. No track set = no button.

### Menu cards (3 layers)
Each menu item on `/menu` is a short 2.5:1 card built from three layers:
1. **Background** — `bg_image_url`, fills the card (the left third shows; no image = the same dark brown on every card).
2. **Card** — the parchment panel covering the right two thirds: item name, price and an *Add to cart* button.
3. **Food PNG** — `food_png_url`, a transparent PNG right-aligned against the card edge and drawn over both the background and the card.

Both images are set per item in Admin → Menu items. If an item has no food PNG, its normal image (`image_path`) is used in layer 3, so existing items keep working. Tapping the card opens the item; *Add to cart* adds one. The look is tuned by `--card-w` (default `66.6667%`) and `--food-overlap` (default `20%`) on `.row` in `frontend/menu-page.html`.

### Food image sizes (what to upload)
Measured from the card layout at its widest (448 px card, so 2.5:1 = 448 x 179 px):
| Image | Shown on the card | Upload | Format / weight |
|---|---|---|---|
| **Food PNG** (layer 3) | up to 239 x 161 px; the item pop-up shows it ~340 px tall | **1200 x 1200 px**, tightly cropped cutout, transparent background | PNG or lossless WebP, ideally under 500 KB (max 5 MB) |
| **Card background** (layer 1) | 149 x 179 px strip (5:6 portrait); the pop-up shows it full width | **1080 x 1296 px** (5:6) | JPG or WebP, quality ~80, under 250 KB |
Sharp on 3x phone screens needs about 3x the displayed size, which is what these numbers give. More pixels than this only makes the page slower.
Uploads now keep the original file: the server stores ImgBB's `url`, not `display_url` (the resized viewer copy).

### Homepage video storage
Create a **public** Supabase Storage bucket named `videos` with a **5 MB maximum file size**.
The **hero** clip (landing page) is trimmed to **4 seconds**, muted and re-encoded without shrinking
(max 720 px wide, faststart MP4); its first frame is stored as the poster (`homepage/hero.jpg`) and shown
until the video loads. The bundled default is `demo/hero.mp4` + `demo/hero-poster.jpg`.
Category clips are converted to 360p H.264 at 30 fps with every frame keyframed and trimmed to 10 seconds.
Encoded files at 4.5 MB or larger are rejected. The hero is stored at
`homepage/hero.mp4`; category clips use `special/<category-key>.mp4`. Special food selections
are saved as references to existing menu item rows, not copied names. New categories appear
automatically and can be configured from Admin → Banner.

### Making someone an admin
There's no signup flow for staff — just flip the flag on an existing account, in
Supabase's SQL Editor:
```sql
update profiles set is_admin = true where id = '<their-auth-user-uuid>';
```
Find the UUID in **Authentication → Users**. They can then sign in at `/admin` with
their normal email/password.

## 2. Get your Supabase keys
Project → **Settings → API**:
- `Project URL` → `SUPABASE_URL`
- `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ never expose this in frontend code — server-side only)
- `anon` `public` key → `SUPABASE_ANON_KEY` (used only to verify login credentials on an isolated client — see `db/supabase-auth-client.js`)

## 3. Environment variables
```bash
cp .env.example .env
```
| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side only, bypasses RLS |
| `SUPABASE_ANON_KEY` | yes | Used only to verify login credentials on a client isolated from the service-role one (prevents a logged-in user's session from leaking into other requests) |
| `IMGBB_API_KEY` | no | Optional backup for admin menu image uploads. Images are stored in the Supabase `videos` bucket under `menu/`; Imgbb is only tried if that fails. Never exposed to the browser |
| `PORT` | no (default 3000) | Local port |
| `APP_URL` | yes | Used for the keep-alive pinger **and** as the base for the password-reset redirect link (see below) |
| `ALLOWED_ORIGINS` | recommended | Comma-separated list of origins allowed to call this API cross-origin, e.g. `https://your-service.onrender.com,https://yourdomain.com`. Falls back to `APP_URL` alone if unset. Requests with no `Origin` header (curl, same-origin page loads) are always allowed regardless. |
| `WHATSAPP_NUMBER` | yes for checkout | Your business WhatsApp, digits only, no `+` or leading `00` (e.g. `9665XXXXXXXX`) |
| `BRANCH_NAME` | no (default "Red House Trading") | Shown in the WhatsApp message and checkout screen |
| `DELIVERY_FEE` | no (default `20`) | Single source of truth for the delivery fee — used by `POST /api/orders` and served to the frontend via `GET /api/config`, so it only needs setting in one place |
| `GEMINI_API_KEY` | no | Turns on the admin **Auto-translate from English** buttons (Gemini API, server-side only). Without it the buttons show "GEMINI_API_KEY is not configured on the server." and everything else works as before |
| `GEMINI_MODEL` | no (default `gemini-flash-lite-latest`) | Gemini model used for translation. `-latest` follows Google's newest Flash-Lite; set a fixed name here if you want it to never change |

## 4. Supabase Auth setup for password reset
The app uses Supabase Auth's built-in "send password recovery email" flow — no separate
email service needed, but Supabase's dashboard needs to know where to send people back to:

1. Supabase dashboard → **Authentication → URL Configuration**.
2. Set **Site URL** to your deployed `APP_URL` (e.g. `https://your-service.onrender.com`).
3. Add `https://your-service.onrender.com/reset-password.html` to **Redirect URLs**
   (this is `${APP_URL}/reset-password.html` — must match exactly, including protocol).
4. If testing locally, also add `http://localhost:3000/reset-password.html` here, and set
   `APP_URL=http://localhost:3000` in your local `.env` while testing.
5. **Authentication → Providers → Email** must be enabled (it is by default).

Flow: person taps "Forgot password?" in the profile panel → enters their email →
`POST /api/auth/request-password-reset` triggers Supabase's recovery email → the email
links to `/reset-password.html#access_token=...&type=recovery` → that page reads the
token from the URL and posts a new password to `POST /api/auth/reset-password`, which
verifies the token and updates the password via the service-role admin API. No anon key
or client-side Supabase SDK is needed anywhere in this flow.

**Note:** Supabase's built-in email sending has a low rate limit and uses a shared
sender domain — fine for testing, but for production traffic, configure a custom SMTP
provider under **Authentication → Settings → SMTP Settings**.

## 5. Run locally
```bash
npm install
npm run dev
```
Test:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/config
curl http://localhost:3000/api/categories
curl "http://localhost:3000/api/menu?category=beef&sort=price"
```

## 6. Deploy to Render
1. Push this folder to a GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all the environment variables from section 3 in Render's dashboard.
6. Deploy. Your API (and the frontend, served statically) will be at `https://your-service.onrender.com`.

## API
**Public**
- `GET /health`
- `GET /api/config` — `{ whatsappNumber, branchName, deliveryFee }`, read by the frontend instead of hardcoding these.
- `GET /api/categories`
- `GET /api/menu?category=<key>&sort=popular|name|time|offer|price`
- `GET /api/menu/:id`
- `GET /api/banner` and `GET /api/special` — public video URLs and category-specific featured menu references.
- `GET /api/music` — `{ index, menu }`, each `null` or `{ url, name, enabled }`; read by `music.js` on the public pages.
- `POST /api/orders` — rate-limited (20/15min/IP). Re-checks every item's price server-side (never trusts client prices), computes subtotal/delivery fee/total, marks `payment_status='paid'` (simulated — swap for a real gateway later). Returns `{ id, order_token, subtotal, deliveryFee, total, status, payment_status }`. **Keep `order_token` client-side** — it's the only way to look this order up again without an account.
- `GET /api/orders/:id?token=<order_token>` — order + line items. Requires the matching `order_token`, or a signed-in request from the order's own `user_id`, or an admin. Otherwise `403`. (Ids are small sequential integers, so without this check anyone could just walk them and read other customers' names/phones/addresses.)

**Auth** (`/api/auth`, login/register/reset-request rate-limited at 20/15min/IP)
- `POST /register`, `POST /login`
- `GET /me`, `PATCH /me` — Bearer token required
- `GET /orders` — signed-in user's own order history
- `POST /request-password-reset` — `{ email }`, always returns `{ ok:true }` (doesn't reveal whether the email is registered)
- `POST /reset-password` — `{ access_token, new_password }`, called by `reset-password.html`

**Cart** (`/api/cart`, Bearer token required — guests use localStorage client-side instead)
- `GET /cart`
- `POST /cart` — `{ menu_item_id, quantity }`, upserts (quantity ≤ 0 deletes the line)
- `DELETE /cart/:menuItemId`
- `POST /cart/merge` — `{ items:[{menu_item_id, quantity}] }`, called once right after login to fold a guest's cart into their account (adds on top of anything already saved, doesn't overwrite)

**Admin** (`/api/admin`, Bearer token from an account with `profiles.is_admin = true`)
- `GET /categories`, `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id`
- `GET /menu`, `POST /menu`, `PATCH /menu/:id`, `DELETE /menu/:id` — items accept optional `bg_image_url` / `food_png_url` (http/https links; empty clears them)
- `POST /images` — text/plain image data URL; uploads through Imgbb and returns `{ url }`
- `GET /special`, `POST /banner`, `POST /banner/reset`, `POST /special/:categoryKey` — manage the homepage hero and per-category video/five menu references.
- `POST /music/:page` (multipart field `audio`), `PATCH /music/:page` (`{ enabled }`), `DELETE /music/:page` — background music for `index` or `menu`.
- `GET /orders?status=<pending|confirmed|preparing|ready|completed|cancelled>` — omit `status` for all orders
- `GET /orders/:id`
- `PATCH /orders/:id/status` — `{ status }`

## Admin dashboard
`frontend/admin.html`, served at `/admin`. Staff sign in with their normal email/password
(must have `is_admin = true` — see section 1). The dashboard manages orders, categories,
and menu items; category and item names/descriptions support English, Arabic, Urdu, and
Chinese. Menu image uploads are stored in the Supabase `videos` bucket (`menu/`); `IMGBB_API_KEY` is an optional backup. Category deletion is
blocked while it contains menu items, and menu item deletion keeps existing order snapshots.

## Order + WhatsApp flow (as built)
1. Customer browses the live menu (fetched from Supabase via `/api/categories` + `/api/menu`) → taps an item → item detail modal.
2. Basket tab / cart icon opens the cart overlay → **Pickup** (free) or **Home delivery** (+`DELIVERY_FEE`, from `/api/config`). Cart is saved to Supabase (`cart_items`) if signed in, or to `localStorage` as a guest — logging in merges a guest cart into the account automatically.
3. "Complete your order now" → checkout form (name, phone, address if delivery).
4. "Pay & send order" → simulates a brief payment step, then `POST /api/orders` creates the order in Supabase already marked paid, returning an order id + `order_token`.
5. The app builds a WhatsApp message and opens `https://wa.me/<WHATSAPP_NUMBER>?text=...` (number from `/api/config`) so the customer sends it straight to the branch.
6. Staff move the order through its stages from `/admin`.

## Security notes
- **Rate limiting**: login, register, password-reset-request, and order creation are all limited per-IP (20 requests / 15 min) via `express-rate-limit`.
- **CORS**: locked to `ALLOWED_ORIGINS` (see section 3) instead of wide open.
- **`helmet`** is enabled for standard security headers (CSP is left off since the frontend is single-file with inline `<script>`/`<style>` — worth tightening if you split those out later).
- **RLS** is enabled on `profiles`, `orders`, `order_items`, and `cart_items` (see `db/02_relations.sql`). The server always uses the `service_role` key, which bypasses RLS entirely — these policies are defense-in-depth for if anything ever queries Supabase directly with the anon key.

## Next up
- Real payment gateway to replace the simulated step in `routes/orders.js`.
- Translated (ar/ur/zh) menu item descriptions — only English descriptions exist today.
- Real-time order updates in `/admin` (currently polls every 25s) via Supabase Realtime.
