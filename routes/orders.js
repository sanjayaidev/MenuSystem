const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../db/supabase');
const { getAuthUser } = require('../middleware/auth');
const { parseOrderRef } = require('../db/order-ref');
const { toPoint, geocodeAddress, getRoute } = require('../db/geo');
const contactRoutes = require('./contact');

const router = express.Router();

// Single source of truth for the delivery fee — set DELIVERY_FEE in your
// .env / Render dashboard. homepage.html reads the same value from
// GET /api/config instead of hardcoding its own copy.
const DELIVERY_FEE = Number(process.env.DELIVERY_FEE || 20);

// Order creation hits Supabase, sends (eventually) a WhatsApp handoff, and
// has no auth requirement (guests can order) — so it's the endpoint most
// worth protecting from being hammered by a script. Limit by IP.
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many orders from this connection. Please wait a while and try again.' },
});

// POST /api/orders
// body: {
//   customer_name, customer_phone, delivery_type: 'pickup'|'delivery',
//   delivery_address (required if delivery_type === 'delivery'),
//   items: [{ menu_item_id, quantity }]
// }
router.post('/orders', orderLimiter, async (req, res) => {
  const {
    customer_name,
    customer_phone,
    delivery_type = 'pickup',
    delivery_address,
    items,
  } = req.body;

  if (!customer_name || !customer_phone) {
    return res.status(400).json({ error: 'customer_name and customer_phone are required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  if (items.length > 50) {
    return res.status(400).json({ error: 'Too many line items in one order' });
  }
  if (delivery_type === 'delivery' && !delivery_address) {
    return res.status(400).json({ error: 'delivery_address is required for home delivery' });
  }

  // Every line must be an object with a whole-number menu_item_id. Without this check a body like
  // {"items":[null]} throws inside this async handler (an unhandled rejection that can take the
  // whole server down on current Node versions).
  const ids = items.map((i) => Number(i && i.menu_item_id));
  if (ids.some((id) => !Number.isInteger(id) || id < 1)) {
    return res.status(400).json({ error: 'Every item needs a valid menu_item_id' });
  }

  const authUser = await getAuthUser(req);

  // Fetch real prices/names from the DB — never trust prices sent by the client.
  const { data: dbItems, error: fetchErr } = await supabase
    .from('menu_items')
    .select('id, name_en, price, is_available')
    .in('id', ids);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const dbItemsById = new Map(dbItems.map((i) => [i.id, i]));
  const orderItems = [];
  let subtotal = 0;

  // money in whole cents, so 3 x 10.99 is 32.97 and not 32.970000000000006
  const toMoney = (n) => Math.round(n * 100) / 100;

  for (const line of items) {
    const itemId = Number(line.menu_item_id);
    const dbItem = dbItemsById.get(itemId);
    const qty = Number(line.quantity);
    if (!dbItem || !dbItem.is_available) {
      return res.status(400).json({ error: `Menu item ${itemId} is not available` });
    }
    if (!Number.isInteger(qty) || qty <= 0 || qty > 50) {
      return res.status(400).json({ error: `Invalid quantity for item ${itemId}` });
    }
    const lineTotal = toMoney(Number(dbItem.price) * qty);
    subtotal = toMoney(subtotal + lineTotal);
    orderItems.push({
      menu_item_id: dbItem.id,
      name_snapshot: dbItem.name_en,
      unit_price: dbItem.price,
      quantity: qty,
      line_total: lineTotal,
    });
  }

  const deliveryFee = delivery_type === 'delivery' ? DELIVERY_FEE : 0;
  const total = toMoney(subtotal + deliveryFee);

  // Payment is simulated for now: mark it paid immediately on order creation.
  // Swap this for a real gateway webhook/confirmation later without
  // changing the shape of the response the frontend relies on.
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      user_id: authUser?.id || null,
      customer_name,
      customer_phone,
      delivery_type,
      delivery_address: delivery_type === 'delivery' ? delivery_address : null,
      status: 'pending',
      payment_status: 'paid',
      payment_method: 'simulated',
      subtotal,
      total,
    })
    .select()
    .single();

  if (orderErr) return res.status(500).json({ error: orderErr.message });

  const rowsToInsert = orderItems.map((oi) => ({ ...oi, order_id: order.id }));
  const { error: itemsErr } = await supabase.from('order_items').insert(rowsToInsert);

  if (itemsErr) {
    // best-effort rollback of the order header if line items fail to insert
    await supabase.from('orders').delete().eq('id', order.id);
    return res.status(500).json({ error: itemsErr.message });
  }

  res.status(201).json({
    id: order.id,
    order_number: order.order_number, // e.g. RH-260928-0042 — show this to the customer
    order_token: order.order_token, // keep this client-side to look the order up later
    subtotal,
    deliveryFee,
    total,
    status: order.status,
    payment_status: order.payment_status,
  });
});

// GET /api/orders/:ref?token=<order_token> — for confirmation/support lookups.
// :ref is the order number (RH-260928-0042) or the legacy numeric id.
// Order ids are small sequential integers, so without this check anyone
// could just walk them and read other customers' names/phones/addresses.
// Access is allowed if the caller supplies the order's own order_token
// (returned once at creation, meant for guest checkout confirmation
// screens), or is signed in as the order's owner, or is an admin.
router.get('/orders/:id', async (req, res) => {
  const ref = parseOrderRef(req.params.id);
  if (!ref) return res.status(404).json({ error: 'Order not found' });

  const { data: order, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq(ref.column, ref.value)
    .single();

  if (error || !order) return res.status(404).json({ error: 'Order not found' });

  const { token } = req.query;
  const isOwnerByToken = typeof token === 'string' && token.length > 0 && token === order.order_token;

  const authUser = await getAuthUser(req);
  const isOwnerByAuth = Boolean(authUser && order.user_id && authUser.id === order.user_id);

  let isAdmin = false;
  if (authUser && !isOwnerByAuth) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', authUser.id)
      .maybeSingle();
    isAdmin = Boolean(profile?.is_admin);
  }

  if (!isOwnerByToken && !isOwnerByAuth && !isAdmin) {
    return res.status(403).json({ error: 'Not authorized to view this order' });
  }

  const { order_token, ...safeOrder } = order; // never echo the token back out
  res.json(safeOrder);
});

// ---------- customer order tracking ----------
// GET /api/track/:orderNumber?token=<order_token> | ?phone=<phone used on the order> | signed-in owner
// Returns only what a tracking page needs (no name, phone or address). A wrong order number and a wrong
// proof give the same 404, so order numbers can not be probed.
const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lookups. Please wait a while and try again.' },
});

// Digits only, without leading zeros (a local trunk "0" or an international "00" prefix).
const digitsOf = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
// Tolerates a missing country code: the shorter number (7+ digits) must be the tail of the longer one.
function phonesMatch(a, b) {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (x.length < 7 || y.length < 7) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

router.get('/track/:ref', trackLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const notFound = () => res.status(404).json({ error: 'We could not find that order. Check the order number and phone number.' });

  const ref = parseOrderRef(req.params.ref);
  if (!ref || ref.column !== 'order_number') return notFound();

  const { data: order, error } = await supabase
    .from('orders')
    .select('order_number, order_token, user_id, customer_phone, delivery_type, status, subtotal, total, created_at, updated_at, order_items(name_snapshot, quantity)')
    .eq('order_number', ref.value)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not load the order. Please try again.' });
  if (!order) return notFound();

  const { token, phone } = req.query;
  let allowed = typeof token === 'string' && token.length > 0 && token === order.order_token;
  if (!allowed && typeof phone === 'string' && phonesMatch(phone, order.customer_phone)) allowed = true;
  if (!allowed && req.get('authorization')) {
    const authUser = await getAuthUser(req);
    allowed = Boolean(authUser && order.user_id && authUser.id === order.user_id);
  }
  if (!allowed) return notFound();

  res.json({
    order_number: order.order_number,
    status: order.status,
    delivery_type: order.delivery_type,
    created_at: order.created_at,
    updated_at: order.updated_at,
    subtotal: order.subtotal,
    total: order.total,
    items: (order.order_items || []).map((i) => ({ name: i.name_snapshot, quantity: i.quantity })),
  });
});

// ---------- delivery route map for the tracking page ----------
// GET /api/track/:orderNumber/map?token=<order_token> | signed-in owner
// Returns { restaurant, destination, route } for a home-delivery order. Any part can be null: the restaurant pin
// is set in Admin -> Contact, the destination is looked up from the delivery address text, and the route
// comes from the free OSRM service.
// Unlike the status lookup above, the phone number is NOT enough here: this reveals where the customer lives,
// and a phone number is easy to know. The order link/token from checkout, or the owner's sign-in, is required.
const mapLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lookups. Please wait a while and try again.' },
});

const GEO_RETRY_MS = 10 * 60 * 1000;   // after a failed address lookup, wait before trying that order again
const GEO_MEMORY_MAX = 500;
const geoMemory = new Map();   // order_number -> { lat, lng }  (also covers a database without the delivery_lat/lng columns)
const geoMisses = new Map();   // order_number -> time of the failed lookup
const geoInFlight = new Map(); // order_number -> Promise, so the 20-second refreshes share one lookup

function remember(map, key, value) {
  if (map.size >= GEO_MEMORY_MAX) map.delete(map.keys().next().value);
  map.set(key, value);
}

// 42703 = Postgres undefined_column, PGRST204 = PostgREST schema-cache miss: 01_tables.sql has not been re-run yet
const isMissingColumn = (error) => Boolean(error && (error.code === '42703' || error.code === 'PGRST204'));

// Where this order is delivered: the saved position, else a lookup of the address text (saved for next time).
function findDestination(order) {
  const saved = toPoint(order.delivery_lat, order.delivery_lng) || geoMemory.get(order.order_number);
  if (saved) return Promise.resolve(saved);
  if (!order.delivery_address) return Promise.resolve(null);

  const key = order.order_number;
  const failedAt = geoMisses.get(key);
  if (failedAt && Date.now() - failedAt < GEO_RETRY_MS) return Promise.resolve(null);
  if (geoInFlight.has(key)) return geoInFlight.get(key);

  const job = (async () => {
    const near = await contactRoutes.getRestaurantLocation();
    const found = await geocodeAddress(order.delivery_address, near);
    if (!found) { remember(geoMisses, key, Date.now()); return null; }
    remember(geoMemory, key, found);
    const { error } = await supabase.from('orders').update({ delivery_lat: found.lat, delivery_lng: found.lng }).eq('id', order.id);
    if (error && !isMissingColumn(error)) console.error('Could not save the delivery position:', error.message);
    return found;
  })()
    .catch((error) => {
      console.error('Could not place the delivery address on the map:', error.message);
      remember(geoMisses, key, Date.now());
      return null;
    })
    .finally(() => geoInFlight.delete(key));
  geoInFlight.set(key, job);
  return job;
}

router.get('/track/:ref/map', mapLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const notFound = () => res.status(404).json({ error: 'We could not find that order.' });

  const ref = parseOrderRef(req.params.ref);
  if (!ref || ref.column !== 'order_number') return notFound();

  const columns = 'id, order_number, order_token, user_id, delivery_type, status, delivery_address';
  let { data: order, error } = await supabase
    .from('orders')
    .select(`${columns}, delivery_lat, delivery_lng`)
    .eq('order_number', ref.value)
    .maybeSingle();
  if (isMissingColumn(error)) {
    ({ data: order, error } = await supabase.from('orders').select(columns).eq('order_number', ref.value).maybeSingle());
  }
  if (error) return res.status(500).json({ error: 'Could not load the map. Please try again.' });
  if (!order) return notFound();

  const { token } = req.query;
  let allowed = typeof token === 'string' && token.length > 0 && token === order.order_token;
  if (!allowed && req.get('authorization')) {
    const authUser = await getAuthUser(req);
    allowed = Boolean(authUser && order.user_id && authUser.id === order.user_id);
  }
  if (!allowed) return notFound();

  if (order.delivery_type !== 'delivery' || order.status === 'cancelled') {
    return res.json({ restaurant: null, destination: null, route: null });
  }

  const restaurant = await contactRoutes.getRestaurantLocation();
  const destination = restaurant ? await findDestination(order) : null;
  const route = restaurant && destination ? await getRoute(restaurant, destination) : null;
  res.json({ restaurant, destination, route });
});

module.exports = router;
