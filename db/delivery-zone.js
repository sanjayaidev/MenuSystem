// Delivery zone: the area home delivery is allowed in, and the check that keeps out-of-zone orders away
// from the payment step. Nothing here is set through environment variables:
//
//   - The restaurant pin comes from Admin -> Contact (site_settings 'contact', lat / lng).
//   - The on/off switch comes from Admin -> Delivery settings ("Only deliver inside the delivery area",
//     site_settings 'delivery', zoneEnabled; OFF until an admin turns it on).
//   - The SHAPE is edited in Admin -> Delivery (map with draggable corners and a coordinate table) and saved as
//     real latitude / longitude corners in site_settings 'delivery_zone': { polygon: [{ lat, lng }, ...] }. It does
//     not depend on the restaurant pin, so moving the pin does not move the area.
//   - Until an admin saves a shape there, the starting shape in db/delivery-zone.json is used. It is GeoJSON with
//     real coordinates ([lng, lat]), so it does not depend on the pin. The file can instead hold distances from
//     the restaurant (metres east and north, "anchor": "restaurant"), which follow the pin. Admin shows the shape
//     as editable corners and saving stores it in the database; "Reset to original shape" in Admin deletes the
//     saved shape and returns to the file.
//
// While the switch is on but no pin has been saved yet, a pin-based (metres) shape can not be placed on the map,
// so delivery is not restricted (it behaves as if switched off) until the pin is saved. A shape with real
// coordinates does not need the pin. The admin page says which case applies.

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

// ---------- the saved shape (set in Admin -> Delivery) ----------

const SHAPE_KEY = 'delivery_zone';
const MAX_ZONE_CORNERS = 100;
const MAX_ZONE_SPAN_M = 100000;                // 100 km across: a delivery area, not a country
const EPS = 1e-14;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

const zoneProblem = (code, message) => ({ ok: false, status: 400, code, message });

// Orientation of c relative to the line a -> b (> 0 left, < 0 right, 0 on the line). x is lng, y is lat.
function orient(a, b, c) {
  const value = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  return Math.abs(value) < EPS ? 0 : value;
}
function withinBox(a, b, c) {
  return Math.min(a.lng, b.lng) <= c.lng && c.lng <= Math.max(a.lng, b.lng)
    && Math.min(a.lat, b.lat) <= c.lat && c.lat <= Math.max(a.lat, b.lat);
}
// True when segment a-b and segment c-d cross or touch.
function segmentsTouch(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && withinBox(a, b, c)) || (o2 === 0 && withinBox(a, b, d))
    || (o3 === 0 && withinBox(c, d, a)) || (o4 === 0 && withinBox(c, d, b));
}

// Checks the corners an admin sends and returns { ok: true, polygon: [{ lat, lng }, ...] } (rounded to 6 decimals,
// without a repeated closing corner) or { ok: false, status, code, message }.
function validateZonePolygon(input) {
  if (!Array.isArray(input)) return zoneProblem('ZONE_INVALID', 'The delivery area must be a list of corners.');
  const points = [];
  for (const corner of input) {
    const lat = corner && typeof corner === 'object' ? Number(corner.lat) : NaN;
    const lng = corner && typeof corner === 'object' ? Number(corner.lng) : NaN;
    const given = corner && typeof corner === 'object' && corner.lat !== '' && corner.lat != null && corner.lng !== '' && corner.lng != null;
    if (!given || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return zoneProblem('ZONE_BAD_POINT', 'Every corner needs a latitude between -90 and 90 and a longitude between -180 and 180.');
    }
    points.push({ lat: round6(lat), lng: round6(lng) });
  }
  if (points.length > 1) {   // a repeated closing corner is allowed, and dropped
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) points.pop();
  }
  if (points.length < 3) return zoneProblem('ZONE_TOO_FEW', 'A delivery area needs at least 3 corners.');
  if (points.length > MAX_ZONE_CORNERS) return zoneProblem('ZONE_TOO_MANY', `A delivery area can have at most ${MAX_ZONE_CORNERS} corners.`);

  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    if (points[i].lat === next.lat && points[i].lng === next.lng) {
      return zoneProblem('ZONE_DUPLICATE', `Corners ${i + 1} and ${((i + 1) % points.length) + 1} are at the same spot.`);
    }
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const northSouth = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
  const eastWest = (Math.max(...lngs) - Math.min(...lngs)) * M_PER_DEG_LNG_AT_EQUATOR * Math.cos((midLat * Math.PI) / 180);
  if (northSouth > MAX_ZONE_SPAN_M || eastWest > MAX_ZONE_SPAN_M) {
    return zoneProblem('ZONE_TOO_LARGE', 'The delivery area is too large (more than 100 km across).');
  }

  const n = points.length;
  // 1. lines that cross or touch (a "bow-tie": two corners swapped). Checked before the area, because the two
  //    halves of a symmetric bow-tie cancel out to an area of zero.
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;   // these two edges share a corner
      if (segmentsTouch(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) {
        return zoneProblem('ZONE_CROSSES', 'The delivery area lines cross each other. Move a corner so the outline does not cross itself.');
      }
    }
  }

  // 2. corners in a straight line, or squeezed into nothing
  let twiceArea = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    twiceArea += a.lng * b.lat - b.lng * a.lat;
  }
  if (Math.abs(twiceArea) / 2 < 1e-10) return zoneProblem('ZONE_FLAT', 'The corners do not enclose an area.');

  // 3. neighbouring edges that fold straight back over each other
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const c = points[(i + 2) % n];
    if (orient(a, b, c) === 0 && (a.lng - b.lng) * (c.lng - b.lng) + (a.lat - b.lat) * (c.lat - b.lat) > 0) {
      return zoneProblem('ZONE_CROSSES', 'The delivery area folds back over itself. Move a corner so the outline does not cross itself.');
    }
  }
  return { ok: true, polygon: points };
}

// The saved polygon as a shape the zone can use (the same "absolute" kind a GeoJSON file gives).
function shapeFromPolygon(polygon) {
  const ring = polygon.map((p) => [p.lng, p.lat]);
  ring.push([polygon[0].lng, polygon[0].lat]);
  return { kind: 'absolute', polygons: [[ring]], approximate: false, placeholder: false };
}

// site_settings value -> shape, or null when nothing usable is saved (a broken saved value falls back to the file).
function shapeFromStoredValue(value) {
  if (!value || typeof value !== 'object') return null;
  const checked = validateZonePolygon(value.polygon);
  if (!checked.ok) {
    console.error(`The saved delivery area (site_settings '${SHAPE_KEY}') is not usable and is ignored: ${checked.message}`);
    return null;
  }
  return shapeFromPolygon(checked.polygon);
}

// Rings of the shape placed on the map: array of polygons, each an array of rings of [lng, lat]. Null when a
// pin-based shape has no pin to be placed around.
function resolvePolygons(activeShape, pin) {
  if (!activeShape) return null;
  if (activeShape.kind === 'relative') {
    if (!pin) return null;
    return [activeShape.rings.map((ring) => placeRing(ring, pin))];
  }
  return activeShape.polygons;
}

// ---------- the zone, as of right now ----------

const isCoordInput = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '');

// readState: async () => ({ enabled: boolean, pin: {lat, lng} | null, customShape?: shape | null })
// (the admin switch, the restaurant pin, and the shape saved in Admin -> Delivery, if any)
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
    // the shape saved in Admin wins over the starting shape in the JSON file
    const activeShape = state.customShape || shape;
    const source = state.customShape ? 'database' : 'file';
    if (!state.enabled) return { enforced: false, broken: false, reason: 'off', polygons: null, center: state.pin, approximate: false, source };
    if (!activeShape) return { enforced: true, broken: true, reason: 'shape-invalid', polygons: null, center: state.pin, approximate: false, source };

    const polygons = resolvePolygons(activeShape, state.pin);
    if (!polygons) return { enforced: false, broken: false, reason: 'no-pin', polygons: null, center: null, approximate: activeShape.approximate, source };
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    polygons.forEach((polygon) => polygon[0].forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }));
    const center = state.pin || toPoint((minLat + maxLat) / 2, (minLng + maxLng) / 2);
    return { enforced: true, broken: false, reason: 'ok', polygons, center, approximate: activeShape.approximate, source };
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
        source: zone.source || 'file',
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
    return { reason: zone.reason, approximate: zone.approximate, source: zone.source, shapeKind: shape ? shape.kind : null };
  }

  // What the admin map editor starts from, whether or not the switch is on: the corners in effect (the saved
  // shape, else the starting shape from the file placed around the pin), where they came from, and the pin.
  // A starting shape with several polygons shows only its first one; saving then replaces it with that one.
  async function adminShape() {
    const state = await readState();
    const activeShape = state.customShape || shape;
    const polygons = resolvePolygons(activeShape, state.pin);
    const ring = polygons && polygons[0] && polygons[0][0] ? polygons[0][0] : null;
    return {
      polygon: ring ? ring.slice(0, -1).map(([lng, lat]) => ({ lat: round6(lat), lng: round6(lng) })) : null,
      source: state.customShape ? 'database' : (shape ? 'file' : 'none'),
      pin: state.pin,
    };
  }

  return { current, clearCache, checkDeliveryPoint, publicZone, adminStatus, adminShape };
}

// ---------- the real thing: file + database ----------

function isMissingTable(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205');
}

async function readStateFromDatabase() {
  const supabase = require('./supabase');   // loaded here so the unit tests need no database
  const { data, error } = await supabase.from('site_settings').select('key, value').in('key', ['contact', 'delivery', SHAPE_KEY]);
  if (error) {
    if (isMissingTable(error)) return { enabled: false, pin: null, customShape: null };   // older database: nothing saved yet
    throw error;
  }
  const rows = Object.fromEntries((data || []).map((row) => [row.key, row.value || {}]));
  return {
    enabled: Boolean(rows.delivery && rows.delivery.zoneEnabled === true),
    pin: toPoint(rows.contact && rows.contact.lat, rows.contact && rows.contact.lng),
    customShape: rows[SHAPE_KEY] ? shapeFromStoredValue(rows[SHAPE_KEY]) : null,
  };
}

const { shape: fileShape, error: fileError } = loadShapeFile();
const instance = createDeliveryZone({ shape: fileShape, shapeError: fileError, readState: readStateFromDatabase });

// Saves the corners an admin drew (already checked with validateZonePolygon) and applies them to the next order.
async function saveZonePolygon(polygon) {
  const supabase = require('./supabase');
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: SHAPE_KEY, value: { polygon }, updated_at: new Date().toISOString() });
  if (error) throw error;
  instance.clearCache();
}

// Deletes the saved shape, so the starting shape from db/delivery-zone.json is used again.
async function clearZonePolygon() {
  const supabase = require('./supabase');
  const { error } = await supabase.from('site_settings').delete().eq('key', SHAPE_KEY);
  if (error) throw error;
  instance.clearCache();
}

async function logStatus() {
  if (!fileShape) {
    console.error(`Delivery zone could not be read from db/delivery-zone.json (${fileError && fileError.message}). While the delivery area is switched on, home delivery orders are refused until it is fixed.`);
    return;
  }
  try {
    const zone = await instance.current();
    if (zone.reason === 'off') console.warn('Delivery area check is switched OFF in Admin -> Delivery settings: delivery is accepted anywhere.');
    else if (zone.reason === 'no-pin') console.warn('Delivery area is on but the restaurant pin is not saved yet (Admin -> Contact), so delivery is not restricted until it is.');
    else if (zone.source === 'database') console.log('Delivery area active, using the boundary saved in Admin -> Delivery.');
    else if (zone.approximate) console.warn('The delivery area is still the APPROXIMATE starting shape in db/delivery-zone.json (traced from a screenshot). Check it in Admin -> Delivery and click Save delivery area to store it.');
    else console.log('Delivery area active, placed around the restaurant pin from Admin -> Contact.');
  } catch (error) {
    console.error('Could not check the delivery area at startup:', error.message);
  }
}

module.exports = {
  ...instance, logStatus, createDeliveryZone, parseShape, loadShapeFile,
  validateZonePolygon, shapeFromPolygon, saveZonePolygon, clearZonePolygon,
};
