const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../db/supabase');
const { getAuthUser } = require('../middleware/auth');
const { parseOrderRef } = require('../db/order-ref');

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

  const authUser = await getAuthUser(req);

  // Fetch real prices/names from the DB — never trust prices sent by the client.
  const ids = items.map((i) => i.menu_item_id);
  const { data: dbItems, error: fetchErr } = await supabase
    .from('menu_items')
    .select('id, name_en, price, is_available')
    .in('id', ids);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const dbItemsById = new Map(dbItems.map((i) => [i.id, i]));
  const orderItems = [];
  let subtotal = 0;

  for (const line of items) {
    const dbItem = dbItemsById.get(line.menu_item_id);
    const qty = Number(line.quantity);
    if (!dbItem || !dbItem.is_available) {
      return res.status(400).json({ error: `Menu item ${line.menu_item_id} is not available` });
    }
    if (!Number.isInteger(qty) || qty <= 0 || qty > 50) {
      return res.status(400).json({ error: `Invalid quantity for item ${line.menu_item_id}` });
    }
    const lineTotal = dbItem.price * qty;
    subtotal += lineTotal;
    orderItems.push({
      menu_item_id: dbItem.id,
      name_snapshot: dbItem.name_en,
      unit_price: dbItem.price,
      quantity: qty,
      line_total: lineTotal,
    });
  }

  const deliveryFee = delivery_type === 'delivery' ? DELIVERY_FEE : 0;
  const total = subtotal + deliveryFee;

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

module.exports = router;
