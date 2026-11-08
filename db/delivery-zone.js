// Delivery zone: the area home delivery is allowed in, and the check that keeps out-of-zone orders away
// from the payment step. The boundary lives in db/delivery-zone.json (GeoJSON, coordinates are [lng, lat]).
// Paste the output of geojson.io (a Polygon, MultiPolygon, Feature or FeatureCollection) into that file to
// change the zone, then redeploy. No outside service or library is used.
//
//   DELIVERY_ZONE_ENFORCED=0   turns the check off (delivery accepted anywhere); anything else keeps it on.

const fs = require('fs');
const path = require('path');
const { toPoint } = require('./geo');

const ZONE_FILE = path.join(__dirname, 'delivery-zone.json');
const ENFORCED = process.env.DELIVERY_ZONE_ENFORCED !== '0';

// ---------- loading ----------

function collectPolygons(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FeatureCollection') (node.features || []).forEach((f) => collectPolygons(f, out));
  else if (node.type === 'Feature') collectPolygons(node.geometry, out);
  else if (node.type === 'Polygon') out.push(node.coordinates);
  else if (node.type === 'MultiPolygon') (node.coordinates || []).forEach((p) => out.push(p));
}

function cleanRing(ring) {
  if (!Array.isArray(ring)) throw new Error('a ring is not a list of points');
  const points = ring.map((p) => {
    const lng = Number(p && p[0]);
    const lat = Number(p && p[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      throw new Error('a point is not a valid [lng, lat] pair');
    }
    return [lng, lat];
  });
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length && (first[0] !== last[0] || first[1] !== last[1])) points.push([first[0], first[1]]);
  if (points.length < 4) throw new Error('a ring needs at least 3 distinct points');
  return points;
}

function loadZone() {
  const raw = JSON.parse(fs.readFileSync(ZONE_FILE, 'utf8'));
  const found = [];
  collectPolygons(raw, found);
  if (!found.length) throw new Error('no Polygon or MultiPolygon found');
  const polygons = found.map((polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('a polygon has no rings');
    return polygon.map(cleanRing);
  });

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  polygons.forEach((polygon) => polygon[0].forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }));

  // Optional "center" in the first feature's properties; otherwise the middle of the bounding box.
  const props = (raw.type === 'FeatureCollection' ? (raw.features || [])[0] : raw) || {};
  const given = props.properties && toPoint(props.properties.center && props.properties.center.lat, props.properties.center && props.properties.center.lng);
  const center = given || toPoint((minLat + maxLat) / 2, (minLng + maxLng) / 2);
  const placeholder = Boolean(props.properties && props.properties.placeholder);
  const approximate = Boolean(props.properties && props.properties.approximate);
  return { polygons, center, placeholder, approximate, bbox: [minLng, minLat, maxLng, maxLat] };
}

let zone = null;
let loadError = null;
try {
  zone = loadZone();
} catch (error) {
  loadError = error;
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

// true when the point is inside the zone or on its edge; null when no zone could be loaded.
function contains(lat, lng) {
  if (!zone) return null;
  return zone.polygons.some((rings) => inPolygon(lng, lat, rings));
}

// ---------- order check ----------

const isCoordInput = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '');

// Used by POST /api/orders for every home-delivery order.
// Returns { ok: true, point } or { ok: false, status, code, message }.
function checkDeliveryPoint(lat, lng) {
  const point = isCoordInput(lat) && isCoordInput(lng) ? toPoint(lat, lng) : null;
  if (!ENFORCED) return { ok: true, point };
  if (!point) {
    return { ok: false, status: 400, code: 'LOCATION_REQUIRED', message: 'Please drop the pin on your delivery location, or choose Self-Pickup.' };
  }
  const inside = contains(point.lat, point.lng);
  if (inside === null) {
    return { ok: false, status: 503, code: 'ZONE_UNAVAILABLE', message: 'Home delivery is temporarily unavailable. Please choose Self-Pickup.' };
  }
  if (!inside) {
    return { ok: false, status: 422, code: 'OUT_OF_ZONE', message: 'This location is outside our delivery area. Please choose Self-Pickup.' };
  }
  return { ok: true, point };
}

// What the browser needs (GET /api/config): the same polygon the server checks against.
function publicZone() {
  return {
    enforced: ENFORCED,
    center: zone ? zone.center : null,
    geometry: zone ? { type: 'MultiPolygon', coordinates: zone.polygons } : null,
  };
}

function logStatus() {
  if (!ENFORCED) { console.warn('Delivery zone check is OFF (DELIVERY_ZONE_ENFORCED=0): delivery is accepted anywhere.'); return; }
  if (!zone) {
    console.error(`Delivery zone could not be loaded from db/delivery-zone.json (${loadError && loadError.message}). Home delivery orders are refused until it is fixed.`);
    return;
  }
  if (zone.placeholder) {
    console.warn('Delivery zone is still the PLACEHOLDER rectangle in db/delivery-zone.json. Replace it with the real district boundary before going live.');
  } else if (zone.approximate) {
    console.warn('Delivery zone in db/delivery-zone.json is APPROXIMATE (traced from a screenshot). Calibrate it with the restaurant\'s exact coordinates, then remove "approximate" from the file.');
  } else {
    console.log('Delivery zone loaded from db/delivery-zone.json.');
  }
}

module.exports = { contains, checkDeliveryPoint, publicZone, logStatus };
