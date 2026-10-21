const express = require('express');
const crypto = require('crypto');
const supabase = require('../db/supabase');
const { parseOrderRef, sanitizeSearch } = require('../db/order-ref');
const { requireAdmin } = require('../middleware/auth');
const { translateTexts, TranslateError } = require('../db/translate');
const { getDeliverySettings, saveDeliverySettings, CURRENCY } = require('../db/delivery-settings');

const router = express.Router();

// Only four statuses are used: confirmed (= "Confirmed & preparing"), out_for_delivery, completed, cancelled.
const VALID_STATUSES = ['confirmed', 'out_for_delivery', 'completed', 'cancelled'];
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
//   { card: { font, size, border_w, border_color, add_bg, add_color, add_radius, add_font_scale },
//     en|ar|zh: { food: { scale, width, height, x, y }, name: { font, size, color, x, y }, price: { ... } } }
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
  const foodRules = {
    scale: { type: 'int', min: 50, max: 150, name: 'size (%)' },
    width: { type: 'int', min: 50, max: 150, name: 'width (%)' },
    height: { type: 'int', min: 50, max: 100, name: 'height (%)' },
    x: { type: 'int', min: -50, max: 50, name: 'move left / right' },
    y: { type: 'int', min: -50, max: 50, name: 'move up / down' },
  };
  const cardRules = {
    font: { type: 'font' },
    size: { type: 'int', min: 50, max: 250, name: 'size (%)' },
    border_w: { type: 'int', min: 0, max: 8, name: 'border width (px)' },
    border_color: { type: 'color' },
    food_height: { type: 'int', min: 50, max: 100, name: 'food height (%)' },
    food_overlap: { type: 'int', min: 0, max: 40, name: 'food overlap (%)' },
    row_gap: { type: 'int', min: 0, max: 40, name: 'gap between cards (px)' },
    card_gap: { type: 'int', min: 0, max: 100, name: 'name and price gap' },
    padding_top: { type: 'int', min: 0, max: 15, name: 'top padding (%)' },
    padding_side: { type: 'int', min: 0, max: 15, name: 'side padding (%)' },
    padding_bottom: { type: 'int', min: 0, max: 20, name: 'bottom padding (%)' },
    radius: { type: 'int', min: 0, max: 24, name: 'corner radius (px)' },
    add_bg: { type: 'color' },
    add_color: { type: 'color' },
    add_radius: { type: 'int', min: 0, max: 24, name: 'button corner radius (px)' },
    add_font_scale: { type: 'int', min: 50, max: 200, name: 'button text size (%)' },
  };

  const clean = {};
  const card = styleFields(style.card, 'Card', cardRules);
  if (card.error) return { error: card.error };
  if (Object.keys(card.value).length) clean.card = card.value;

  for (const language of STYLE_LANGUAGES) {
    if (style[language] == null) continue;
    if (typeof style[language] !== 'object' || Array.isArray(style[language])) return { error: 'Card style is not valid.' };
    const entry = {};
    for (const part of ['food', 'name', 'price']) {
      const result = styleFields(style[language][part], `${language.toUpperCase()} ${part}`, part === 'food' ? foodRules : textRules);
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

async function applyGlobalTextStyleToNewItem(values) {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'menu_design')
    .maybeSingle();
  if (error) throw error;
  const globalStyle = data?.value?.global_text_style;
  if (!globalStyle || typeof globalStyle !== 'object' || Array.isArray(globalStyle) || !Object.keys(globalStyle).length) return;

  const itemStyle = values.card_style || {};
  const merged = { ...globalStyle };
  for (const language of ['en', 'ar', 'zh']) {
    const itemLanguage = itemStyle[language];
    if (!itemLanguage || typeof itemLanguage !== 'object') continue;
    merged[language] = { ...(globalStyle[language] || {}) };
    for (const part of ['food', 'name', 'price']) {
      if (!itemLanguage[part] || typeof itemLanguage[part] !== 'object') continue;
      merged[language][part] = { ...(globalStyle[language]?.[part] || {}), ...itemLanguage[part] };
    }
  }
  for (const [key, value] of Object.entries(itemStyle)) {
    if (!['en', 'ar', 'zh'].includes(key)) merged[key] = value;
  }
  values.card_style = merged;
}

// Every route below requires a signed-in Supabase user whose
// profiles.is_admin = true (see middleware/auth.js).
router.use(requireAdmin);

router.get('/delivery-settings', asyncHandler(async (req, res) => {
  try {
    res.json({ ...(await getDeliverySettings()), currency: CURRENCY });
  } catch (error) {
    console.error('Could not load delivery settings:', error.message);
    res.status(500).json({ error: 'Could not load delivery settings.' });
  }
}));

router.put('/delivery-settings', asyncHandler(async (req, res) => {
  const enabled = req.body?.enabled;
  const rawAmount = req.body?.amount;
  const amount = Number(rawAmount);
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Delivery cost enabled must be true or false.' });
  }
  if (rawAmount == null || (typeof rawAmount === 'string' && !rawAmount.trim())
      || !Number.isFinite(amount) || amount < 0 || amount > 100000 || Math.round(amount * 100) !== amount * 100) {
    return res.status(400).json({ error: 'Delivery amount must be a non-negative amount with at most two decimal places.' });
  }
  try {
    const settings = { enabled, amount: Math.round(amount * 100) / 100 };
    await saveDeliverySettings(settings);
    res.json({ ...settings, currency: CURRENCY });
  } catch (error) {
    console.error('Could not save delivery settings:', error.message);
    res.status(500).json({ error: 'Could not save delivery settings.' });
  }
}));

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

// PUT /api/admin/menu/reorder — replace the complete menu order.
router.put('/menu/reorder', asyncHandler(async (req, res) => {
  const itemIds = req.body?.item_ids;
  if (!Array.isArray(itemIds) || itemIds.some(id => !['string', 'number'].includes(typeof id) || String(id).trim() === '')) {
    return res.status(400).json({ error: 'Provide the complete menu item ID list.' });
  }

  const { data: items, error: loadError } = await supabase.from('menu_items').select('id, display_order');
  if (loadError) return databaseError(res, loadError, 'Failed to load menu items for reordering.');
  const submittedIds = itemIds.map(String);
  const submittedSet = new Set(submittedIds);
  const currentIds = new Set((items || []).map(item => String(item.id)));
  if (submittedSet.size !== submittedIds.length || submittedSet.size !== currentIds.size ||
      submittedIds.some(id => !currentIds.has(id))) {
    return res.status(409).json({ error: 'The menu changed. Reload the menu and try reordering again.' });
  }
  if (submittedIds.length > 9999) return res.status(400).json({ error: 'Menu order supports up to 9999 items.' });

  const currentMax = (items || []).reduce((max, item) => Math.max(max, Number(item.display_order) || 0), 0);
  const temporaryStart = currentMax + submittedIds.length + 1;
  const temporaryResults = await Promise.all(submittedIds.map((id, index) =>
    supabase.from('menu_items').update({ display_order: temporaryStart + index }).eq('id', id)
  ));
  const temporaryError = temporaryResults.find(result => result.error)?.error;
  if (temporaryError) return databaseError(res, temporaryError, 'Failed to prepare menu item order.');

  const orderResults = await Promise.all(submittedIds.map((id, index) =>
    supabase.from('menu_items').update({ display_order: index + 1 }).eq('id', id)
  ));
  const orderError = orderResults.find(result => result.error)?.error;
  if (orderError) return databaseError(res, orderError, 'Failed to save menu item order.');
  res.json({ ok: true });
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
  await applyGlobalTextStyleToNewItem(result.values);
  const { data, error } = await supabase
    .from('menu_items')
    .insert(result.values)
    .select('*')
    .single();
  if (error) return databaseError(res, error, 'Failed to create menu item.');
  res.status(201).json({ item: data });
}));

const MENU_STYLE_LAYOUT_RULES = {
  background: { bg_x: [0, 100], bg_y: [0, 100], bg_scale: [100, 200] },
  'white-card': { card_width: [40, 85], card_height: [60, 100] },
  price: { price_x: [-50, 50], price_y: [-50, 50] },
  'add-to-cart': { add_scale: [50, 150], add_x: [-50, 50], add_y: [-50, 50] },
};
const WHITE_CARD_STYLE_FIELDS = ['border_w', 'border_color', 'food_overlap', 'row_gap', 'card_gap', 'padding_top', 'padding_side', 'padding_bottom', 'radius'];
const FOOD_PICTURE_STYLE_FIELDS = ['scale', 'width', 'height', 'x', 'y'];
const ADD_TO_CART_STYLE_FIELDS = ['add_bg', 'add_color', 'add_radius', 'add_font_scale'];

function menuItemStyleObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return JSON.parse(JSON.stringify(raw));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { /* malformed legacy style: start with an empty style */ }
  }
  return {};
}

function replaceStyleFields(target, source, fields) {
  for (const field of fields) delete target[field];
  for (const field of fields) {
    if (source && source[field] != null && source[field] !== '') target[field] = source[field];
  }
}

function menuStyleApplyValues(section, language, design) {
  const layout = {};
  const style = {};
  const allowedLayout = MENU_STYLE_LAYOUT_RULES[section] || {};
  for (const [field, limits] of Object.entries(allowedLayout)) {
    const value = Number(design?.[field]);
    if (!Number.isInteger(value) || value < limits[0] || value > limits[1]) {
      return { error: `${field} must be a whole number between ${limits[0]} and ${limits[1]}.` };
    }
    layout[field] = value;
  }

  if (section === 'food-picture') {
    if (!STYLE_LANGUAGES.includes(language)) return { error: 'Choose a valid food picture language.' };
    const candidate = { [language]: { food: design?.card_style?.[language]?.food || {} } };
    const result = cardStyleValue(candidate);
    if (result.error) return { error: result.error };
    style[language] = result.value?.[language] || {};
  } else if (section === 'white-card') {
    const color = design?.card_color;
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return { error: 'Choose a valid white card color.' };
    layout.card_color = color.toLowerCase();
    const candidate = { card: {} };
    for (const field of WHITE_CARD_STYLE_FIELDS) candidate.card[field] = design?.card_style?.card?.[field];
    const result = cardStyleValue(candidate);
    if (result.error) return { error: result.error };
    style.card = result.value?.card || {};
  } else if (section === 'overall-font') {
    const candidate = { card: { font: design?.card_style?.card?.font, size: design?.card_style?.card?.size } };
    const result = cardStyleValue(candidate);
    if (result.error) return { error: result.error };
    style.card = result.value?.card || {};
  } else if (section === 'add-to-cart') {
    const candidate = { card: {} };
    for (const field of ADD_TO_CART_STYLE_FIELDS) candidate.card[field] = design?.card_style?.card?.[field];
    const result = cardStyleValue(candidate);
    if (result.error) return { error: result.error };
    style.card = result.value?.card || {};
  } else if (section === 'name' || section === 'price') {
    if (!STYLE_LANGUAGES.includes(language)) return { error: 'Choose a valid text language.' };
    const candidate = { [language]: { [section]: design?.card_style?.[language]?.[section] || {} } };
    const result = cardStyleValue(candidate);
    if (result.error) return { error: result.error };
    style[language] = { [section]: result.value?.[language]?.[section] || {} };
  } else if (section !== 'background') {
    return { error: 'Choose a valid formatting section.' };
  }
  return { value: { layout, style } };
}

async function applyMenuStyleToOtherItems(sourceId, section, language, values) {
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data: items, error } = await supabase
      .from('menu_items')
      .select(section === 'background' ? 'id' : 'id, card_style')
      .neq('id', sourceId)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!items.length) break;

    const results = await Promise.all(items.map(async item => {
      const update = { ...values.layout };
      if (Object.keys(values.style).length) {
        const style = menuItemStyleObject(item.card_style);
        if (section === 'white-card') {
          const card = style.card && typeof style.card === 'object' ? { ...style.card } : {};
          replaceStyleFields(card, values.style.card, WHITE_CARD_STYLE_FIELDS);
          if (Object.keys(card).length) style.card = card;
          else delete style.card;
        } else if (section === 'overall-font') {
          const card = style.card && typeof style.card === 'object' ? { ...style.card } : {};
          replaceStyleFields(card, values.style.card, ['font', 'size']);
          if (Object.keys(card).length) style.card = card;
          else delete style.card;
        } else if (section === 'add-to-cart') {
          const card = style.card && typeof style.card === 'object' ? { ...style.card } : {};
          replaceStyleFields(card, values.style.card, ADD_TO_CART_STYLE_FIELDS);
          if (Object.keys(card).length) style.card = card;
          else delete style.card;
        } else {
          const languageStyle = style[language] && typeof style[language] === 'object' ? { ...style[language] } : {};
          const sectionStyle = section === 'food-picture'
            ? values.style[language].food || {}
            : values.style[language][section] || {};
          const fields = section === 'food-picture' ? FOOD_PICTURE_STYLE_FIELDS : [];
          if (section === 'food-picture') {
            const food = languageStyle.food && typeof languageStyle.food === 'object' ? { ...languageStyle.food } : {};
            replaceStyleFields(food, sectionStyle, fields);
            if (Object.keys(food).length) languageStyle.food = food;
            else delete languageStyle.food;
          } else if (Object.keys(sectionStyle).length) languageStyle[section] = sectionStyle;
          else delete languageStyle[section];
          if (Object.keys(languageStyle).length) style[language] = languageStyle;
          else delete style[language];
        }
        update.card_style = Object.keys(style).length ? style : null;
      }
      const { error: updateError } = await supabase.from('menu_items').update(update).eq('id', item.id);
      return updateError;
    }));
    const updateError = results.find(Boolean);
    if (updateError) throw updateError;
    if (items.length < pageSize) break;
  }
}

// Copy one formatting group from the current item to every other menu item.
router.put('/menu/apply-style', asyncHandler(async (req, res) => {
  const sourceId = req.body?.source_id;
  const section = req.body?.section;
  const language = req.body?.language;
  if (sourceId == null || sourceId === '') return res.status(400).json({ error: 'Save or select a menu item first.' });
  const result = menuStyleApplyValues(section, language, req.body?.design || {});
  if (result.error) return res.status(400).json({ error: result.error });

  const { data: source, error: sourceError } = await supabase.from('menu_items').select('id').eq('id', sourceId).maybeSingle();
  if (sourceError) return databaseError(res, sourceError, 'Could not find the menu item to copy.');
  if (!source) return res.status(404).json({ error: 'Save this menu item before applying its formatting to all.' });
  try {
    const { count, error } = await supabase.from('menu_items').select('id', { count: 'exact', head: true }).neq('id', sourceId);
    if (error) throw error;
    await applyMenuStyleToOtherItems(sourceId, section, language, result.value);
    res.json({ updated: count || 0 });
  } catch (error) {
    console.error('Could not apply menu item formatting:', error.message);
    const message = /card_style/.test(`${error.message || ''} ${error.details || ''}`)
      ? 'The database has no card_style column yet. Run db/01_tables.sql in the Supabase SQL Editor, then apply the formatting again.'
      : 'Could not apply the formatting to all menu items.';
    res.status(500).json({ error: message });
  }
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

// GET /api/admin/orders?status=confirmed&q=RH-2609&date=2026-09-28
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
