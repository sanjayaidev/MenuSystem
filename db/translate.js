// Auto-translation of menu text from English into Arabic and Simplified Chinese, using the Gemini API.
// Server-side only: the key comes from GEMINI_API_KEY and is never sent to the browser.
// Urdu is not translated (it is hidden in the admin for now).

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Pinned on purpose: "-latest" aliases can silently move to a newer model. Override with GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const TARGETS = ['ar', 'zh'];
const REQUEST_TIMEOUT_MS = 30000;

class TranslateError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function buildPrompt(items) {
  return [
    'You translate text for a Chinese restaurant menu from English into Arabic (key "ar") and Simplified Chinese (key "zh").',
    'Rules:',
    '- The text is food and restaurant text. Use the wording a real menu would use. Never add or invent ingredients or claims.',
    '- Keep dish names natural. For well-known dishes use the standard name in that language (for example Kung Pao Chicken is 宫保鸡丁 in Chinese).',
    '- Keep numbers, prices and units unchanged.',
    '- Keep any **double-star** bold markers around the same words in the translation.',
    '- Arabic must be Modern Standard Arabic, written right to left. Do not add diacritics.',
    '- Do not add explanations, quotes or notes.',
    'Input is a JSON array of {"id","text"}. Return only a JSON array of {"id","ar","zh"}, one entry per input id.',
    JSON.stringify(items),
  ].join('\n');
}

// texts: { someId: "English text", ... }  ->  { someId: { ar: "...", zh: "..." }, ... }
async function translateTexts(texts) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new TranslateError('GEMINI_API_KEY is not configured on the server.', 503);

  const ids = Object.keys(texts);
  const items = ids.map(id => ({ id, text: texts[id] }));
  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();

  let response;
  try {
    response = await fetch(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      // the key goes in a header, not the URL, so it cannot leak into logs or error text
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(items) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new TranslateError(timedOut ? 'Translation took too long. Try again.' : 'Could not reach the translation service.');
  }

  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { /* not JSON */ }

  if (!response.ok) {
    const detail = body && body.error && body.error.message ? body.error.message : '';
    console.error('Gemini translate failed:', response.status, detail);
    if (response.status === 429) throw new TranslateError('Translation limit reached. Wait a minute and try again.', 429);
    if (response.status === 400 && /api key/i.test(detail)) throw new TranslateError('The translation key is not valid. Check GEMINI_API_KEY on the server.', 503);
    if (response.status === 401 || response.status === 403) throw new TranslateError('The translation key was refused by Google.', 503);
    if (response.status === 404) throw new TranslateError(`Translation model "${model}" was not found. Set GEMINI_MODEL on the server.`, 503);
    throw new TranslateError('The translation service returned an error.');
  }

  const parts = body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts;
  const reply = Array.isArray(parts) ? parts.map(part => part.text || '').join('') : '';
  let parsed;
  try { parsed = JSON.parse(reply); } catch { throw new TranslateError('The translation came back in an unexpected form. Try again.'); }
  if (!Array.isArray(parsed)) throw new TranslateError('The translation came back in an unexpected form. Try again.');

  const byId = new Map(parsed.filter(entry => entry && typeof entry.id === 'string').map(entry => [entry.id, entry]));
  const result = {};
  for (const id of ids) {
    const entry = byId.get(id);
    result[id] = {};
    for (const language of TARGETS) {
      const value = entry && typeof entry[language] === 'string' ? entry[language].trim() : '';
      if (!value) throw new TranslateError('The translation was incomplete. Try again.');
      result[id][language] = value;
    }
  }
  return result;
}

module.exports = { translateTexts, TranslateError, TARGETS };
