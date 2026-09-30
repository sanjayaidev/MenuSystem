const express = require('express');
const supabase = require('../db/supabase');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Shown until an admin saves real details (or if the site_settings table
// has not been created yet), so the call button always has something to show.
const DEFAULT_CONTACT = {
  phone: '+966 50 000 0000',
  address: '123 Demo Street, Riyadh, Saudi Arabia',
};

const SETTINGS_KEY = 'contact';
const PHONE_PATTERN = /^\+?[0-9\s().-]{5,30}$/;
const MAX_ADDRESS_LENGTH = 300;

function isMissingTable(error) {
  // 42P01 = Postgres undefined_table, PGRST205 = PostgREST schema-cache miss
  return error && (error.code === '42P01' || error.code === 'PGRST205');
}

async function readContact() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    if (!isMissingTable(error)) console.error('Could not read contact settings:', error.message);
    return { ...DEFAULT_CONTACT };
  }

  const value = (data && data.value) || {};
  return {
    phone: typeof value.phone === 'string' && value.phone.trim() ? value.phone : DEFAULT_CONTACT.phone,
    address: typeof value.address === 'string' && value.address.trim() ? value.address : DEFAULT_CONTACT.address,
  };
}

// GET /api/contact  (public) - contact details for the homepage call button.
router.get('/contact', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(await readContact());
});

// PUT /api/admin/contact  (admin) - body: { phone, address }
router.put('/admin/contact', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';

  if (!PHONE_PATTERN.test(phone)) {
    return res.status(400).json({ error: 'Enter a valid phone number (digits, spaces, +, -, brackets).' });
  }
  if (!address || address.length > MAX_ADDRESS_LENGTH) {
    return res.status(400).json({ error: `Address is required (max ${MAX_ADDRESS_LENGTH} characters).` });
  }

  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: SETTINGS_KEY, value: { phone, address }, updated_at: new Date().toISOString() });

  if (error) {
    if (isMissingTable(error)) {
      return res.status(500).json({ error: 'The site_settings table is missing. Run db/06_site_settings.sql in Supabase.' });
    }
    return res.status(500).json({ error: error.message || 'Could not save contact details.' });
  }

  res.json({ success: true, contact: { phone, address } });
});

module.exports = router;
