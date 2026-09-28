// Resolve an order reference from a URL/query into a column + value.
// Accepts the public order number ("RH-260928-0042", case-insensitive) or the
// legacy numeric id ("42"). Returns null if it is neither, so callers can 404
// without ever sending junk to the database.
function parseOrderRef(ref) {
  const value = String(ref || '').trim();
  if (/^RH-\d{6}-\d{4,}$/i.test(value)) {
    return { column: 'order_number', value: value.toUpperCase() };
  }
  if (/^\d{1,15}$/.test(value)) {
    return { column: 'id', value: Number(value) };
  }
  return null;
}

// Make free-text safe to drop into a PostgREST .or() filter string.
function sanitizeSearch(text) {
  return String(text || '').replace(/[^A-Za-z0-9+\- ]/g, '').trim().slice(0, 40);
}

module.exports = { parseOrderRef, sanitizeSearch };
