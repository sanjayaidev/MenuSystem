const CARD_FONTS = {
  poppins: "'Poppins',sans-serif",
  naskh: "'Noto Naskh Arabic','Poppins',sans-serif",
  nastaliq: "'Noto Nastaliq Urdu','Poppins',sans-serif",
  'sans-sc': "'Noto Sans SC','Poppins',sans-serif",
  cinzel: "'Cinzel','Cormorant Garamond',Georgia,'Times New Roman',serif",
  cormorant: "'Cormorant Garamond',Georgia,'Times New Roman',serif",
  georgia: "Georgia,'Times New Roman',serif",
  arial: 'Arial,Helvetica,sans-serif',
  custom: "'MenuCustom',serif",
};
const LANGUAGES = ['en', 'ar', 'ur', 'zh'];
const ADD_TO_CART = {
  en: 'Add to cart',
  ar: 'أضف إلى السلة',
  ur: 'کارٹ میں شامل کریں',
  zh: '加入购物车',
};
const FALLBACK_ICON = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="30" fill="none" stroke="#3a3630" stroke-width="3"/><circle cx="50" cy="50" r="18" fill="none" stroke="#3a3630" stroke-width="2"/></svg>';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  try {
    const parsed = new URL(raw, 'https://menu.invalid');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return raw;
  } catch {
    return '';
  }
}

function amountText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Math.abs(number - Math.round(number)) < 0.005 ? String(Math.round(number)) : number.toFixed(2);
}

function moneyHtml(value) {
  return `<span class="money"><svg class="riyal" viewBox="0 0 1124.14 1256.39" role="img" aria-label="SAR"><use href="#riyal-sign"/></svg>${amountText(value)}</span>`;
}

function cardStyleVars(style, language) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return '';
  const out = [];
  const card = style.card && typeof style.card === 'object' ? style.card : {};
  const integer = (value, min, max) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : null;
  };
  const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '';
  const font = value => CARD_FONTS[value] || '';
  const set = (name, value) => { if (value !== null && value !== '') out.push(`${name}:${value}`); };

  if (font(card.font)) set('--cs-font', font(card.font));
  const cardSize = integer(card.size, 50, 250);
  const borderWidth = integer(card.border_w, 0, 8);
  if (cardSize !== null) set('--cs-size', cardSize / 100);
  if (borderWidth !== null) set('--cs-border-w', `${borderWidth}px`);
  if (color(card.border_color)) set('--cs-border-color', card.border_color);

  for (const [field, min, max, variable, unit] of [
    ['food_height', 50, 100, '--cs-food-height', '%'], ['food_overlap', 0, 40, '--cs-food-overlap', '%'],
    ['row_gap', 0, 40, '--cs-row-gap', 'px'], ['card_gap', 0, 100, '--cs-card-gap', ''],
    ['padding_top', 0, 15, '--cs-padding-top', ''], ['padding_side', 0, 15, '--cs-padding-side', ''],
    ['padding_bottom', 0, 20, '--cs-padding-bottom', ''], ['radius', 0, 24, '--cs-radius', 'px'],
    ['add_radius', 0, 24, '--cs-add-radius', 'px'],
  ]) {
    const number = integer(card[field], min, max);
    if (number !== null) set(variable, `${number}${unit}`);
  }
  if (color(card.add_bg)) set('--cs-add-bg', card.add_bg);
  if (color(card.add_color)) set('--cs-add-color', card.add_color);
  const addFontScale = integer(card.add_font_scale, 50, 200);
  if (addFontScale !== null) set('--cs-add-font-scale', addFontScale / 100);

  const languageStyle = style[language] && typeof style[language] === 'object' ? style[language] : {};
  for (const part of ['name', 'price']) {
    const rule = languageStyle[part] && typeof languageStyle[part] === 'object' ? languageStyle[part] : {};
    if (font(rule.font)) set(`--cs-${part}-font`, font(rule.font));
    const size = integer(rule.size, 50, 250);
    const x = integer(rule.x, -50, 50);
    const y = integer(rule.y, -50, 50);
    if (size !== null) set(`--cs-${part}-size`, size / 100);
    if (color(rule.color)) set(`--cs-${part}-color`, rule.color);
    if (x !== null) set(`--cs-${part}-x`, x);
    if (y !== null) set(`--cs-${part}-y`, y);
  }
  return out.length ? `${escapeHtml(out.join(';'))};` : '';
}

function categoryMarkup(categories, language) {
  const popularLabels = { en: 'Most Popular', ar: 'الأكثر طلباً', ur: 'سب سے مقبول', zh: '最受欢迎' };
  const values = [...categories, { key: '__popular', sort_order: 8, label_en: popularLabels.en, label_ar: popularLabels.ar, label_ur: popularLabels.ur, label_zh: popularLabels.zh }]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  return values.map(category => {
    const label = category[`label_${language}`] || category.label_en || category.key;
    return `<button type="button" class="cat-chip" data-cat="${escapeHtml(category.key)}" aria-pressed="false">${escapeHtml(label)}</button>`;
  }).join('');
}

function itemMarkup(item, language, design) {
  const name = item[`name_${language}`] || item.name_en || '';
  const category = item.categories?.key || '';
  const hasImageUrl = Boolean(String(item.image_path || '').trim() || String(item.food_png_url || '').trim());
  const foodPng = safeImageUrl(item.food_png_url);
  const imagePath = safeImageUrl(item.image_path);
  const foodUrl = foodPng || (hasImageUrl ? imagePath : `images/${String(category).toLowerCase().replace(/[^a-z0-9]/g, '')}/${String(item.name_en || '').toLowerCase().replace(/[^a-z0-9]/g, '')}.png`);
  const backgroundUrl = safeImageUrl(design.food_bg_url) || safeImageUrl(item.bg_image_url);
  const cardColor = /^#[0-9a-f]{6}$/i.test(item.card_color || '') ? item.card_color : '#f6f1e6';
  const numeric = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const foodScale = item.food_scale == null ? 1 : numeric(item.food_scale, 50, 150, 100) / 100;
  const foodX = numeric(item.food_x, -50, 50, 0);
  const foodY = numeric(item.food_y, -50, 50, 0);
  const bgX = numeric(item.bg_x, 0, 100, 50);
  const bgY = numeric(item.bg_y, 0, 100, 50);
  const bgScale = item.bg_scale == null ? 1 : numeric(item.bg_scale, 100, 200, 100) / 100;
  const foodWidth = numeric(item.food_width, 50, 150, 100) / 100;
  const cardWidth = numeric(item.card_width, 40, 85, 66.6667);
  const cardHeight = numeric(item.card_height, 60, 100, 100);
  const priceX = numeric(item.price_x, -50, 50, 0);
  const priceY = numeric(item.price_y, -50, 50, 0);
  const addScale = numeric(item.add_scale, 50, 150, 100) / 100;
  const addX = numeric(item.add_x, -50, 50, 0);
  const addY = numeric(item.add_y, -50, 50, 0);
  const hasUsableImage = Boolean(foodPng) || hasImageUrl;
  const corner = position => `<svg class="corner ${position}" viewBox="0 0 48 48" aria-hidden="true"><use href="#rh-corner"/></svg>`;
  const rowStyle = `${cardStyleVars(item.card_style, language)}--paper:${cardColor};--paper-edge:color-mix(in srgb, ${cardColor}, #000 8%);--food-scale:${foodScale};--food-x:${foodX}%;--food-y:${foodY}%;--bg-x:${bgX}%;--bg-y:${bgY}%;--bg-scale:${bgScale};--food-width:${foodWidth};--card-w:${cardWidth}%;--card-h:${cardHeight}%;--price-x:${priceX};--price-y:${priceY};--add-x:${addX};--add-y:${addY};--add-scale:${addScale}`;
  const addLabel = ADD_TO_CART[language] || ADD_TO_CART.en;

  return `<article class="row" data-id="${escapeHtml(item.id)}" style="${rowStyle}">
    ${backgroundUrl ? `<img class="bg" src="${escapeHtml(backgroundUrl)}" alt="" loading="lazy" decoding="async">` : ''}
    <div class="card">${corner('tl')}${corner('tr')}${corner('bl')}${corner('br')}<svg class="flourish" viewBox="0 0 120 24" aria-hidden="true"><use href="#rh-flourish"/></svg><h3 class="name">${escapeHtml(name)}</h3><p class="price">${moneyHtml(item.price)}</p></div>
    <div class="food">${foodUrl ? `<img src="${escapeHtml(foodUrl)}" alt="" loading="lazy" decoding="async" data-cat="${escapeHtml(category)}" data-has-image-url="${hasUsableImage}">` : ''}${!hasUsableImage ? `<div class="thumb-fallback">${FALLBACK_ICON}</div>` : ''}</div>
    <button class="open" type="button" aria-label="${escapeHtml(name)}"></button>
    <button class="add" type="button"><span>${escapeHtml(addLabel)}</span><b>${moneyHtml(item.price)}</b></button>
  </article>`;
}

function menuMarkup(items, language, design) {
  const ordered = [...items].sort((a, b) => {
    const first = a.display_order == null ? Infinity : Number(a.display_order);
    const second = b.display_order == null ? Infinity : Number(b.display_order);
    return first === second ? Number(a.id) - Number(b.id) : first - second;
  });
  if (!ordered.length) return '<div class="empty">No dishes in this category yet.</div>';
  return ordered.map(item => itemMarkup(item, language, design)).join('');
}

function designCss(design, language) {
  const vars = [];
  const fontFamilies = {
    cinzel: "'Cinzel','Cormorant Garamond',Georgia,'Times New Roman',serif",
    cormorant: "'Cormorant Garamond',Georgia,'Times New Roman',serif",
    georgia: "Georgia,'Times New Roman',serif",
    arial: 'Arial,Helvetica,sans-serif',
  };
  const family = design.font_style === 'custom' ? "'MenuCustom',serif" : (fontFamilies[design.font_style] || fontFamilies.cinzel);
  vars.push(`--menu-font-family:${family}`, `--menu-font-scale:${(Number(design.font_size) || 14) / 4.375}`);
  if (/^#[0-9a-f]{6}$/i.test(design.font_color || '')) vars.push(`--menu-font-color:${design.font_color}`);
  if (/^#[0-9a-f]{6}$/i.test(design.chip_fill_color || '')) vars.push(`--chip-fill:${design.chip_fill_color}`);
  if (/^#[0-9a-f]{6}$/i.test(design.chip_active_color || '')) vars.push(`--chip-active-fill:${design.chip_active_color}`);
  if (/^#[0-9a-f]{6}$/i.test(design.chip_outline_color || '')) {
    vars.push(`--chip-line:${design.chip_outline_color}`, `--chip-line-w:${Math.min(4, Math.max(1, Number(design.chip_outline_width) || 1))}px`);
  }
  const ratio = Number(design.global_card_design?.aspect_ratio);
  if (Number.isFinite(ratio) && ratio >= 1.5 && ratio <= 4) vars.push(`--menu-card-ratio:${ratio}`);
  const defaultAdd = { en: 0, ar: 2, ur: 0, zh: 0 }[language] || 0;
  const langStyle = design.lang_style?.[language] || {};
  const langAdd = Number.isFinite(Number(langStyle.size_add)) ? Number(langStyle.size_add) : defaultAdd;
  vars.push(`--lang-add:${langAdd}px`);
  const langFont = { poppins: "'Poppins',sans-serif", naskh: "'Noto Naskh Arabic','Poppins',sans-serif", nastaliq: "'Noto Nastaliq Urdu','Poppins',sans-serif", 'sans-sc': "'Noto Sans SC','Poppins',sans-serif", cinzel: fontFamilies.cinzel, cormorant: fontFamilies.cormorant, georgia: fontFamilies.georgia, arial: fontFamilies.arial, custom: "'MenuCustom',serif" }[langStyle.font];
  if (langFont) vars.push(`--lang-font:${langFont}`);
  return `:root{${vars.join(';')}}`;
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function renderMenuPage(template, { categories, items, design, language, posterUrl }) {
  let html = template.replace(/<html lang="[^"]*">/i, `<html lang="${language}" dir="${['ar', 'ur'].includes(language) ? 'rtl' : 'ltr'}">`);
  const logoUrl = safeImageUrl(design.logo_url) || 'images/rhclogo.png';
  html = html.replace(/(<img id="logoImg" src=")[^"]*(")/, (_, before, after) => `${before}${escapeHtml(logoUrl)}${after}`);
  if (safeImageUrl(posterUrl)) {
    html = html.replace('src="images/page2img.jpeg"', `src="${escapeHtml(posterUrl)}"`);
  }
  html = html.replace(/<div class="cat-row" id="categoryRow" role="group" aria-label="Filter by category"><\/div>/, `<div class="cat-row" id="categoryRow" role="group" aria-label="Filter by category">${categoryMarkup(categories, language)}</div>`);
  html = html.replace('<main id="list"></main>', `<main id="list">${menuMarkup(items, language, design)}</main>`);
  const data = safeJson({ categories, items, design });
  html = html.replace('</head>', `<style id="ssr-design-vars">${designCss(design, language)}</style><script>window.__MENU_SSR__=${data};</script></head>`);
  return html;
}

module.exports = { renderMenuPage };