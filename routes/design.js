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
const MAX_INCLUDES_LENGTH = 300;
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
  // empty = the translated text built into the menu page ("Seaweed Soup, Fried Egg Rice, Noodles, Salad & Water")
  includes_text: { en: '', ar: '', ur: '', zh: '' },
};

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

router.get('/design', async (req, res) => {
  try {
    const { font_path, ...design } = await readDesign();
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