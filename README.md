# Red House Catering — Server

Node/Express API backed by Supabase, deployed on Render.

## 1. Set up the database
1. Open your Supabase project → **SQL Editor** → New query.
2. Paste the contents of `db/schema.sql` and run it.
3. Check **Table Editor** to confirm `categories`, `menu_items`, `orders`, `order_items` exist, with 4 seeded categories.
4. Run `db/seed_menu_items.sql` to add `calories`/`rating` columns and seed the 18 real menu items — their ids (1–18) are set explicitly so they line up with the `ITEMS` array ids in `homepage.html`.
5. If the database already exists, run `db/profile_auth.sql` once to add Auth UUID-backed profiles and the optional `orders.user_id` link.

## 2. Get your Supabase keys
Project → **Settings → API**:
- `Project URL` → `SUPABASE_URL`
- `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ never expose this in frontend code — server-side only)

## 3. Run locally
```bash
cp .env.example .env
# fill in .env with your real values
npm install
npm run dev
```
Test:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/categories
curl "http://localhost:3000/api/menu?category=mains&sort=price"
```

## 4. Deploy to Render
1. Push this folder to a GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables in Render's dashboard: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
6. Deploy. Your API will be at `https://your-service.onrender.com`.

## API so far
- `GET /health`
- `GET /api/categories`
- `GET /api/menu?category=<key>&sort=popular|name|time|offer|price`
- `GET /api/menu/:id`
- `POST /api/auth/register` — creates a Supabase Auth user and matching profile.
- `POST /api/auth/login` — returns a Supabase access token and profile.
- `GET /api/auth/me` — returns the authenticated user and profile. Requires `Authorization: Bearer <token>`.
- `PATCH /api/auth/me` — updates `display_name`, `phone`, and `address`. Requires `Authorization: Bearer <token>`.
- `GET /api/auth/orders` — returns the authenticated user's order history. Requires `Authorization: Bearer <token>`.
- `POST /api/orders` — creates an order. Re-checks every item's price against Supabase server-side (never trusts client prices), computes subtotal/delivery fee/total, marks `payment_status = 'paid'` (simulated — swap for a real gateway later), returns `{ id, subtotal, deliveryFee, total, status, payment_status }`.
- `GET /api/orders/:id` — order + its line items, for confirmation/support lookups.

## Wiring `homepage.html` to this server
Near the top of the script block in `homepage.html`, set:
```js
const API_BASE = 'https://your-service.onrender.com'; // this server's Render URL
const WHATSAPP_NUMBER = '9665XXXXXXXX';                // your business WhatsApp, no + or leading 00
```
Right now `homepage.html` still uses its hardcoded `ITEMS`/`CATS` arrays for browsing (the ids match the seeded `menu_items` rows above), and only calls the server for `POST /api/orders` at checkout. The next step is swapping `render()` to `fetch('/api/menu?...')` so the menu itself is live from Supabase too.

## Order + WhatsApp flow (as built)
1. Customer browses the menu → taps an item → item detail modal (photo, calories, rating, description, "includes" box, qty stepper, add to cart).
2. Basket tab / cart icon opens the cart overlay → picks **Pickup** (free) or **Home delivery** (+`DELIVERY_FEE`).
3. "Complete your order now" → checkout form (name, phone, address if delivery).
4. "Pay & send order" → simulates a brief payment step, then `POST /api/orders` creates the order in Supabase already marked paid, returning an order id.
5. The app builds a WhatsApp message (order id, name, phone, items, totals) and opens `https://wa.me/<WHATSAPP_NUMBER>?text=...` so the customer sends it straight to the branch.

## Next up
- Wire the live menu fetch (see above) so `menu_items` edits in Supabase show up without redeploying the frontend.
- Real payment gateway to replace the simulated step in `routes/orders.js`.
- An admin view for `orders`/`order_items` (or just use Supabase's Table Editor for now).
