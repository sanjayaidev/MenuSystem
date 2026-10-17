const express = require('express');
const crypto = require('crypto');
const supabase = require('../db/supabase');
const { parseOrderRef, sanitizeSearch } = require('../db/order-ref');
const { requireAdmin } = require('../middleware/auth');
const { translateTexts, TranslateError } = require('../db/translate');

const router = express.Router();

const VALID_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
const LANGUAGES = ['en', 'ar', 'ur', 'zh'];

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function databaseError(res, error, fallback) {
  if (error.code === '23505' && /display_order/.test(`${error.message || ''} ${error.details || ''}`)) {
    return res.status(409).json({ error: 'That display order number is already used by another dish.' });
  }
  if (/card_style/.test(`${error.message || ''} ${error.details || ''}`) && (error.code === 'PGRST204' || error.code === '42703')) {
    return res.status(500).json({ error: 'The database has no card_style column yet. Run db/01_tables.sql in the Supabase SQL Editor, then save again.' });
  }
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
    let label = body[`label_${language}`];
    // Urdu is hidden in the UI for now: fall back to the English label.
    if (language === 'ur' && (typeof label !== 'string' || !label.trim())) label = body.label_en;
    if (typeof label !== 'string' || !label.trim()) {
      return { error: `Category name is required for ${language.toUpperCase()}.` };
    }
    values[`label_${language}`] = label.trim();
  }
  return { values };
}

// Per-dish text styles (db/01_tables.sql: menu_items.card_style, jsonb).
//   { card: { font, size, border_w, border_color },
//     en|ar|zh: { name: { font, size, color, x, y }, price: { font, size, color, x, y } } }
// Empty fields mean "the normal look", so they are dropped; an object with nothing left is stored as null.
const STYLE_FONTS = ['poppins', 'naskh', 'nastaliq', 'sans-sc', 'cinzel', 'cormorant', 'georgia', 'arial', 'custom'];
const STYLE_LANGUAGES = ['en', 'ar', 'ur', 'zh'];

function styleFields(raw, label, fields) {
  const out = {};
  if (raw == null || raw === '') return { value: out };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: `${label} style is not valid.` };
  for (const [field, rule] of Object.entries(fields)) {
    const value = raw[field];
    if (value === '' || value == null) continue;
    if (rule.type === 'font') {
      if (!STYLE_FONTS.includes(value)) return { error: `${label}: unknown font.` };
      out[field] = value;
    } else if (rule.type === 'color') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return { error: `${label}: color must be a six-digit hex color.` };
      out[field] = value.toLowerCase();
    } else {
      const number = Number(value);
      if (!Number.isInteger(number) || number < rule.min || number > rule.max) {
        return { error: `${label}: ${rule.name || field} must be a whole number between ${rule.min} and ${rule.max}.` };
      }
      out[field] = number;
    }
  }
  return { value: out };
}

function cardStyleValue(raw) {
  if (raw == null || raw === '') return { value: null };
  let style = raw;
  if (typeof style === 'string') {
    try { style = JSON.parse(style); } catch { return { error: 'Card style is not valid.' }; }
  }
  if (!style || typeof style !== 'object' || Array.isArray(style)) return { error: 'Card style is not valid.' };

  const textRules = {
    font: { type: 'font' },
    size: { type: 'int', min: 50, max: 250, name: 'size (%)' },
    color: { type: 'color' },
    x: { type: 'int', min: -50, max: 50, name: 'move left / right' },
    y: { type: 'int', min: -50, max: 50, name: 'move up / down' },
  };
  const cardRules = {
    font: { type: 'font' },
    size: { type: 'int', min: 50, max: 250, name: 'size (%)' },
    border_w: { type: 'int', min: 0, max: 8, name: 'border width (px)' },
    border_color: { type: 'color' },
  };

  const clean = {};
  const card = styleFields(style.card, 'Card', cardRules);
  if (card.error) return { error: card.error };
  if (Object.keys(card.value).length) clean.card = card.value;

  for (const language of STYLE_LANGUAGES) {
    if (style[language] == null) continue;
    if (typeof style[language] !== 'object' || Array.isArray(style[language])) return { error: 'Card style is not valid.' };
    const entry = {};
    for (const part of ['name', 'price']) {
      const result = styleFields(style[language][part], `${language.toUpperCase()} ${part}`, textRules);
      if (result.error) return { error: result.error };
      if (Object.keys(result.value).length) entry[part] = result.value;
    }
    if (Object.keys(entry).length) clean[language] = entry;
  }
  return { value: Object.keys(clean).length ? clean : null };
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

  // Display order (db/01_tables.sql): a unique whole number, blank = no fixed position.
  // Only written when the request carries the field, so older clients and un-migrated databases keep working.
  let displayOrder;
  if ('display_order' in body) {
    displayOrder = body.display_order === '' || body.display_order == null ? null : Number(body.display_order);
    if (displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder < 1 || displayOrder > 9999)) {
      return { error: 'Display order must be a whole number from 1 to 9999 (or empty).' };
    }
  }

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
  // 3-layer menu card images (db/01_tables.sql). Only written when the
  // request carries them, so older clients and un-migrated databases keep working.
  if (displayOrder !== undefined) values.display_order = displayOrder;
  for (const field of ['bg_image_url', 'food_png_url']) {
    if (!(field in body)) continue;
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (value && !/^https?:\/\//i.test(value)) return { error: 'Image links must start with http:// or https://.' };
    values[field] = value || null;
  }
  const layoutFields = {
    food_scale: [50, 150], food_x: [-50, 50], food_y: [-50, 50],
    bg_x: [0, 100], bg_y: [0, 100], bg_scale: [100, 200],
    // 16/10/2026: food width only, white card size, price and Add to cart button position / size
    food_width: [50, 150], card_width: [40, 85], card_height: [60, 100],
    price_x: [-50, 50], price_y: [-50, 50],
    add_scale: [50, 150], add_x: [-50, 50], add_y: [-50, 50],
  };
  for (const [field, [min, max]] of Object.entries(layoutFields)) {
    if (!(field in body)) continue;
    const value = body[field] === '' || body[field] == null ? null : Number(body[field]);
    if (value !== null && (!Number.isInteger(value) || value < min || value > max)) {
      return { error: `${field} must be a whole number between ${min} and ${max}.` };
    }
    values[field] = value;
  }
  if ('includes_meal' in body) values.includes_meal = body.includes_meal === true;
  // font / size / color / position per language and the card border (see cardStyleValue above)
  if ('card_style' in body) {
    const style = cardStyleValue(body.card_style);
    if (style.error) return { error: style.error };
    values.card_style = style.value;
  }
  if ('card_color' in body) {
    const color = typeof body.card_color === 'string' ? body.card_color.trim() : '';
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return { error: 'Card color must be a six-digit hex color.' };
    values.card_color = color || null;
  }
  for (const language of LANGUAGES) {
    let name = body[`name_${language}`];
    const description = body[`description_${language}`];
    // Urdu is hidden in the UI for now: fall back to the English name.
    if (language === 'ur' && (typeof name !== 'string' || !name.trim())) name = body.name_en;
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

// Display order must be unique: tell the admin which dish already holds the number.
async function displayOrderConflict(value, excludeId) {
  if (value == null) return null;
  let query = supabase.from('menu_items').select('id, name_en').eq('display_order', value).limit(1);
  if (excludeId != null) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return data && data.length ? `Display order ${value} is already used by "${data[0].name_en}". Choose a different number.` : null;
}

// POST /api/admin/menu
router.post('/menu', asyncHandler(async (req, res) => {
  const result = menuItemValues(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  if ('display_order' in result.values) {
    if (result.values.display_order === null) {
      // new dish with no number: put it at the end of the list
      const { data: last, error: lastError } = await supabase
        .from('menu_items').select('display_order').not('display_order', 'is', null)
        .order('display_order', { ascending: false }).limit(1);
      if (lastError) return databaseError(res, lastError, 'Failed to create menu item.');
      result.values.display_order = (last && last.length ? last[0].display_order : 0) + 1;
    } else {
      const conflict = await displayOrderConflict(result.values.display_order, null);
      if (conflict) return res.status(409).json({ error: conflict });
    }
  }
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
  if (result.values.display_order != null) {
    const conflict = await displayOrderConflict(result.values.display_order, req.params.id);
    if (conflict) return res.status(409).json({ error: conflict });
  }
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

// POST /api/admin/images — store a menu image and return its public URL.
// Primary: the existing public `videos` bucket in Supabase (same one the poster, hero video and music use; see README),
// under menu/. No third-party service or extra key is needed. Backup: Imgbb, only when IMGBB_API_KEY is set.
const IMAGE_BUCKET = 'videos';
const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

async function uploadToSupabase(buffer, contentType) {
  const objectPath = `menu/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_EXTENSIONS[contentType]}`;
  const storage = supabase.storage.from(IMAGE_BUCKET);
  const { error } = await storage.upload(objectPath, buffer, { contentType, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(error.message || 'Storage upload failed');
  return storage.getPublicUrl(objectPath).data.publicUrl;
}

// Same request shape as the upload-imgbb.js script (multipart form with the file as a Blob), which is known to work.
async function uploadToImgbb(buffer, contentType) {
  const body = new FormData();
  body.append('image', new Blob([buffer], { type: contentType }), `menu-${Date.now()}.${IMAGE_EXTENSIONS[contentType]}`);
  body.append('name', `menu-${Date.now()}`);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY.trim())}`, { method: 'POST', body });
  const text = await response.text();
  let result = null;
  try { result = JSON.parse(text); } catch { /* not JSON, e.g. a block page */ }
  if (!response.ok || !result?.success) {
    throw new Error(result?.error?.message || result?.status_txt || `HTTP ${response.status}`);
  }
  // `url` is the original file exactly as uploaded; `display_url` can be resized/recompressed and made food photos look soft.
  return result.data.url || result.data.image?.url || result.data.display_url;
}

// POST /api/admin/translate — { texts: { id: "English text", ... } } -> { translations: { id: { ar, zh } } }
// Uses Gemini (db/translate.js). Nothing is saved: the admin reviews the text in the form and saves it themselves.
const TRANSLATE_MAX_TEXTS = 10;
const TRANSLATE_MAX_LENGTH = 600;
let translateWindowStart = 0;
let translateCount = 0;
router.post('/translate', asyncHandler(async (req, res) => {
  // small guard against runaway clicking (the free Gemini quota is shared): 30 calls a minute
  const now = Date.now();
  if (now - translateWindowStart > 60000) { translateWindowStart = now; translateCount = 0; }
  if (++translateCount > 30) return res.status(429).json({ error: 'Too many translations. Wait a minute and try again.' });

  const input = req.body && req.body.texts;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'Nothing to translate.' });
  }
  const texts = {};
  for (const [id, value] of Object.entries(input)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return res.status(400).json({ error: 'Invalid text id.' });
    if (value.length > TRANSLATE_MAX_LENGTH) {
      return res.status(400).json({ error: `Text is too long to translate (max ${TRANSLATE_MAX_LENGTH} characters).` });
    }
    texts[id] = value.trim();
  }
  const count = Object.keys(texts).length;
  if (!count) return res.status(400).json({ error: 'Type the English text first, then translate.' });
  if (count > TRANSLATE_MAX_TEXTS) return res.status(400).json({ error: 'Too many texts at once.' });

  try {
    res.json({ translations: await translateTexts(texts) });
  } catch (error) {
    if (error instanceof TranslateError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}));

router.post('/images', express.text({ type: 'text/plain', limit: '7mb' }), asyncHandler(async (req, res) => {
  const imageMatch = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.body || '');
  if (!imageMatch) return res.status(400).json({ error: 'Choose a JPEG, PNG, WebP, or GIF image.' });

  const imageBuffer = Buffer.from(imageMatch[2], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image must be smaller than 5 MB.' });
  }

  const reasons = [];
  try {
    return res.status(201).json({ url: await uploadToSupabase(imageBuffer, imageMatch[1]) });
  } catch (error) {
    console.error('Supabase image upload failed:', error.message);
    reasons.push(`Storage said: ${error.message}`);
  }
  if (process.env.IMGBB_API_KEY) {
    try {
      return res.status(201).json({ url: await uploadToImgbb(imageBuffer, imageMatch[1]) });
    } catch (error) {
      console.error('Imgbb image upload failed:', error.message);
      reasons.push(`Imgbb said: ${error.message}`);
    }
  }
  // These reasons come from Supabase / imgbb (never the keys) and are shown to the logged-in admin so they can fix the cause.
  res.status(502).json({ error: `Image upload failed. ${reasons.join(' ')}` });
}));

// GET /api/admin/orders?status=pending&q=RH-2609&date=2026-09-28
// Omit everything for every order, newest first.
//   status  exact status filter
//   q       partial match on order number (RH-2609 = all of Sept 2026,
//           0042 = any order ending 0042) OR customer phone / name
//   date    single day, YYYY-MM-DD (India time), matches the order number date
router.get('/orders', async (req, res) => {
  const { status, date } = req.query;
  const q = sanitizeSearch(req.query.q);

  let query = supabase
    .from('orders')
    .select('id, order_number, customer_name, customer_phone, delivery_type, delivery_address, status, payment_status, payment_method, subtotal, total, notes, created_at, updated_at, order_items(id, name_snapshot, unit_price, quantity, line_total)')
    .order('created_at', { ascending: false });

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    query = query.eq('status', status);
  }

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const yymmdd = String(date).slice(2).replace(/-/g, '');
    query = query.like('order_number', `RH-${yymmdd}-%`);
  }

  if (q) {
    query = query.or(`order_number.ilike.%${q}%,customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%`);
  }

  const { data: orders, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders });
});

// GET /api/admin/orders/:ref — full detail for one order (order number or id)
router.get('/orders/:id', async (req, res) => {
  const ref = parseOrderRef(req.params.id);
  if (!ref) return res.status(404).json({ error: 'Order not found' });

  const { data: order, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq(ref.column, ref.value)
    .single();

  if (error || !order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// PATCH /api/admin/orders/:ref/status  { status }
router.patch('/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  const ref = parseOrderRef(req.params.id);
  if (!ref) return res.status(404).json({ error: 'Order not found' });
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const { data: order, error } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq(ref.column, ref.value)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

// DELETE /api/admin/orders/:ref - delete one CANCELLED order for good (its items go with it).
// Any other status is refused, so a live order can never be deleted by mistake.
router.delete('/orders/:id', asyncHandler(async (req, res) => {
  const ref = parseOrderRef(req.params.id);
  if (!ref) return res.status(404).json({ error: 'Order not found' });

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, status')
    .eq(ref.column, ref.value)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'cancelled') {
    return res.status(409).json({ error: 'Only cancelled orders can be deleted. Change the status to Cancelled first.' });
  }

  const { error: deleteError } = await supabase.from('orders').delete().eq('id', order.id);
  if (deleteError) return res.status(500).json({ error: deleteError.message });
  res.json({ ok: true });
}));

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Admin request failed:', error);
  const status = error.type === 'entity.too.large' ? 413 : 500;
  const message = status === 413 ? 'Image must be smaller than 5 MB.' : 'Admin request failed. Please try again.';
  res.status(status).json({ error: message });
});

module.exports = router;
