const express = require('express');
const rateLimit = require('express-rate-limit');
const { searchPlaces } = require('../db/geo');
const deliveryZone = require('../db/delivery-zone');

const router = express.Router();

// GET /api/geocode?q=<address text>&lang=en|ar|ur|zh      (public, used by the checkout address search)
// Returns { results: [{ label, lat, lng, inside }] } for places in Saudi Arabia. `inside` says whether that spot
// is inside the delivery zone (null if no zone is loaded). The pin the customer finally confirms is still checked
// again by POST /api/orders, so this endpoint is only a convenience.
//
// OpenStreetMap's Nominatim allows 1 request per second for the whole app and forbids search-as-you-type, so:
//   - the checkout only calls this when the customer presses Search,
//   - db/geo.js already queues calls one per second,
//   - answers are cached here (a repeated search costs nothing), and
//   - each visitor is limited to 15 searches a minute.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Please wait a moment, or tap the map to place the pin.', code: 'SEARCH_RATE_LIMITED' },
});

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();   // "lang|text" -> { at, results }
const LANGS = ['en', 'ar', 'ur', 'zh'];

router.get('/geocode', limiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const q = String(req.query.q || '').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return res.json({ results: [] });
  if (q.length > 120) return res.status(400).json({ error: 'The search text is too long.', code: 'SEARCH_TOO_LONG' });
  const lang = LANGS.includes(String(req.query.lang)) ? String(req.query.lang) : 'en';

  const key = `${lang}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.json({ results: hit.results });

  try {
    const found = await searchPlaces(q, { near: deliveryZone.publicZone().center, limit: 5, countrycodes: 'sa', lang });
    const results = found.map((place) => ({ ...place, inside: deliveryZone.contains(place.lat, place.lng) }));
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), results });
    res.json({ results });
  } catch (error) {
    console.error('Address search failed:', error.message);
    res.status(502).json({ error: 'Address search is not available right now. Tap the map to place the pin instead.', code: 'SEARCH_UNAVAILABLE' });
  }
});

module.exports = router;
