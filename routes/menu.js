const express = require('express');
const supabase = require('../db/supabase');

const router = express.Router();

// GET /api/categories
router.get('/categories', async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/menu?category=mains&sort=popular
// sort: popular | name | time | offer | price   (matches homepage.html's sortSelect)
router.get('/menu', async (req, res) => {
  const { category, sort = 'popular' } = req.query;

  let query = supabase
    .from('menu_items')
    .select('*, categories(key, label_en, label_ar, label_ur, label_zh)')
    .eq('is_available', true);

  if (category && category !== 'all') {
    // filter by the category's key (e.g. 'mains'), not its numeric id
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .select('id')
      .eq('key', category)
      .single();

    if (catErr || !cat) return res.status(404).json({ error: 'Unknown category' });
    query = query.eq('category_id', cat.id);
  }

  switch (sort) {
    case 'name':
      query = query.order('name_en', { ascending: true });
      break;
    case 'time':
      query = query.order('created_at', { ascending: false });
      break;
    case 'offer':
      query = query.order('is_offer', { ascending: false }).order('popularity', { ascending: false });
      break;
    case 'price':
      query = query.order('price', { ascending: true });
      break;
    case 'popular':
    default:
      query = query.order('popularity', { ascending: false });
      break;
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/menu/:id
router.get('/menu/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, categories(key, label_en, label_ar, label_ur, label_zh)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Item not found' });
  res.json(data);
});

module.exports = router;
