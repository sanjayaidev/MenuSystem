const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../db/supabase');
const { createAuthClient } = require('../db/supabase-auth-client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Login/register/password-reset are the endpoints someone could try to
// brute-force or spam with guessed credentials/emails. Limit by IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a while and try again.' },
});

async function getOrCreateProfile(user) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name, phone, address, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profile) return profile;

  // Upsert with ignoreDuplicates instead of a plain insert: if two
  // requests for a brand-new user land at the same time (e.g. a
  // double-click on login), the loser doesn't error out on the
  // profiles_pkey conflict — it just no-ops and we re-select below.
  const { error: upsertError } = await supabase
    .from('profiles')
    .upsert(
      { id: user.id, display_name: user.user_metadata?.display_name || '' },
      { onConflict: 'id', ignoreDuplicates: true }
    );

  if (upsertError) throw upsertError;

  const { data: createdProfile, error: reselectError } = await supabase
    .from('profiles')
    .select('id, display_name, phone, address, created_at, updated_at')
    .eq('id', user.id)
    .single();

  if (reselectError) throw reselectError;
  return createdProfile;
}

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
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
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Verify credentials on a throwaway client, NOT the shared service-role
  // `supabase` client below — see db/supabase-auth-client.js for why.
  const authClient = createAuthClient();
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
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
}));

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

// POST /api/auth/request-password-reset  { email }
// Uses Supabase Auth's own password-recovery email. The link it sends
// redirects to APP_URL/reset-password.html with a recovery token in
// the URL fragment. See README.md for the one-time Supabase dashboard
// setup this depends on (Site URL / Redirect URLs allowlist).
router.post('/request-password-reset', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  if (!process.env.APP_URL) {
    return res.status(500).json({ error: 'APP_URL is not configured on the server' });
  }
  const redirectTo = new URL('/reset-password.html', process.env.APP_URL).toString();

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  // Always report success even if the email doesn't exist, so this
  // endpoint can't be used to enumerate registered accounts.
  if (error) console.error('resetPasswordForEmail error:', error.message);
  res.json({ ok: true });
});

// POST /api/auth/reset-password  { access_token, new_password }
// access_token is the recovery token Supabase put in the redirect URL's
// fragment (reset-password.html reads it and sends it here). We verify
// it identifies a real user, then set the new password with the
// service-role admin API — no anon key / client-side Supabase SDK needed.
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { access_token, new_password } = req.body;
  if (!access_token || !new_password) {
    return res.status(400).json({ error: 'access_token and new_password are required' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const { data, error } = await supabase.auth.getUser(access_token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(data.user.id, {
    password: new_password,
  });
  if (updateError) return res.status(500).json({ error: updateError.message });

  res.json({ ok: true });
}));

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Auth request failed:', error);
  res.status(500).json({ error: error.message || 'Authentication request failed. Please try again.' });
});

module.exports = router;