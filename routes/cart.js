const express = require('express');
const supabase = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Every route here requires a signed-in user — guests use localStorage
// on the client instead (see homepage.html). NOTE: this router is mounted
// at the bare '/api' prefix in server.js (its own routes already start
// with '/cart'), so requireAuth must be applied per-route below rather
// than via a blanket router.use(requireAuth) — a blanket use() with no
// path matches every request that reaches this router, which previously
// blocked unrelated routes like /api/auth/login and /api/admin/* before
// they ever reached their own handlers.

// GET /api/cart — current cart, joined with live menu item data
// (name/price/availability), so the client always shows up-to-date info.
router.get('/cart', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('cart_items')
    .select('menu_item_id, quantity, menu_items(id, name_en, name_ar, name_ur, name_zh, price, is_available, categories(key))')
    .eq('user_id', req.authUser.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data });
});

// POST /api/cart  { menu_item_id, quantity }
// Upserts a line. quantity <= 0 deletes the line.
router.post('/cart', requireAuth, async (req, res) => {
  const menu_item_id = Number(req.body.menu_item_id);
  const quantity = Number(req.body.quantity);

  if (!Number.isInteger(menu_item_id)) {
    return res.status(400).json({ error: 'menu_item_id must be an integer' });
  }
  if (!Number.isInteger(quantity)) {
    return res.status(400).json({ error: 'quantity must be an integer' });
  }

  if (quantity <= 0) {
    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', req.authUser.id)
      .eq('menu_item_id', menu_item_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, deleted: true });
  }

  const { data, error } = await supabase
    .from('cart_items')
    .upsert(
      { user_id: req.authUser.id, menu_item_id, quantity, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,menu_item_id' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ item: data });
});

// DELETE /api/cart/:menuItemId
router.delete('/cart/:menuItemId', requireAuth, async (req, res) => {
  const menu_item_id = Number(req.params.menuItemId);
  if (!Number.isInteger(menu_item_id)) {
    return res.status(400).json({ error: 'menuItemId must be an integer' });
  }

  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('user_id', req.authUser.id)
    .eq('menu_item_id', menu_item_id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /api/cart/merge  { items: [{ menu_item_id, quantity }] }
// Called once, right after login, to fold a guest's localStorage cart
// into their DB cart. Quantities are added on top of whatever is
// already saved server-side (not overwritten).
router.post('/cart/merge', requireAuth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.json({ items: [] });

  const { data: existing, error: existingErr } = await supabase
    .from('cart_items')
    .select('menu_item_id, quantity')
    .eq('user_id', req.authUser.id);
  if (existingErr) return res.status(500).json({ error: existingErr.message });

  const existingByItem = new Map(existing.map((row) => [row.menu_item_id, row.quantity]));
  const rows = [];
  for (const line of items) {
    const menu_item_id = Number(line.menu_item_id);
    const incomingQty = Number(line.quantity);
    if (!Number.isInteger(menu_item_id) || !Number.isInteger(incomingQty) || incomingQty <= 0) continue;
    const mergedQty = (existingByItem.get(menu_item_id) || 0) + incomingQty;
    rows.push({ user_id: req.authUser.id, menu_item_id, quantity: mergedQty, updated_at: new Date().toISOString() });
  }
  if (!rows.length) return res.json({ items: [] });

  const { error: upsertErr } = await supabase
    .from('cart_items')
    .upsert(rows, { onConflict: 'user_id,menu_item_id' });
  if (upsertErr) return res.status(500).json({ error: upsertErr.message });

  const { data: merged, error: mergedErr } = await supabase
    .from('cart_items')
    .select('menu_item_id, quantity, menu_items(id, name_en, name_ar, name_ur, name_zh, price, is_available, categories(key))')
    .eq('user_id', req.authUser.id);
  if (mergedErr) return res.status(500).json({ error: mergedErr.message });

  res.json({ items: merged });
});

module.exports = router;
