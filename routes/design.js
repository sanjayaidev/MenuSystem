const express = require('express');
const multer = require('multer');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();
const SETTINGS_KEY = 'menu_design';
const BUCKET = 'videos';
const MAX_FONT_BYTES = 4_500_000;
const FONT_TYPES = { '.ttf': 'font/ttf', '.otf': 'font/otf' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FONT_BYTES } });
const LANGUAGES = ['en', 'ar', 'ur', 'zh'];
const LANG_FONTS = ['', 'poppins', 'naskh', 'nastaliq', 'sans-sc', 'cinzel', 'cormorant', 'georgia', 'arial', 'custom'];
const ITEM_STYLE_LANGUAGES = ['en', 'ar', 'zh'];
const ITEM_STYLE_FONTS = ['poppins', 'naskh', 'nastaliq', 'sans-sc', 'cinzel', 'cormorant', 'georgia', 'arial', 'custom'];
const MAX_INCLUDES_LENGTH = 300;
const DEFAULT_GLOBAL_CARD_DESIGN = {
  aspect_ratio: 2.5,
  layout: {
    food_scale: 100, food_width: 100, food_x: 0, food_y: 0,
    bg_x: 50, bg_y: 50, bg_scale: 100,
    card_width: 67, card_height: 100, card_color: '#f6f1e6',
    add_scale: 100, add_x: 0, add_y: 0,
  },
  card: {
    font: '', size: 100, border_w: 1, border_color: '#b8975a',
    food_height: 90, food_overlap: 20, row_gap: 14, card_gap: 24,
    padding_top: 4, padding_side: 3, padding_bottom: 11, radius: 0,
    add_bg: '#e3b23c', add_color: '#1a1408', add_radius: 0, add_font_scale: 100,
  },
};
const GLOBAL_CARD_LAYOUT_RULES = {
  food_scale: [50, 150], food_width: [50, 150], food_x: [-50, 50], food_y: [-50, 50],
  bg_x: [0, 100], bg_y: [0, 100], bg_scale: [100, 200],
  card_width: [40, 85], card_height: [60, 100],
  add_scale: [50, 150], add_x: [-50, 50], add_y: [-50, 50],
};
const GLOBAL_CARD_NUMBER_RULES = {
  size: [50, 250], border_w: [0, 8], food_height: [50, 100], food_overlap: [0, 40],
  row_gap: [0, 40], card_gap: [0, 100], padding_top: [0, 15], padding_side: [0, 15],
  padding_bottom: [0, 20], radius: [0, 24], add_radius: [0, 24], add_font_scale: [50, 200],
};
const GLOBAL_CARD_DESIGN_FIELDS = Object.keys(DEFAULT_GLOBAL_CARD_DESIGN.card);
// size_add = extra px added to every font size on the menu page for that language; font '' = the built-in font for the language.
// Arabic starts 2 px bigger (13/10/2026 request).
const DEFAULT_LANG_STYLE = {
  en: { size_add: 0, font: '' },
  ar: { size_add: 2, font: '' },
  ur: { size_add: 0, font: '' },
  zh: { size_add: 0, font: '' },
};
const DEFAULTS = {
  font_style: 'cinzel', font_size: 14, font_color: '#2b2622', font_path: '', font_url: '',
  lang_style: DEFAULT_LANG_STYLE,
  global_text_style: {},
  global_card_design: DEFAULT_GLOBAL_CARD_DESIGN,
  logo_url: '',
  // empty = the translated text built into the menu page ("Seaweed Soup, Fried Egg Rice, Noodles, Salad & Water")
  includes_text: { en: '', ar: '', ur: '', zh: '' },
  // 16/10/2026: outline around the category boxes ('' = the normal thin grey line) and bold on / off per text.
  // bold = {} means nothing was saved yet, so the menu page keeps its original look.
  chip_outline_color: '', chip_outline_width: 1,
  chip_fill_color: '#1c1a18', chip_active_color: '#e3b23c',
  bold: {},
};
const BOLD_KEYS = ['name', 'price', 'add_to_cart', 'categories', 'description', 'includes'];

async function readDesign() {
  const { data, error } = await supabase.from('site_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, ...(data?.value || {}) };
}

async function writeDesign(value) {
  const { error } = await supabase.from('site_settings').upsert({
    key: SETTINGS_KEY,
    value,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

router.getPublicDesign = async function getPublicDesign() {
  const { font_path, ...design } = await readDesign();
  return design;
};

function globalTextStyleValue(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Global text style is not valid.' };
  const clean = {};
  for (const language of ITEM_STYLE_LANGUAGES) {
    const languageStyle = raw[language];
    if (languageStyle == null) continue;
    if (typeof languageStyle !== 'object' || Array.isArray(languageStyle)) return { error: 'Global text style is not valid.' };
    const languageValue = {};
    for (const part of ['name', 'price']) {
      const rule = languageStyle[part];
      if (rule == null) continue;
      if (typeof rule !== 'object' || Array.isArray(rule)) return { error: 'Global text style is not valid.' };
      const partValue = {};
      for (const [field, value] of Object.entries(rule)) {
        if (!['font', 'size', 'color', 'x', 'y'].includes(field) || value == null || value === '') continue;
        if (field === 'font') {
          if (typeof value !== 'string' || !ITEM_STYLE_FONTS.includes(value)) return { error: `${language.toUpperCase()} ${part}: choose a valid font.` };
          partValue.font = value;
        } else if (field === 'color') {
          if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return { error: `${language.toUpperCase()} ${part}: choose a valid color.` };
          partValue.color = value.toLowerCase();
        } else {
          const limits = field === 'size' ? [50, 250] : [-50, 50];
          const number = Number(value);
          if (!Number.isInteger(number) || number < limits[0] || number > limits[1]) {
            return { error: `${language.toUpperCase()} ${part}: ${field} must be a whole number between ${limits[0]} and ${limits[1]}.` };
          }
          partValue[field] = number;
        }
      }
      if (Object.keys(partValue).length) languageValue[part] = partValue;
    }
    if (Object.keys(languageValue).length) clean[language] = languageValue;
  }
  return { value: clean };
}

function globalCardDesignValue(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Global card design is not valid.' };
  const layout = { ...DEFAULT_GLOBAL_CARD_DESIGN.layout };
  for (const [field, limits] of Object.entries(GLOBAL_CARD_LAYOUT_RULES)) {
    const value = Number(raw.layout?.[field]);
    if (!Number.isInteger(value) || value < limits[0] || value > limits[1]) {
      return { error: `${field} must be a whole number between ${limits[0]} and ${limits[1]}.` };
    }
    layout[field] = value;
  }
  const cardColor = raw.layout?.card_color;
  if (typeof cardColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(cardColor)) {
    return { error: 'Choose a valid card color.' };
  }
  layout.card_color = cardColor.toLowerCase();

  const aspectRatio = Number(raw.aspect_ratio);
  if (!Number.isFinite(aspectRatio) || aspectRatio < 1.5 || aspectRatio > 4) {
    return { error: 'Card aspect ratio must be between 1.5 and 4.' };
  }
  const card = { ...DEFAULT_GLOBAL_CARD_DESIGN.card };
  card.font = typeof raw.card?.font === 'string' ? raw.card.font : '';
  if (card.font && !ITEM_STYLE_FONTS.includes(card.font)) return { error: 'Choose a valid card font.' };
  for (const [field, limits] of Object.entries(GLOBAL_CARD_NUMBER_RULES)) {
    const value = Number(raw.card?.[field]);
    if (!Number.isInteger(value) || value < limits[0] || value > limits[1]) {
      return { error: `${field} must be a whole number between ${limits[0]} and ${limits[1]}.` };
    }
    card[field] = value;
  }
  for (const field of ['border_color', 'add_bg', 'add_color']) {
    const value = raw.card?.[field];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return { error: `Choose a valid ${field.replace('_', ' ')}.` };
    card[field] = value.toLowerCase();
  }
  return { value: { aspect_ratio: Math.round(aspectRatio * 10) / 10, layout, card } };
}

async function applyGlobalCardDesign(cardDesign) {
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data: items, error } = await supabase
      .from('menu_items')
      .select('id, card_style')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!items.length) break;

    const results = await Promise.all(items.map(async item => {
      const style = item.card_style && typeof item.card_style === 'object' && !Array.isArray(item.card_style)
        ? JSON.parse(JSON.stringify(item.card_style))
        : {};
      const card = style.card && typeof style.card === 'object' ? { ...style.card } : {};
      for (const field of GLOBAL_CARD_DESIGN_FIELDS) delete card[field];
      for (const [field, value] of Object.entries(cardDesign.card)) {
        if (field !== 'font' || value) card[field] = value;
      }
      style.card = card;
      const { error: updateError } = await supabase.from('menu_items').update({
        ...cardDesign.layout,
        card_style: style,
      }).eq('id', item.id);
      return updateError;
    }));
    const updateError = results.find(Boolean);
    if (updateError) throw updateError;
    if (items.length < pageSize) break;
  }
}

async function applyGlobalTextStyle(globalStyle) {
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data: items, error } = await supabase
      .from('menu_items')
      .select('id, card_style')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!items.length) break;

    const results = await Promise.all(items.map(async item => {
      const style = item.card_style && typeof item.card_style === 'object' && !Array.isArray(item.card_style)
        ? JSON.parse(JSON.stringify(item.card_style))
        : {};
      for (const language of ITEM_STYLE_LANGUAGES) {
        const languageStyle = style[language] && typeof style[language] === 'object' ? style[language] : {};
        for (const part of ['name', 'price']) {
          const partStyle = languageStyle[part] && typeof languageStyle[part] === 'object' ? { ...languageStyle[part] } : {};
          for (const field of ['font', 'size', 'color', 'x', 'y']) delete partStyle[field];
          Object.assign(partStyle, globalStyle[language]?.[part] || {});
          if (Object.keys(partStyle).length) languageStyle[part] = partStyle;
          else delete languageStyle[part];
        }
        if (Object.keys(languageStyle).length) style[language] = languageStyle;
        else delete style[language];
      }
      const { error: updateError } = await supabase.from('menu_items').update({
        card_style: Object.keys(style).length ? style : null,
      }).eq('id', item.id);
      return updateError;
    }));
    const updateError = results.find(Boolean);
    if (updateError) throw updateError;
    if (items.length < pageSize) break;
  }
}

router.get('/design', async (req, res) => {
  try {
    const design = await router.getPublicDesign();
    res.set('Cache-Control', 'no-store').json({ design });
  } catch (error) {
    console.error('Could not read menu design settings:', error.message);
    res.status(502).json({ error: 'Could not load menu design settings.' });
  }
});

router.get('/admin/design', requireAdmin, async (req, res) => {
  try {
    res.json({ design: await readDesign() });
  } catch (error) {
    console.error('Could not read admin menu design settings:', error.message);
    res.status(502).json({ error: 'Could not load menu design settings.' });
  }
});

router.put('/admin/design', requireAdmin, async (req, res) => {
  const fontStyle = ['cinzel', 'cormorant', 'georgia', 'arial', 'custom'].includes(req.body?.font_style)
    ? req.body.font_style
    : null;
  const fontSize = Number(req.body?.font_size);
  const fontColor = req.body?.font_color;
  if (!fontStyle || !Number.isInteger(fontSize) || fontSize < 10 || fontSize > 30 || !/^#[0-9a-f]{6}$/i.test(fontColor || '')) {
    return res.status(400).json({ error: 'Choose a valid font style, size, and color.' });
  }
  try {
    const design = await readDesign();
    Object.assign(design, { font_style: fontStyle, font_size: fontSize, font_color: fontColor });
    await writeDesign(design);
    res.json({ design });
  } catch (error) {
    console.error('Could not save menu design settings:', error.message);
    res.status(500).json({ error: 'Could not save menu design settings.' });
  }
});

// Language settings: per-language font + size for the menu page, and the editable "This meal automatically includes" text.
router.put('/admin/design/languages', requireAdmin, async (req, res) => {
  const langStyle = {};
  const includes = {};
  for (const language of LANGUAGES) {
    const style = req.body?.lang_style?.[language] || {};
    const sizeAdd = Number(style.size_add);
    const font = typeof style.font === 'string' ? style.font : '';
    if (!Number.isInteger(sizeAdd) || sizeAdd < -6 || sizeAdd > 12) {
      return res.status(400).json({ error: `Font size change for ${language.toUpperCase()} must be a whole number from -6 to 12 px.` });
    }
    if (!LANG_FONTS.includes(font)) {
      return res.status(400).json({ error: `Choose a valid font for ${language.toUpperCase()}.` });
    }
    langStyle[language] = { size_add: sizeAdd, font };

    const text = req.body?.includes_text?.[language];
    if (text != null && typeof text !== 'string') {
      return res.status(400).json({ error: `Includes text for ${language.toUpperCase()} must be text.` });
    }
    const trimmed = (text || '').trim();
    if (trimmed.length > MAX_INCLUDES_LENGTH) {
      return res.status(400).json({ error: `Includes text for ${language.toUpperCase()} is too long (max ${MAX_INCLUDES_LENGTH} characters).` });
    }
    includes[language] = trimmed;
  }
  try {
    const design = await readDesign();
    if (langStyle.en.font === 'custom' || langStyle.ar.font === 'custom' || langStyle.ur.font === 'custom' || langStyle.zh.font === 'custom') {
      if (!design.font_url) return res.status(400).json({ error: 'Upload a custom font first (Menu design > Custom font file).' });
    }
    Object.assign(design, { lang_style: langStyle, includes_text: includes });
    await writeDesign(design);
    res.json({ design });
  } catch (error) {
    console.error('Could not save language settings:', error.message);
    res.status(500).json({ error: 'Could not save the language settings.' });
  }
});

router.put('/admin/design/global-text-style', requireAdmin, async (req, res) => {
  const result = globalTextStyleValue(req.body?.global_text_style);
  if (result.error) return res.status(400).json({ error: result.error });
  try {
    const design = await readDesign();
    await applyGlobalTextStyle(result.value);
    design.global_text_style = result.value;
    await writeDesign(design);
    res.json({ design });
  } catch (error) {
    console.error('Could not apply global dish text style:', error.message);
    const message = /card_style/.test(`${error.message || ''} ${error.details || ''}`)
      ? 'The database has no card_style column yet. Run db/01_tables.sql in the Supabase SQL Editor, then apply the global style again.'
      : 'Could not apply the global text style to all menu items.';
    res.status(500).json({ error: message });
  }
});

router.put('/admin/design/global-card', requireAdmin, async (req, res) => {
  const result = globalCardDesignValue(req.body?.global_card_design);
  if (result.error) return res.status(400).json({ error: result.error });
  try {
    const design = await readDesign();
    await applyGlobalCardDesign(result.value);
    design.global_card_design = result.value;
    await writeDesign(design);
    res.json({ design });
  } catch (error) {
    console.error('Could not apply global card design:', error.message);
    const message = /card_style/.test(`${error.message || ''} ${error.details || ''}`)
      ? 'The database has no card_style column yet. Run db/01_tables.sql in the Supabase SQL Editor, then apply the global card design again.'
      : 'Could not apply the global card design to all menu items.';
    res.status(500).json({ error: message });
  }
});

router.put('/admin/design/branding', requireAdmin, async (req, res) => {
  const logoUrl = typeof req.body?.logo_url === 'string' ? req.body.logo_url.trim() : '';
  if (logoUrl && (logoUrl.length > 2000 || !/^https?:\/\//i.test(logoUrl))) {
    return res.status(400).json({ error: 'Logo must be a valid http:// or https:// image URL.' });
  }
  try {
    const design = await readDesign();
    design.logo_url = logoUrl;
    await writeDesign(design);
    res.json({ design });
  } catch (error) {
    console.error('Could not save site logo:', error.message);
    res.status(500).json({ error: 'Could not save the site logo.' });
  }
});

// Category box outline (any colour) and bold text on / off.
router.put('/admin/design/style', requireAdmin, async (req, res) => {
  const color = typeof req.body?.chip_outline_color === 'string' ? req.body.chip_outline_color.trim() : '';
  const fillColor = typeof req.body?.chip_fill_color === 'string' ? req.body.chip_fill_color.trim() : '#1c1a18';
  const activeColor = typeof req.body?.chip_active_color === 'string' ? req.body.chip_active_color.trim() : '#e3b23c';
  const width = Number(req.body?.chip_outline_width);
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
    return res.status(400).json({ error: 'Choose a valid outline color.' });
  }
  if (!Number.isInteger(width) || width < 1 || width > 4) {
    return res.status(400).json({ error: 'Outline thickness must be a whole number from 1 to 4 px.' });
  }
  if (!/^#[0-9a-f]{6}$/i.test(fillColor) || !/^#[0-9a-f]{6}$/i.test(activeColor)) {
    return res.status(400).json({ error: 'Choose valid category fill colors.' });
  }
  const bold = {};
  for (const key of BOLD_KEYS) bold[key] = req.body?.bold?.[key] === true;
  try {
    const design = await readDesign();
    Object.assign(design, {
      chip_outline_color: color,
      chip_outline_width: width,
      chip_fill_color: fillColor.toLowerCase(),
      chip_active_color: activeColor.toLowerCase(),
      bold,
    });
    await writeDesign(design);
    res.json({ design });
  } catch (error) {
    console.error('Could not save style settings:', error.message);
    res.status(500).json({ error: 'Could not save the style settings.' });
  }
});

router.put('/admin/design/food-background', requireAdmin, async (req, res) => {
  const foodBgUrl = typeof req.body?.food_bg_url === 'string' ? req.body.food_bg_url.trim() : '';
  if (foodBgUrl && (foodBgUrl.length > 2000 || !/^https?:\/\//i.test(foodBgUrl))) {
    return res.status(400).json({ error: 'Food background must be a valid http:// or https:// image URL.' });
  }
  try {
    const design = await readDesign();
    design.food_bg_url = foodBgUrl;
    await writeDesign(design);
    res.json({ design });
  } catch (error) {
    console.error('Could not save shared food background:', error.message);
    res.status(500).json({ error: 'Could not save the shared food background.' });
  }
});

router.post('/admin/design/font', requireAdmin, (req, res, next) => {
  upload.single('font')(req, res, error => {
    if (error) return res.status(400).json({ error: 'Font files must be smaller than 4.5 MB.' });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a TTF or OTF font file.' });
  const extension = path.extname(req.file.originalname).toLowerCase();
  const signature = req.file.buffer.subarray(0, 4);
  const validSignature = signature.equals(Buffer.from([0, 1, 0, 0])) || signature.toString() === 'OTTO';
  if (!FONT_TYPES[extension] || !validSignature) {
    return res.status(400).json({ error: 'Choose a valid TTF or OTF font file.' });
  }

  const objectPath = `fonts/menu-font-${Date.now()}${extension}`;
  try {
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, req.file.buffer, {
      contentType: FONT_TYPES[extension],
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const design = await readDesign();
    const previousPath = design.font_path;
    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
    Object.assign(design, {
      font_style: 'custom',
      font_path: objectPath,
      font_url: `${publicUrl}?v=${Date.now()}`,
    });
    await writeDesign(design);
    if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]).catch(() => {});
    res.json({ design });
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => {});
    console.error('Could not upload menu font:', error.message);
    res.status(500).json({ error: 'Could not upload the font file.' });
  }
});

module.exports = router;