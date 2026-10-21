const express = require('express');
const supabase = require('../db/supabase');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Shown until an admin saves real details (or if the site_settings table
// has not been created yet), so the call button always has something to show.
const DEFAULT_CONTACT = {
  phone: '+966 56 928 3982',      // WhatsApp option 1 (international format)
  phone2: '',                     // WhatsApp option 2 (optional)
  orderPhone: '',                 // WhatsApp number that receives orders (empty = use phone)
  address: '',
  mapUrl: 'https://maps.app.goo.gl/SPNMnoHksw7VcNu66',
};

const SETTINGS_KEY = 'contact';
const PHONE_PATTERN = /^\+?[0-9\s().-]{5,30}$/;
const INTL_HELP = 'Enter a valid phone number in international format: start with + and the country code, then the number (for example +44 7911 123456). Do not start with 0.';

// Any country. Accepts "+<country code><number>" or "00<country code><number>" with spaces, dashes or
// brackets, and returns the digits-only form wa.me needs (e.g. "+91 98765 43210" -> "919876543210").
// A local number such as "056 928 3982" has no country code, so it can not be turned into a WhatsApp
// link and this returns '' for it.
function toWaNumber(raw) {
  const text = String(raw || '').trim();
  if (!PHONE_PATTERN.test(text)) return '';
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else {
    return '';
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}
const MAX_ADDRESS_LENGTH = 300;
const MAP_URL_PATTERN = /^https:\/\/[^\s]{4,300}$/i;

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
    // phone2 / mapUrl: a saved empty string means "cleared by admin"; only a missing key falls back
    phone2: typeof value.phone2 === 'string' ? value.phone2 : DEFAULT_CONTACT.phone2,
    orderPhone: typeof value.orderPhone === 'string' ? value.orderPhone : DEFAULT_CONTACT.orderPhone,
    address: typeof value.address === 'string' ? value.address : DEFAULT_CONTACT.address,
    mapUrl: typeof value.mapUrl === 'string' ? value.mapUrl : DEFAULT_CONTACT.mapUrl,
  };
}

// The number order messages are sent to (digits only, for wa.me): the admin's "orders" number,
// else WhatsApp number 1. '' when none is usable.
async function getOrderWhatsapp() {
  const contact = await readContact();
  return toWaNumber(contact.orderPhone) || toWaNumber(contact.phone);
}

// GET /api/contact  (public) - contact details for the homepage call button.
router.get('/contact', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  const contact = await readContact();
  res.json({ ...contact, orderWa: await getOrderWhatsapp() });
});

// PUT /api/admin/contact  (admin) - body: { phone, phone2?, orderPhone?, address?, mapUrl? }
router.put('/admin/contact', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const phone = str(body.phone);
  const phone2 = str(body.phone2);
  const orderPhone = str(body.orderPhone);
  const address = str(body.address);
  const mapUrl = str(body.mapUrl);

  if (!toWaNumber(phone)) return res.status(400).json({ error: INTL_HELP });
  if (phone2 && !toWaNumber(phone2)) return res.status(400).json({ error: INTL_HELP });
  if (orderPhone && !toWaNumber(orderPhone)) return res.status(400).json({ error: INTL_HELP });
  if (address.length > MAX_ADDRESS_LENGTH) {
    return res.status(400).json({ error: `Address can be at most ${MAX_ADDRESS_LENGTH} characters.` });
  }
  if (mapUrl && !MAP_URL_PATTERN.test(mapUrl)) {
    return res.status(400).json({ error: 'Map link must be a full https:// link.' });
  }
  if (!address && !mapUrl) {
    return res.status(400).json({ error: 'Enter an address or a map link.' });
  }

  const contact = { phone, phone2, orderPhone, address, mapUrl };
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: SETTINGS_KEY, value: contact, updated_at: new Date().toISOString() });

  if (error) {
    if (isMissingTable(error)) {
      return res.status(500).json({ error: 'The site_settings table is missing. Run db/01_tables.sql in Supabase.' });
    }
    return res.status(500).json({ error: error.message || 'Could not save contact details.' });
  }

  res.json({ success: true, contact, orderWa: await getOrderWhatsapp() });
});

router.getOrderWhatsapp = getOrderWhatsapp;
router.toWaNumber = toWaNumber;

module.exports = router;
