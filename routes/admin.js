const express = require('express');
const supabase = require('../db/supabase');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
const LANGUAGES = ['en', 'ar', 'ur', 'zh'];

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function databaseError(res, error, fallback) {
  if (error.code === '23505') return res.status(409).json({ error: 'That key is already in use.' });
  if (error.code === '23503') return res.status(409).json({ error: 'This record is still in use.' });
  return res.status(500).json({ error: error.message || fallback });
}

function categoryValues(body = {}) {
  const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
  const sortOrder = Number(body.sort_order);
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(key)) {
    return { error: 'Key must contain lowercase letters, numbers, hyphens, or underscores.' };
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { error: 'Sort order must be a non-negative whole number.' };
  }

  const values = { key, sort_order: sortOrder };
  for (const language of LANGUAGES) {
    const label = body[`label_${language}`];
    if (typeof label !== 'string' || !label.trim()) {
      return { error: `Category name is required for ${language.toUpperCase()}.` };
    }
    values[`label_${language}`] = label.trim();
  }
  return { values };
}

function menuItemValues(body = {}) {
  const categoryId = Number(body.category_id);
  const price = Number(body.price);
  const calories = body.calories === '' || body.calories == null ? null : Number(body.calories);
  const rating = body.rating === '' || body.rating == null ? null : Number(body.rating);
  const popularity = body.popularity === '' || body.popularity == null ? 0 : Number(body.popularity);

  if (!Number.isInteger(categoryId) || categoryId < 1) return { error: 'Choose a category.' };
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be zero or greater.' };
  if (calories !== null && (!Number.isInteger(calories) || calories < 0)) {
    return { error: 'Calories must be a non-negative whole number.' };
  }
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
    return { error: 'Rating must be between 0 and 5.' };
  }
  if (!Number.isInteger(popularity) || popularity < 0) return { error: 'Popularity must be a non-negative whole number.' };

  const values = {
    category_id: categoryId,
    price,
    calories,
    rating,
    popularity,
    is_offer: body.is_offer === true,
    is_available: body.is_available !== false,
    image_path: typeof body.image_path === 'string' && body.image_path.trim() ? body.image_path.trim() : null,
  };
  for (const language of LANGUAGES) {
    const name = body[`name_${language}`];
    const description = body[`description_${language}`];
    if (typeof name !== 'string' || !name.trim()) {
      return { error: `Item name is required for ${language.toUpperCase()}.` };
    }
    values[`name_${language}`] = name.trim();
    values[`description_${language}`] = typeof description === 'string' && description.trim()
      ? description.trim()
      : null;
  }
  return { values };
}

// Every route below requires a signed-in Supabase user whose
// profiles.is_admin = true (see middleware/auth.js).
router.use(requireAdmin);

// GET /api/admin/categories
router.get('/categories', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) return databaseError(res, error, 'Failed to load categories.');
  res.json({ categories: data });
}));

// POST /api/admin/categories
router.post('/categories', asyncHandler(async (req, res) => {
  const result = categoryValues(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const { data, error } = await supabase
    .from('categories')
    .insert(result.values)
    .select('*')
    .single();
  if (error) return databaseError(res, error, 'Failed to create category.');
  res.status(201).json({ category: data });
}));

// PATCH /api/admin/categories/:id
router.patch('/categories/:id', asyncHandler(async (req, res) => {
  const result = categoryValues(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const { data, error } = await supabase
    .from('categories')
    .update(result.values)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();
  if (error) return databaseError(res, error, 'Failed to update category.');
  if (!data) return res.status(404).json({ error: 'Category not found.' });
  res.json({ category: data });
}));

// DELETE /api/admin/categories/:id
router.delete('/categories/:id', asyncHandler(async (req, res) => {
  const { count, error: itemsError } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', req.params.id);
  if (itemsError) return databaseError(res, itemsError, 'Failed to check category items.');
  if (count) return res.status(409).json({ error: "Move or delete this category's menu items first." });

  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) return databaseError(res, error, 'Failed to delete category.');
  if (!data) return res.status(404).json({ error: 'Category not found.' });
  res.json({ ok: true });
}));

// GET /api/admin/menu — includes unavailable items for management.
router.get('/menu', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, categories(id, key, label_en, label_ar, label_ur, label_zh)')
    .order('name_en', { ascending: true });
  if (error) return databaseError(res, error, 'Failed to load menu items.');
  res.json({ items: data });
}));

// POST /api/admin/menu
router.post('/menu', asyncHandler(async (req, res) => {
  const result = menuItemValues(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const { data, error } = await supabase
    .from('menu_items')
    .insert(result.values)
    .select('*')
    .single();
  if (error) return databaseError(res, error, 'Failed to create menu item.');
  res.status(201).json({ item: data });
}));

// PATCH /api/admin/menu/:id
router.patch('/menu/:id', asyncHandler(async (req, res) => {
  const result = menuItemValues(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const { data, error } = await supabase
    .from('menu_items')
    .update(result.values)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();
  if (error) return databaseError(res, error, 'Failed to update menu item.');
  if (!data) return res.status(404).json({ error: 'Menu item not found.' });
  res.json({ item: data });
}));

// DELETE /api/admin/menu/:id — order item snapshots are retained by the database.
router.delete('/menu/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('menu_items')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();
  if (error) return databaseError(res, error, 'Failed to delete menu item.');
  if (!data) return res.status(404).json({ error: 'Menu item not found.' });
  res.json({ ok: true });
}));

// POST /api/admin/images — upload a data URL through the server so the Imgbb key stays private.
router.post('/images', express.text({ type: 'text/plain', limit: '7mb' }), asyncHandler(async (req, res) => {
  if (!process.env.IMGBB_API_KEY) return res.status(503).json({ error: 'IMGBB_API_KEY is not configured.' });
  const imageMatch = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.body || '');
  if (!imageMatch) return res.status(400).json({ error: 'Choose a JPEG, PNG, WebP, or GIF image.' });

  const imageBuffer = Buffer.from(imageMatch[2], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image must be smaller than 5 MB.' });
  }

  const uploadBody = new URLSearchParams({ image: imageMatch[2], name: `menu-${Date.now()}` });
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: uploadBody,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    console.error('Imgbb upload failed:', result?.error?.message || response.statusText);
    return res.status(502).json({ error: 'Image upload failed. Check the Imgbb API key and try again.' });
  }
  res.status(201).json({ url: result.data.display_url || result.data.url });
}));

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

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Admin request failed:', error);
  const status = error.type === 'entity.too.large' ? 413 : 500;
  const message = status === 413 ? 'Image must be smaller than 5 MB.' : 'Admin request failed. Please try again.';
  res.status(status).json({ error: message });
});

module.exports = router;
