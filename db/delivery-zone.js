// Delivery zone: the area home delivery is allowed in, and the check that keeps out-of-zone orders away
// from the payment step. Nothing here is set through environment variables:
//
//   - The restaurant pin comes from Admin -> Contact (site_settings 'contact', lat / lng).
//   - The on/off switch comes from Admin -> Delivery settings ("Only deliver inside the delivery area",
//     site_settings 'delivery', zoneEnabled; OFF until an admin turns it on).
//   - The SHAPE lives in db/delivery-zone.json. It is stored as distances from the restaurant (metres east and
//     north), so the area follows the pin: move the pin in Admin and the zone moves with it. A shape can also be
//     plain GeoJSON with real coordinates ([lng, lat]); that one does not depend on the pin.
//
// While the switch is on but no pin has been saved yet, a pin-based zone can not be placed on the map, so delivery
// is not restricted (it behaves as if switched off) until the pin is saved. The admin page says so.

const fs = require('fs');
const path = require('path');
const { toPoint } = require('./geo');

const ZONE_FILE = path.join(__dirname, 'delivery-zone.json');
const M_PER_DEG_LAT = 110700;                  // about right for Saudi Arabia; the error over a few km is metres
const M_PER_DEG_LNG_AT_EQUATOR = 111320;

// ---------- shape (from the JSON file) ----------

function collectPolygons(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FeatureCollection') (node.features || []).forEach((f) => collectPolygons(f, out));
  else if (node.type === 'Feature') collectPolygons(node.geometry, out);
  else if (node.type === 'Polygon') out.push(node.coordinates);
  else if (node.type === 'MultiPolygon') (node.coordinates || []).forEach((p) => out.push(p));
}

function cleanRing(ring, label, valid) {
  if (!Array.isArray(ring)) throw new Error('a ring is not a list of points');
  const points = ring.map((p) => {
    const a = Number(p && p[0]);
    const b = Number(p && p[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !valid(a, b)) throw new Error(`a point is not a valid ${label} pair`);
    return [a, b];
  });
  if (points.length) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) points.push([first[0], first[1]]);
  }
  if (points.length < 4) throw new Error('a ring needs at least 3 distinct points');
  return points;
}

const validLngLat = (lng, lat) => Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
const validMetres = (east, north) => Math.abs(east) <= 50000 && Math.abs(north) <= 50000;   // 50 km: a delivery area, not a country

// Reads and checks the zone file. Returns { kind: 'relative', rings, approximate } (metres from the restaurant)
// or { kind: 'absolute', polygons, approximate } (real coordinates). Throws when the file is unusable.
function parseShape(raw) {
  if (raw && raw.anchor === 'restaurant') {
    const points = raw.points || (raw.polygon && raw.polygon.points);
    return { kind: 'relative', rings: [cleanRing(points, '[east, north] metres', validMetres)], approximate: raw.approximate === true };
  }
  const found = [];
  collectPolygons(raw, found);
  if (!found.length) throw new Error('no Polygon or MultiPolygon found');
  const polygons = found.map((polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('a polygon has no rings');
    return polygon.map((ring) => cleanRing(ring, '[lng, lat]', validLngLat));
  });
  const first = raw.type === 'FeatureCollection' ? (raw.features || [])[0] : raw;
  const props = (first && first.properties) || {};
  return { kind: 'absolute', polygons, approximate: props.approximate === true, placeholder: props.placeholder === true };
}

function loadShapeFile(file = ZONE_FILE) {
  try {
    return { shape: parseShape(JSON.parse(fs.readFileSync(file, 'utf8')), file), error: null };
  } catch (error) {
    return { shape: null, error };
  }
}

// ---------- geometry ----------

// 0 = outside the ring, 1 = inside, 2 = exactly on its edge.
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) {
      return 2;
    }
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 1 : 0;
}

function inPolygon(x, y, rings) {
  const outer = inRing(x, y, rings[0]);
  if (outer === 0) return false;
  if (outer === 2) return true;
  for (let i = 1; i < rings.length; i += 1) {   // holes
    if (inRing(x, y, rings[i]) === 1) return false;
  }
  return true;
}

// Places a metres-from-the-restaurant ring on the map around the pin.
function placeRing(ring, pin) {
  const mPerDegLng = M_PER_DEG_LNG_AT_EQUATOR * Math.cos((pin.lat * Math.PI) / 180);
  return ring.map(([east, north]) => [pin.lng + east / mPerDegLng, pin.lat + north / M_PER_DEG_LAT]);
}

// ---------- the zone, as of right now ----------

const isCoordInput = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '');

// readState: async () => ({ enabled: boolean, pin: {lat, lng} | null })   (the admin switch and the restaurant pin)
function createDeliveryZone({ shape, shapeError = null, readState, ttlMs = 10000 }) {
  let cached = null;
  let cachedAt = 0;

  async function build() {
    let state;
    try {
      state = await readState();
    } catch (error) {
      console.error('Could not read the delivery area settings:', error.message);
      return { enforced: true, broken: true, reason: 'settings-unreadable', polygons: null, center: null, approximate: false };
    }
    if (!state.enabled) return { enforced: false, broken: false, reason: 'off', polygons: null, center: state.pin, approximate: false };
    if (!shape) return { enforced: true, broken: true, reason: 'shape-invalid', polygons: null, center: state.pin, approximate: false };

    let polygons;
    if (shape.kind === 'relative') {
      if (!state.pin) return { enforced: false, broken: false, reason: 'no-pin', polygons: null, center: null, approximate: shape.approximate };
      polygons = [shape.rings.map((ring) => placeRing(ring, state.pin))];
    } else {
      polygons = shape.polygons;
    }
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    polygons.forEach((polygon) => polygon[0].forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }));
    const center = state.pin || toPoint((minLat + maxLat) / 2, (minLng + maxLng) / 2);
    return { enforced: true, broken: false, reason: 'ok', polygons, center, approximate: shape.approximate };
  }

  // The zone right now: { enforced, broken, reason, center, geometry, contains(lat, lng) }.
  async function current() {
    if (!cached || Date.now() - cachedAt > ttlMs) {
      const zone = await build();
      cached = {
        enforced: zone.enforced,
        broken: zone.broken,
        reason: zone.reason,
        approximate: zone.approximate,
        center: zone.center,
        geometry: zone.polygons ? { type: 'MultiPolygon', coordinates: zone.polygons } : null,
        // true: inside or on the edge; false: outside; null: there is no usable zone to test against
        contains: (lat, lng) => (zone.polygons ? zone.polygons.some((rings) => inPolygon(lng, lat, rings)) : null),
      };
      cachedAt = Date.now();
    }
    return cached;
  }

  // Call after an admin saves the pin or the switch, so the change applies at once.
  function clearCache() { cached = null; }

  // Used by POST /api/orders for every home-delivery order.
  // Returns { ok: true, point } or { ok: false, status, code, message }.
  async function checkDeliveryPoint(lat, lng) {
    const point = isCoordInput(lat) && isCoordInput(lng) ? toPoint(lat, lng) : null;
    const zone = await current();
    if (!zone.enforced) return { ok: true, point };
    if (zone.broken) {
      return { ok: false, status: 503, code: 'ZONE_UNAVAILABLE', message: 'Home delivery is temporarily unavailable. Please choose Self-Pickup.' };
    }
    if (!point) {
      return { ok: false, status: 400, code: 'LOCATION_REQUIRED', message: 'Please drop the pin on your delivery location, or choose Self-Pickup.' };
    }
    if (!zone.contains(point.lat, point.lng)) {
      return { ok: false, status: 422, code: 'OUT_OF_ZONE', message: 'This location is outside our delivery area. Please choose Self-Pickup.' };
    }
    return { ok: true, point };
  }

  // What the browser needs (GET /api/config): the same polygon the server checks against.
  async function publicZone() {
    const zone = await current();
    return { enforced: zone.enforced, center: zone.center, geometry: zone.geometry };
  }

  // What the admin page shows next to the switch.
  async function adminStatus() {
    const zone = await current();
    return { reason: zone.reason, approximate: zone.approximate, shapeKind: shape ? shape.kind : null };
  }

  return { current, clearCache, checkDeliveryPoint, publicZone, adminStatus };
}

// ---------- the real thing: file + database ----------

function isMissingTable(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205');
}

async function readStateFromDatabase() {
  const supabase = require('./supabase');   // loaded here so the unit tests need no database
  const { data, error } = await supabase.from('site_settings').select('key, value').in('key', ['contact', 'delivery']);
  if (error) {
    if (isMissingTable(error)) return { enabled: false, pin: null };   // older database: nothing saved yet
    throw error;
  }
  const rows = Object.fromEntries((data || []).map((row) => [row.key, row.value || {}]));
  return {
    enabled: Boolean(rows.delivery && rows.delivery.zoneEnabled === true),
    pin: toPoint(rows.contact && rows.contact.lat, rows.contact && rows.contact.lng),
  };
}

const { shape: fileShape, error: fileError } = loadShapeFile();
const instance = createDeliveryZone({ shape: fileShape, shapeError: fileError, readState: readStateFromDatabase });

async function logStatus() {
  if (!fileShape) {
    console.error(`Delivery zone could not be read from db/delivery-zone.json (${fileError && fileError.message}). While the delivery area is switched on, home delivery orders are refused until it is fixed.`);
    return;
  }
  try {
    const zone = await instance.current();
    if (zone.reason === 'off') console.warn('Delivery area check is switched OFF in Admin -> Delivery settings: delivery is accepted anywhere.');
    else if (zone.reason === 'no-pin') console.warn('Delivery area is on but the restaurant pin is not saved yet (Admin -> Contact), so delivery is not restricted until it is.');
    else if (zone.approximate) console.warn('The delivery area shape in db/delivery-zone.json is APPROXIMATE (traced from a screenshot). Check it on the checkout map, then remove "approximate" from the file.');
    else console.log('Delivery area active, placed around the restaurant pin from Admin -> Contact.');
  } catch (error) {
    console.error('Could not check the delivery area at startup:', error.message);
  }
}

module.exports = { ...instance, logStatus, createDeliveryZone, parseShape, loadShapeFile };
