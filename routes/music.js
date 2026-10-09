const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { requireAdmin } = require('../middleware/auth');
const supabase = require('../db/supabase');

// Background music for the two public pages. Admin uploads one track per page;
// it is re-encoded to a small MP3 (so it fits the `videos` bucket's 5 MB limit),
// stored at music/<page>.mp3 and described in site_settings under the key "music".
const router = express.Router();

const ROOT = path.join(__dirname, '..');
const TMP_DIR = path.join(os.tmpdir(), 'redhouse-music-uploads');
const FFMPEG_PATH = path.join(ROOT, 'ffmpeg');
const BUCKET = 'videos';
const PAGES = ['index', 'menu'];
const SETTINGS_KEY = 'music';
const MAX_SECONDS = 300;               // 5 min at 96 kbps is about 3.6 MB
const MAX_OUTPUT_BYTES = 4_500_000;
const MAX_NAME_LENGTH = 120;
const ALLOWED_EXT = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.webm', '.mp4'];

fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported audio type "${ext}". Allowed: ${ALLOWED_EXT.join(', ')}`));
  },
});

let busy = false;

function isMissingTable(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205');
}

function objectPath(page) {
  return `music/${page}.mp3`;
}

function publicUrl(page, version) {
  const url = supabase.storage.from(BUCKET).getPublicUrl(objectPath(page)).data.publicUrl;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

async function readSettings() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error('Could not read music settings:', error.message);
    return {};
  }
  return (data && data.value) || {};
}

async function writeSettings(value) {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// What the browser needs: for each page either null (no track) or { url, name, enabled }.
async function currentMusic() {
  const settings = await readSettings();
  const result = {};
  PAGES.forEach((page) => {
    const entry = settings[page];
    result[page] = entry && entry.path
      ? { url: publicUrl(page, entry.updated_at), name: entry.name || '', enabled: entry.enabled !== false }
      : null;
  });
  return result;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_PATH, args, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).split('\n').slice(-4).join('\n')));
      resolve();
    });
  });
}

async function encodeAudio(sourcePath, outputPath) {
  try { fs.chmodSync(FFMPEG_PATH, 0o755); } catch { /* best effort */ }
  await runFfmpeg([
    '-y', '-i', sourcePath, '-vn', '-map_metadata', '-1', '-t', String(MAX_SECONDS),
    '-c:a', 'libmp3lame', '-b:a', '96k', '-ar', '44100', '-ac', '2', outputPath,
  ]);
  if (fs.statSync(outputPath).size >= MAX_OUTPUT_BYTES) {
    throw new Error('Encoded audio exceeds the 4.5 MB output limit.');
  }
}

function pageParam(req, res) {
  const page = req.params.page;
  if (!PAGES.includes(page)) {
    res.status(404).json({ error: 'Unknown page. Use "index" or "menu".' });
    return null;
  }
  return page;
}

function tableMissingResponse(res) {
  return res.status(500).json({ error: 'The site_settings table is missing. Run db/06_site_settings.sql in Supabase.' });
}

// GET /api/music (public) - { index: {url,name,enabled}|null, menu: {...}|null }
router.get('/music', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    res.json(await currentMusic());
  } catch (error) {
    console.error('Could not read music settings:', error);
    res.status(502).json({ error: 'Could not load the music settings.' });
  }
});

// POST /api/admin/music/:page (admin) - multipart field "audio"; encodes and stores the track.
router.post('/admin/music/:page', requireAdmin, (req, res) => {
  const page = pageParam(req, res);
  if (!page) return;
  if (busy) return res.status(409).json({ error: 'A music file is already being processed. Please wait.' });
  busy = true;

  upload.single('audio')(req, res, async (uploadError) => {
    if (uploadError) {
      busy = false;
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? 'Source audio must be smaller than 60 MB.' : uploadError.message });
    }
    if (!req.file) {
      busy = false;
      return res.status(400).json({ error: 'No audio file received.' });
    }

    const sourcePath = req.file.path;
    const outputPath = path.join(TMP_DIR, `${Date.now()}-${page}.mp3`);
    try {
      await encodeAudio(sourcePath, outputPath);

      const { error: storageError } = await supabase.storage.from(BUCKET).upload(
        objectPath(page), await fs.promises.readFile(outputPath),
        { contentType: 'audio/mpeg', upsert: true, cacheControl: '3600' }
      );
      if (storageError) throw storageError;

      const settings = await readSettings();
      const name = path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, MAX_NAME_LENGTH);
      settings[page] = { path: objectPath(page), name, enabled: true, updated_at: new Date().toISOString() };
      await writeSettings(settings);

      res.json({ success: true, music: await currentMusic() });
    } catch (error) {
      console.error('Music upload failed:', error);
      if (isMissingTable(error)) return tableMissingResponse(res);
      const tooLarge = error.message && error.message.includes('4.5 MB');
      const isStorageError = error.message && /bucket|storage|object/i.test(error.message);
      res.status(tooLarge ? 400 : isStorageError ? 502 : 500).json({
        error: tooLarge
          ? error.message
          : isStorageError
            ? 'Could not access the videos storage bucket.'
            : 'Could not process this audio file. Try an MP3.',
      });
    } finally {
      await Promise.all([sourcePath, outputPath].map((file) => fs.promises.unlink(file).catch(() => {})));
      busy = false;
    }
  });
});

// PATCH /api/admin/music/:page (admin) - { enabled: boolean } turns the track on/off without deleting it.
router.patch('/admin/music/:page', requireAdmin, async (req, res) => {
  const page = pageParam(req, res);
  if (!page) return;
  const enabled = req.body && req.body.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: '"enabled" must be true or false.' });
  try {
    const settings = await readSettings();
    if (!settings[page] || !settings[page].path) return res.status(404).json({ error: 'No music uploaded for this page.' });
    settings[page] = { ...settings[page], enabled, updated_at: settings[page].updated_at };
    await writeSettings(settings);
    res.json({ success: true, music: await currentMusic() });
  } catch (error) {
    console.error('Music update failed:', error);
    if (isMissingTable(error)) return tableMissingResponse(res);
    res.status(500).json({ error: 'Could not update the music settings.' });
  }
});

// DELETE /api/admin/music/:page (admin) - removes the track.
router.delete('/admin/music/:page', requireAdmin, async (req, res) => {
  const page = pageParam(req, res);
  if (!page) return;
  try {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([objectPath(page)]);
    if (storageError) return res.status(502).json({ error: 'Could not access the videos storage bucket.' });
    const settings = await readSettings();
    delete settings[page];
    await writeSettings(settings);
    res.json({ success: true, music: await currentMusic() });
  } catch (error) {
    console.error('Music removal failed:', error);
    if (isMissingTable(error)) return tableMissingResponse(res);
    res.status(500).json({ error: 'Could not remove the music.' });
  }
});

module.exports = router;
