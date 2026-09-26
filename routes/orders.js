const express = require('express');
const supabase = require('../db/supabase');
const { getAuthUser } = require('../middleware/auth');

const router = express.Router();

const DELIVERY_FEE = 20; // keep in sync with homepage.html's DELIVERY_FEE constant

// POST /api/orders
// body: {
//   customer_name, customer_phone, delivery_type: 'pickup'|'delivery',
//   delivery_address (required if delivery_type === 'delivery'),
//   items: [{ menu_item_id, quantity }]
// }
router.post('/orders', async (req, res) => {
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
    if (!Number.isInteger(qty) || qty <= 0) {
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
    subtotal,
    deliveryFee,
    total,
    status: order.status,
    payment_status: order.payment_status,
  });
});

// GET /api/orders/:id — handy for confirmation screens / support lookups
router.get('/orders/:id', async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

module.exports = router;
