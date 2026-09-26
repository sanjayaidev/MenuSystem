const express = require('express');
const supabase = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function getOrCreateProfile(user) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name, phone, address, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profile) return profile;

  const { data: createdProfile, error: createError } = await supabase
    .from('profiles')
    .insert({ id: user.id, display_name: user.user_metadata?.display_name || '' })
    .select('id, display_name, phone, address, created_at, updated_at')
    .single();

  if (createError) throw createError;
  return createdProfile;
}

router.post('/register', async (req, res) => {
  const { email, password, display_name = '' } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name },
  });

  if (error) return res.status(400).json({ error: error.message });

  try {
    const profile = await getOrCreateProfile(data.user);
    return res.status(201).json({ profile });
  } catch (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id);
    return res.status(500).json({ error: profileError.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  try {
    const profile = await getOrCreateProfile(data.user);
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      profile,
    });
  } catch (profileError) {
    res.status(500).json({ error: profileError.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.authUser);
    res.json({
      user_id: req.authUser.id,
      email: req.authUser.email,
      profile,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/me', requireAuth, async (req, res) => {
  const updates = {};
  for (const field of ['display_name', 'phone', 'address']) {
    if (typeof req.body[field] === 'string') updates[field] = req.body[field].trim();
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No profile fields supplied' });
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.authUser.id)
    .select('id, display_name, phone, address, created_at, updated_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ profile });
});

router.get('/orders', requireAuth, async (req, res) => {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, delivery_type, status, payment_status, total, created_at, order_items(name_snapshot, quantity, line_total)')
    .eq('user_id', req.authUser.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders });
});

module.exports = router;