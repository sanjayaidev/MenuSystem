const express = require('express');
const supabase = require('../db/supabase');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];

// Every route below requires a signed-in Supabase user whose
// profiles.is_admin = true (see middleware/auth.js).
router.use(requireAdmin);

// GET /api/admin/orders?status=pending
// Omit ?status for every order, newest first.
router.get('/orders', async (req, res) => {
  const { status } = req.query;

  let query = supabase
    .from('orders')
    .select('id, customer_name, customer_phone, delivery_type, delivery_address, status, payment_status, payment_method, subtotal, total, notes, created_at, updated_at, order_items(id, name_snapshot, unit_price, quantity, line_total)')
    .order('created_at', { ascending: false });

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    query = query.eq('status', status);
  }

  const { data: orders, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders });
});

// GET /api/admin/orders/:id — full detail for one order
router.get('/orders/:id', async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', req.params.id)
    .single();

  if (error || !order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// PATCH /api/admin/orders/:id/status  { status }
router.patch('/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const { data: order, error } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

module.exports = router;
