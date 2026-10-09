const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { requireAdmin } = require('../middleware/auth');
const supabase = require('../db/supabase');

// The poster / offer image at the top of the menu page (/menu).
// Admin uploads one image; it is stored in the public `videos` bucket under poster/
// and described in site_settings under the key "menu_poster". No image set (or
// Supabase unreachable) = the page keeps its bundled default, frontend/images/page2img.jpeg.
const router = express.Router();

const ROOT = path.join(__dirname, '..');
const TMP_DIR = path.join(os.tmpdir(), 'redhouse-poster-uploads');
const FFMPEG_PATH = path.join(ROOT, 'ffmpeg');
const BUCKET = 'videos';             // same public bucket as the hero video and music (5 MB per file)
const SETTINGS_KEY = 'menu_poster';
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4_500_000;  // stay under the bucket's 5 MB limit
const MAX_NAME_LENGTH = 120;
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const CACHE_MS = 30 * 1000;

fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_SOURCE_BYTES },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported image type "${ext}". Allowed: PNG, JPG, WEBP.`));
  },
});

let busy = false;
let cache = { at: 0, url: null };

function isMissingTable(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205');
}

function publicUrl(objectPath, version) {
  const url = supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

async function readSettings() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error('Could not read poster settings:', error.message);
    return {};
  }
  return (data && data.value) || {};
}

async function writeSettings(value) {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  cache = { at: 0, url: null };
}

// What the browser needs: { url, name } or null when the default image should be used.
async function currentPoster() {
  const settings = await readSettings();
  if (!settings.path) return null;
  return { url: publicUrl(settings.path, settings.updated_at), name: settings.name || '' };
}

// Used by server.js to put the right <img src> into the menu page HTML (short in-memory cache).
async function getPosterUrl() {
  if (Date.now() - cache.at < CACHE_MS) return cache.url;
  try {
    const poster = await currentPoster();
    cache = { at: Date.now(), url: poster ? poster.url : null };
  } catch (error) {
    console.error('Could not read the menu poster:', error.message);
    cache = { at: Date.now() - CACHE_MS + 5000, url: null }; // retry in 5 s
  }
  return cache.url;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_PATH, args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).split('\n').slice(-4).join('\n')));
      resolve();
    });
  });
}

// Check the real file signature, not just the extension.
function detectType(buffer) {
  if (buffer.length > 12 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: '.png', contentType: 'image/png' };
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', contentType: 'image/jpeg' };
  }
  if (buffer.length > 12 && buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
    return { ext: '.webp', contentType: 'image/webp' };
  }
  return null;
}

// Files within the 4.5 MB limit are stored exactly as uploaded. Larger ones are re-encoded
// as a high-quality JPEG (max 1600 px wide) so they fit the storage bucket.
async function prepareImage(sourcePath, outputPath) {
  const original = await fs.promises.readFile(sourcePath);
  const type = detectType(original);
  if (!type) throw new Error('Unsupported image type. Allowed: PNG, JPG, WEBP.');
  if (original.length < MAX_OUTPUT_BYTES) return { buffer: original, ...type };

  try { fs.chmodSync(FFMPEG_PATH, 0o755); } catch { /* best effort */ }
  for (const quality of ['2', '4', '7']) {
    await runFfmpeg([
      '-y', '-i', sourcePath, '-frames:v', '1', '-map_metadata', '-1',
      '-vf', "scale='min(1600,iw)':-2", '-q:v', quality, outputPath,
    ]);
    if (fs.statSync(outputPath).size < MAX_OUTPUT_BYTES) {
      return { buffer: await fs.promises.readFile(outputPath), ext: '.jpg', contentType: 'image/jpeg' };
    }
  }
  throw new Error('Encoded image exceeds the 4.5 MB output limit.');
}

function tableMissingResponse(res) {
  return res.status(500).json({ error: 'The site_settings table is missing. Run db/06_site_settings.sql in Supabase.' });
}

// GET /api/poster (public) - { url, name } or null
router.get('/poster', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    res.json({ poster: await currentPoster() });
  } catch (error) {
    console.error('Could not read the menu poster:', error);
    res.status(502).json({ error: 'Could not load the menu poster.' });
  }
});

// POST /api/admin/poster (admin) - multipart field "image"; stores it as the new menu poster.
router.post('/admin/poster', requireAdmin, (req, res) => {
  if (busy) return res.status(409).json({ error: 'An image is already being processed. Please wait.' });
  busy = true;

  upload.single('image')(req, res, async (uploadError) => {
    if (uploadError) {
      busy = false;
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? 'Image must be smaller than 25 MB.' : uploadError.message });
    }
    if (!req.file) {
      busy = false;
      return res.status(400).json({ error: 'No image file received.' });
    }

    const sourcePath = req.file.path;
    const outputPath = path.join(TMP_DIR, `${Date.now()}-poster.jpg`);
    try {
      const image = await prepareImage(sourcePath, outputPath);

      // New object name each time so browsers and CDNs never show a stale image.
      const stamp = Date.now();
      const objectPath = `poster/menu-poster-${stamp}${image.ext}`;
      const { error: storageError } = await supabase.storage.from(BUCKET).upload(
        objectPath, image.buffer, { contentType: image.contentType, upsert: true, cacheControl: '31536000' }
      );
      if (storageError) throw storageError;

      const settings = await readSettings();
      const name = path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, MAX_NAME_LENGTH);
      await writeSettings({ path: objectPath, name, updated_at: new Date(stamp).toISOString() });

      // Remove the previous file (best effort).
      if (settings.path && settings.path !== objectPath) {
        await supabase.storage.from(BUCKET).remove([settings.path]).catch(() => {});
      }

      res.json({ success: true, poster: await currentPoster() });
    } catch (error) {
      console.error('Poster upload failed:', error);
      if (isMissingTable(error)) return tableMissingResponse(res);
      const message = error.message || '';
      const tooLarge = message.includes('4.5 MB');
      const unsupported = message.includes('Unsupported image type');
      const isStorageError = /bucket|storage|object/i.test(message);
      res.status(tooLarge || unsupported ? 400 : isStorageError ? 502 : 500).json({
        error: tooLarge || unsupported
          ? message
          : isStorageError
            ? 'Could not access the videos storage bucket.'
            : 'Could not process this image. Try a PNG or JPG.',
      });
    } finally {
      await Promise.all([sourcePath, outputPath].map((file) => fs.promises.unlink(file).catch(() => {})));
      busy = false;
    }
  });
});

// DELETE /api/admin/poster (admin) - removes the custom image; the page goes back to the default poster.
router.delete('/admin/poster', requireAdmin, async (req, res) => {
  try {
    const settings = await readSettings();
    if (settings.path) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([settings.path]);
      if (storageError) return res.status(502).json({ error: 'Could not access the videos storage bucket.' });
    }
    const { error } = await supabase.from('site_settings').delete().eq('key', SETTINGS_KEY);
    if (error) throw error;
    cache = { at: 0, url: null };
    res.json({ success: true, poster: null });
  } catch (error) {
    console.error('Poster removal failed:', error);
    if (isMissingTable(error)) return tableMissingResponse(res);
    res.status(500).json({ error: 'Could not remove the poster.' });
  }
});

module.exports = router;
module.exports.getPosterUrl = getPosterUrl;
