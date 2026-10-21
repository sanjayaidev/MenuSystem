const supabase = require('./supabase');

const SETTINGS_KEY = 'delivery';
const DEFAULT_FEE = process.env.DELIVERY_FEE == null ? 20 : Number(process.env.DELIVERY_FEE);
const DEFAULT_ENABLED = process.env.DELIVERY_FEE_ENABLED !== '0';
if (!Number.isFinite(DEFAULT_FEE) || DEFAULT_FEE < 0 || DEFAULT_FEE > 100000 || Math.round(DEFAULT_FEE * 100) !== DEFAULT_FEE * 100) {
  console.error('DELIVERY_FEE must be between 0 and 100000 with at most two decimal places. Using the default delivery fee of 20.');
}
if (process.env.DELIVERY_FEE_ENABLED != null && !['0', '1'].includes(process.env.DELIVERY_FEE_ENABLED)) {
  console.error('DELIVERY_FEE_ENABLED must be 0 or 1. Delivery cost remains enabled.');
}
const configuredCurrency = (process.env.CURRENCY || 'SAR').toUpperCase();
let CURRENCY = configuredCurrency;
try {
  new Intl.NumberFormat('en', { style: 'currency', currency: configuredCurrency });
} catch {
  console.error(`Invalid CURRENCY value "${configuredCurrency}". Falling back to SAR.`);
  CURRENCY = 'SAR';
}
const CURRENCY_DIGITS = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: CURRENCY,
}).resolvedOptions().maximumFractionDigits;

function defaultSettings() {
  return {
    enabled: DEFAULT_ENABLED,
    amount: Number.isFinite(DEFAULT_FEE) && DEFAULT_FEE >= 0 && DEFAULT_FEE <= 100000
      && Math.round(DEFAULT_FEE * 100) === DEFAULT_FEE * 100
      ? DEFAULT_FEE
      : 20,
  };
}

async function getDeliverySettings() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();

  if (error) throw error;
  if (!data) return defaultSettings();

  const value = data.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.enabled !== 'boolean'
      || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0
      || value.amount > 100000 || Math.round(value.amount * 100) !== value.amount * 100) {
    throw new Error('Saved delivery settings are invalid.');
  }
  return { enabled: value.enabled, amount: value.amount };
}

async function saveDeliverySettings(settings) {
  const { error } = await supabase
    .from('site_settings')
    .upsert({
      key: SETTINGS_KEY,
      value: settings,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

module.exports = { getDeliverySettings, saveDeliverySettings, CURRENCY, CURRENCY_DIGITS };
