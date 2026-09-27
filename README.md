# Red House Catering — Server

Node/Express API backed by Supabase, deployed on Render.

## 1. Set up the database
Run these in Supabase → **SQL Editor** → New query, **in this order**:
1. `db/01_create_tables.sql` — creates all app tables, including profiles and carts.
2. `db/02_rls_and_constraints.sql` — adds indexes, unique order tokens, and RLS policies.
3. `db/03_insert_menu.sql` — inserts or updates the six categories and 18 menu items
   (ids 1–18, matching `homepage.html`). Re-running it updates the baseline menu without
   deleting order history.

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
| `IMGBB_API_KEY` | yes for menu image uploads | Imgbb API key used by the admin image upload proxy; never exposed to the browser |
| `PORT` | no (default 3000) | Local port |
| `APP_URL` | yes | Used for the keep-alive pinger **and** as the base for the password-reset redirect link (see below) |
| `ALLOWED_ORIGINS` | recommended | Comma-separated list of origins allowed to call this API cross-origin, e.g. `https://your-service.onrender.com,https://yourdomain.com`. Falls back to `APP_URL` alone if unset. Requests with no `Origin` header (curl, same-origin page loads) are always allowed regardless. |
| `WHATSAPP_NUMBER` | yes for checkout | Your business WhatsApp, digits only, no `+` or leading `00` (e.g. `9665XXXXXXXX`) |
| `BRANCH_NAME` | no (default "Red House Trading") | Shown in the WhatsApp message and checkout screen |
| `DELIVERY_FEE` | no (default `20`) | Single source of truth for the delivery fee — used by `POST /api/orders` and served to the frontend via `GET /api/config`, so it only needs setting in one place |

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
- `GET /menu`, `POST /menu`, `PATCH /menu/:id`, `DELETE /menu/:id`
- `POST /images` — text/plain image data URL; uploads through Imgbb and returns `{ url }`
- `GET /orders?status=<pending|confirmed|preparing|ready|completed|cancelled>` — omit `status` for all orders
- `GET /orders/:id`
- `PATCH /orders/:id/status` — `{ status }`

## Admin dashboard
`frontend/admin.html`, served at `/admin`. Staff sign in with their normal email/password
(must have `is_admin = true` — see section 1). The dashboard manages orders, categories,
and menu items; category and item names/descriptions support English, Arabic, Urdu, and
Chinese. Menu image uploads use `IMGBB_API_KEY` on the server. Category deletion is
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
- **RLS** is enabled on `profiles`, `orders`, `order_items`, and `cart_items` (see `db/02_rls_and_constraints.sql`). The server always uses the `service_role` key, which bypasses RLS entirely — these policies are defense-in-depth for if anything ever queries Supabase directly with the anon key.

## Next up
- Real payment gateway to replace the simulated step in `routes/orders.js`.
- Translated (ar/ur/zh) menu item descriptions — only English descriptions exist today.
- Real-time order updates in `/admin` (currently polls every 25s) via Supabase Realtime.
