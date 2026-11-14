const supabase = require('./supabase');

// The two big boxes at the top of the cart ("Home Delivery" / "Pick Up"). Their texts and the outline colour are
// edited in Admin -> Cart boxes and stored in site_settings under this key. Anything not saved (or left empty)
// falls back to the built-in texts below, so the cart always has something to show.
const SETTINGS_KEY = 'cart_boxes';
const LANGS = ['en', 'ar', 'ur', 'zh'];
const FIELDS = ['title', 'line1', 'line2', 'line3'];
const BOXES = ['delivery', 'pickup'];
const MAX_LEN = { title: 40, line1: 80, line2: 80, line3: 80 };
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const DEFAULTS = {
  delivery: {
    title: { en: 'Home Delivery', ar: 'توصيل للمنزل', ur: 'ہوم ڈیلیوری', zh: '送货上门' },
    line1: { en: 'West Hamra District area', ar: 'منطقة حي الحمراء الغربي', ur: 'مغربی الحمراء ضلع کا علاقہ', zh: '西哈姆拉区范围' },
    line2: { en: 'Pin your location on the map', ar: 'حدد موقعك على الخريطة', ur: 'نقشے پر اپنا مقام پن کریں', zh: '在地图上标记您的位置' },
    line3: { en: 'Delivery in 30 to 45 minutes', ar: 'التوصيل خلال 30 إلى 45 دقيقة', ur: '30 سے 45 منٹ میں ڈیلیوری', zh: '30 至 45 分钟送达' },
  },
  pickup: {
    title: { en: 'Pick Up', ar: 'استلام', ur: 'پک اپ', zh: '到店自取' },
    line1: { en: 'From the branch', ar: 'من الفرع', ur: 'برانچ سے', zh: '到分店取餐' },
    line2: { en: 'See our location on the map', ar: 'شاهد موقعنا على الخريطة', ur: 'نقشے پر ہمارا مقام دیکھیں', zh: '在地图上查看我们的位置' },
    line3: { en: 'Al-Andalus st. - Tihama Bldg.', ar: 'شارع الأندلس - مبنى تهامة', ur: 'الاندلس اسٹریٹ - تہامہ بلڈنگ', zh: 'Al-Andalus 街 - Tihama 大楼' },
  },
};
const DEFAULT_COLOR = '#e3b23c';

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

// Merge whatever is saved on top of the built-in texts. Never throws on odd saved data: bad pieces are ignored.
function merge(saved) {
  const out = { color: DEFAULT_COLOR };
  const s = isObject(saved) ? saved : {};
  if (typeof s.color === 'string' && COLOR_PATTERN.test(s.color)) out.color = s.color.toLowerCase();
  for (const box of BOXES) {
    out[box] = {};
    for (const field of FIELDS) {
      out[box][field] = {};
      for (const lang of LANGS) {
        const custom = s[box] && s[box][field] && s[box][field][lang];
        out[box][field][lang] = typeof custom === 'string' && custom.trim()
          ? custom.trim().slice(0, MAX_LEN[field])
          : DEFAULTS[box][field][lang];
      }
    }
  }
  return out;
}

// What the admin editor sends back: same shape as merge(); empty text = go back to the built-in text.
function validate(body) {
  if (!isObject(body) || !isObject(body.delivery) || !isObject(body.pickup)) return { ok: false, message: 'Nothing to save.' };
  const color = typeof body.color === 'string' && body.color.trim() ? body.color.trim() : DEFAULT_COLOR;
  if (!COLOR_PATTERN.test(color)) return { ok: false, message: 'The outline colour must look like #e3b23c.' };
  const value = { color: color.toLowerCase() };
  for (const box of BOXES) {
    value[box] = {};
    for (const field of FIELDS) {
      value[box][field] = {};
      for (const lang of LANGS) {
        const raw = body[box] && body[box][field] ? body[box][field][lang] : '';
        if (raw != null && typeof raw !== 'string') return { ok: false, message: 'Texts must be plain text.' };
        const text = String(raw || '').trim();
        if (text.length > MAX_LEN[field]) {
          return { ok: false, message: `A ${field === 'title' ? 'title' : 'line'} can be at most ${MAX_LEN[field]} characters.` };
        }
        value[box][field][lang] = text;
      }
    }
  }
  return { ok: true, value };
}

function isMissingTable(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205');
}

async function readSaved() {
  const { data, error } = await supabase.from('site_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error('Could not read the cart box texts:', error.message);
    return null;
  }
  return data ? data.value : null;
}

// Public: the texts the cart shows (built-in texts where nothing is saved).
async function getCartBoxes() {
  return merge(await readSaved());
}

// Admin: what is saved (empty = built-in text) next to the built-in texts, for the editor.
async function getCartBoxesForAdmin() {
  const saved = await readSaved();
  const effective = merge(saved);
  const custom = { color: effective.color };
  for (const box of BOXES) {
    custom[box] = {};
    for (const field of FIELDS) {
      custom[box][field] = {};
      for (const lang of LANGS) {
        const raw = saved && saved[box] && saved[box][field] && saved[box][field][lang];
        custom[box][field][lang] = typeof raw === 'string' ? raw : '';
      }
    }
  }
  return { saved: custom, defaults: { color: DEFAULT_COLOR, ...DEFAULTS }, effective };
}

async function saveCartBoxes(value) {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

module.exports = { getCartBoxes, getCartBoxesForAdmin, saveCartBoxes, validate, merge, DEFAULTS, DEFAULT_COLOR, LANGS, FIELDS, BOXES, MAX_LEN };
