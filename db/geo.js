// Free map services used on the server: place search + address lookup (OpenStreetMap Nominatim) and
// road routes (OSRM). No API key is needed for either, so the whole map feature costs nothing.
//
// Both public servers are shared community services, so this file is polite on purpose:
//   - Nominatim: at most one request per second, always with an identifying User-Agent.
//   - OSRM: a route between two fixed points never changes, so every route is cached.
// For heavy traffic point ROUTING_URL at your own OSRM / an OSRM-compatible hosted service.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const ROUTING_URL = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
const USER_AGENT = process.env.GEOCODER_USER_AGENT
  || `RedHouseMenuSystem/1.0 (${process.env.APP_URL || 'self-hosted'})`;

const NOMINATIM_GAP_MS = 1100;   // Nominatim usage policy: max 1 request per second
const MAX_WAITING = 20;          // refuse instead of building an endless queue
const ROUTE_TTL_MS = 6 * 60 * 60 * 1000;
const ROUTE_FAIL_TTL_MS = 5 * 60 * 1000;
const ROUTE_CACHE_MAX = 300;
const MAX_ROUTE_POINTS = 400;

// ---------- coordinates ----------

// Turns a value into a number inside the valid range, or null. Accepts numbers and numeric strings.
function toCoord(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

// {lat, lng} with both parts valid, else null. 6 decimals is about 0.1 m, more than any pin needs.
function toPoint(lat, lng) {
  const a = toCoord(lat, 90);
  const b = toCoord(lng, 180);
  if (a === null || b === null) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

// ---------- Nominatim (one request per second, one at a time) ----------

let chain = Promise.resolve();
let lastCallAt = 0;
let waiting = 0;

function throttled(task) {
  if (waiting >= MAX_WAITING) return Promise.reject(new Error('The map search is busy. Try again in a moment.'));
  waiting += 1;
  const run = chain.then(async () => {
    const wait = lastCallAt + NOMINATIM_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallAt = Date.now();
    return task();
  });
  const done = () => { waiting -= 1; };
  chain = run.then(done, done);
  return run;
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Search for a place or address. `near` ({lat, lng}) only nudges results toward that area, it does not
// exclude anything. Returns [{ label, lat, lng }].
function searchPlaces(query, { near = null, limit = 5 } = {}) {
  const text = String(query || '').trim().slice(0, 300);
  if (text.length < 3) return Promise.resolve([]);
  const params = new URLSearchParams({ format: 'jsonv2', q: text, limit: String(limit) });
  if (near) {
    const d = 0.5; // about 55 km each way
    params.set('viewbox', [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(','));
  }
  return throttled(() => fetchJson(`${NOMINATIM_URL}/search?${params}`, 7000)).then((rows) =>
    (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const point = toPoint(row.lat, row.lon);
        return point ? { label: String(row.display_name || ''), ...point } : null;
      })
      .filter(Boolean)
  );
}

// Best-effort position for a free-text delivery address ("Neighborhood, street, building, apartment").
// Long address text often finds nothing, so the leading parts (apartment, building) are dropped one by one,
// up to 3 tries in total. Returns { lat, lng } or null.
async function geocodeAddress(address, near = null) {
  const parts = String(address || '').split(/[,،\n]+/).map((s) => s.trim()).filter(Boolean);
  const tries = [];
  for (let i = 0; i < parts.length && tries.length < 3; i += 1) {
    const q = parts.slice(i).join(', ');
    if (q.length >= 4) tries.push(q);
  }
  for (const q of tries) {
    const found = await searchPlaces(q, { near, limit: 1 });
    if (found.length) return { lat: found[0].lat, lng: found[0].lng };
  }
  return null;
}

// ---------- OSRM route (cached) ----------

const routeCache = new Map(); // key -> { at, value } ; value null = "no route" (kept briefly)

function routeKey(a, b) {
  return [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(5)).join(',');
}

function thin(points) {
  if (points.length <= MAX_ROUTE_POINTS) return points;
  const step = Math.ceil(points.length / MAX_ROUTE_POINTS);
  const out = points.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

// Driving route from one point to another: { points: [[lat, lng], ...], distance_m, duration_s } or null.
// The duration is the normal driving time without traffic.
async function getRoute(from, to) {
  const key = routeKey(from, to);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? ROUTE_TTL_MS : ROUTE_FAIL_TTL_MS)) return hit.value;

  let value = null;
  try {
    const url = `${ROUTING_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const data = await fetchJson(url, 8000);
    const route = data && data.code === 'Ok' && data.routes && data.routes[0];
    if (route && route.geometry && Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length > 1) {
      value = {
        points: thin(route.geometry.coordinates.map(([lng, lat]) => [lat, lng])),
        distance_m: Math.round(route.distance),
        duration_s: Math.round(route.duration),
      };
    }
  } catch (error) {
    console.error('Could not get a route:', error.message);
  }

  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value);
  routeCache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { toCoord, toPoint, searchPlaces, geocodeAddress, getRoute };
