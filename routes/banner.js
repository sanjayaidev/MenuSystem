const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { requireAdmin } = require('../middleware/auth');
const supabase = require('../db/supabase');

const router = express.Router();

const ROOT = path.join(__dirname, '..');
const TMP_DIR = path.join(os.tmpdir(), 'redhouse-video-uploads');
const FFMPEG_PATH = path.join(ROOT, 'ffmpeg');
const VIDEO_BUCKET = 'videos';
const HERO_PATH = 'homepage/hero.mp4';
const HERO_POSTER_PATH = 'homepage/hero.jpg';
const MAX_SECONDS = 10;      // category (special) clips
const HERO_MAX_SECONDS = 4;  // homepage hero: autoplay loop, trimmed to 4 s
const MAX_OUTPUT_BYTES = 4_500_000;
const ALLOWED_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported video type "${ext}". Allowed: ${ALLOWED_EXT.join(', ')}`));
  },
});

let busy = false;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_PATH, args, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).split('\n').slice(-4).join('\n')));
      resolve();
    });
  });
}

function publicUrl(objectPath, version) {
  const url = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

async function currentBanner() {
  const { data: objects, error } = await supabase.storage.from(VIDEO_BUCKET).list('homepage', { limit: 100 });
  if (error) throw error;
  const objectByName = new Map((objects || []).map((object) => [object.name, object]));
  const hero = objectByName.get('hero.mp4');
  const poster = objectByName.get('hero.jpg');
  return {
    heroUrl: hero ? publicUrl(HERO_PATH, hero.updated_at || hero.created_at) : null,
    heroPosterUrl: poster ? publicUrl(HERO_POSTER_PATH, poster.updated_at || poster.created_at) : null,
  };
}

async function specialSections() {
  const [{ data: categories, error: categoriesError }, { data: settings, error: settingsError }, { data: selectedItems, error: itemsError }] = await Promise.all([
    supabase.from('categories').select('id, key, label_en, label_ar, label_ur, label_zh, sort_order').order('sort_order', { ascending: true }),
    supabase.from('special_sections').select('category_id, video_path'),
    supabase.from('special_section_items').select('category_id, slot, menu_items(id, name_en, name_ar, name_ur, name_zh, price, image_path)'),
  ]);
  if (categoriesError) throw categoriesError;
  if (settingsError) throw settingsError;
  if (itemsError) throw itemsError;

  const settingByCategory = new Map((settings || []).map((setting) => [setting.category_id, setting]));
  const itemsByCategory = new Map();
  (selectedItems || []).forEach((row) => {
    if (!row.menu_items) return;
    if (!itemsByCategory.has(row.category_id)) itemsByCategory.set(row.category_id, []);
    itemsByCategory.get(row.category_id).push({ slot: row.slot, ...row.menu_items });
  });

  return (categories || []).map((category) => {
    const settingsForCategory = settingByCategory.get(category.id);
    return {
      ...category,
      videoUrl: settingsForCategory?.video_path ? publicUrl(settingsForCategory.video_path, settingsForCategory.updated_at) : null,
      items: (itemsByCategory.get(category.id) || []).sort((a, b) => a.slot - b.slot),
    };
  });
}

async function encodeVideo(sourcePath, outputPath) {
  try { fs.chmodSync(FFMPEG_PATH, 0o755); } catch { /* best effort */ }
  await runFfmpeg([
    '-y', '-i', sourcePath, '-t', String(MAX_SECONDS), '-an',
    '-vf', 'fps=30,scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
    '-b:v', '1200k', '-maxrate', '2500k', '-bufsize', '2500k',
    '-g', '1', '-keyint_min', '1', '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
  ]);
  if (fs.statSync(outputPath).size >= MAX_OUTPUT_BYTES) {
    throw new Error('Encoded video exceeds the 4.5 MB output limit.');
  }
}

// Hero: re-encode only (no 360p/all-keyframe compression, no scrub). Keeps the
// source resolution up to 720 px wide, trims to 4 s, drops audio, and puts the
// moov atom first so playback starts before the download finishes.
async function encodeHero(sourcePath, outputPath) {
  try { fs.chmodSync(FFMPEG_PATH, 0o755); } catch { /* best effort */ }
  await runFfmpeg([
    '-y', '-i', sourcePath, '-t', String(HERO_MAX_SECONDS), '-an',
    '-vf', "scale='min(720,iw)':-2",
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
    '-maxrate', '6000k', '-bufsize', '12000k',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
  ]);
  if (fs.statSync(outputPath).size >= MAX_OUTPUT_BYTES) {
    throw new Error('Encoded video exceeds the 4.5 MB output limit.');
  }
}

// Poster = the first frame of the hero, same size as the video (shown until it loads).
async function encodePoster(videoPath, posterPath) {
  await runFfmpeg([
    '-y', '-i', videoPath, '-frames:v', '1', '-q:v', '3', posterPath,
  ]);
}

// GET /api/banner (public) - signed URLs for the hero and category videos.
router.get('/banner', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    res.json(await currentBanner());
  } catch (error) {
    console.error('Could not read videos bucket:', error);
    res.status(502).json({ error: 'Could not access the videos storage bucket.' });
  }
});

router.get('/special', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  try {
    res.json({ categories: await specialSections() });
  } catch (error) {
    console.error('Could not load special sections:', error);
    res.status(502).json({ error: 'Could not load the special sections.' });
  }
});

router.get('/admin/special', requireAdmin, async (req, res) => {
  try {
    const [{ data: categories, error: categoriesError }, { data: items, error: itemsError }, configured] = await Promise.all([
      supabase.from('categories').select('id, key, label_en, label_ar, label_ur, label_zh, sort_order').order('sort_order', { ascending: true }),
      supabase.from('menu_items').select('id, category_id, name_en, name_ar, name_ur, name_zh, is_available').order('name_en', { ascending: true }),
      specialSections(),
    ]);
    if (categoriesError) throw categoriesError;
    if (itemsError) throw itemsError;
    res.json({ categories: configured, menuItems: items || [] });
  } catch (error) {
    console.error('Could not load admin special sections:', error);
    res.status(502).json({ error: 'Could not load the special sections.' });
  }
});

// POST /api/admin/banner (admin) - encode a hero clip and upload it to Storage.
router.post('/admin/banner', requireAdmin, (req, res) => {
  if (busy) return res.status(409).json({ error: 'A banner is already being processed. Please wait.' });
  busy = true;

  upload.single('video')(req, res, async (uploadError) => {
    if (uploadError) {
      busy = false;
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? 'Source video must be smaller than 300 MB.' : uploadError.message });
    }
    if (!req.file) {
      busy = false;
      return res.status(400).json({ error: 'No video file received.' });
    }

    const sourcePath = req.file.path;
    const outputPath = path.join(TMP_DIR, `${Date.now()}-hero.mp4`);
    const posterPath = path.join(TMP_DIR, `${Date.now()}-hero.jpg`);
    try {
      await encodeHero(sourcePath, outputPath);
      await encodePoster(outputPath, posterPath);

      const storage = supabase.storage.from(VIDEO_BUCKET);
      const poster = await storage.upload(HERO_POSTER_PATH, await fs.promises.readFile(posterPath), {
        contentType: 'image/jpeg', upsert: true, cacheControl: '3600',
      });
      if (poster.error) throw poster.error;
      const video = await storage.upload(HERO_PATH, await fs.promises.readFile(outputPath), {
        contentType: 'video/mp4', upsert: true, cacheControl: '3600',
      });
      if (video.error) throw video.error;

      res.json({ success: true, banner: await currentBanner() });
    } catch (error) {
      console.error('Banner upload failed:', error);
      const tooLarge = error.message?.includes('4.5 MB');
      const isStorageError = error.message && /bucket|storage|object/i.test(error.message);
      res.status(tooLarge ? 400 : isStorageError ? 502 : 500).json({
        error: tooLarge
          ? error.message
          : isStorageError
            ? 'Could not access the videos storage bucket.'
            : 'Could not process this video. Try another MP4.',
      });
    } finally {
      await Promise.all([sourcePath, outputPath, posterPath].map((file) => fs.promises.unlink(file).catch(() => {})));
      busy = false;
    }
  });
});

// POST /api/admin/banner/reset (admin) - remove the uploaded hero video.
router.post('/admin/banner/reset', requireAdmin, (req, res) => {
  if (busy) return res.status(409).json({ error: 'A banner is being processed. Please wait.' });
  supabase.storage.from(VIDEO_BUCKET).remove([HERO_PATH, HERO_POSTER_PATH]).then(async ({ error }) => {
    if (error) return res.status(502).json({ error: 'Could not access the videos storage bucket.' });
    res.json({ success: true, banner: await currentBanner() });
  }).catch((error) => {
    console.error('Could not reset banner:', error);
    res.status(502).json({ error: 'Could not access the videos storage bucket.' });
  });
});

router.post('/admin/special/:key', requireAdmin, (req, res) => {
  if (busy) return res.status(409).json({ error: 'A video is already being processed. Please wait.' });
  busy = true;
  upload.single('video')(req, res, async (uploadError) => {
    if (uploadError) {
      busy = false;
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? 'Source video must be smaller than 300 MB.' : uploadError.message });
    }

    const sourcePath = req.file?.path;
    const outputPath = path.join(TMP_DIR, `${Date.now()}-special.mp4`);
    let busyRelease = () => { busy = false; };
    try {
      const { data: category, error: categoryError } = await supabase.from('categories')
        .select('id, key').eq('key', req.params.key).maybeSingle();
      if (categoryError) throw categoryError;
      if (!category) return res.status(404).json({ error: 'Category not found.' });

      let itemIds;
      try { itemIds = JSON.parse(req.body.item_ids || '[]').map(Number); }
      catch { return res.status(400).json({ error: 'Choose five menu items.' }); }
      if (itemIds.length !== 5 || itemIds.some((id) => !Number.isInteger(id) || id < 1) || new Set(itemIds).size !== 5) {
        return res.status(400).json({ error: 'Choose five different menu items.' });
      }
      const { data: foundItems, error: foundItemsError } = await supabase.from('menu_items')
        .select('id').in('id', itemIds);
      if (foundItemsError) throw foundItemsError;
      if ((foundItems || []).length !== 5) return res.status(400).json({ error: 'Choose five existing menu items.' });

      const sectionPath = `special/${category.key}.mp4`;
      const { data: oldSection, error: oldSectionError } = await supabase.from('special_sections')
        .select('video_path').eq('category_id', category.id).maybeSingle();
      if (oldSectionError) throw oldSectionError;

      let videoPath = oldSection?.video_path || null;
      if (req.file) {
        await encodeVideo(sourcePath, outputPath);
        const { error: videoError } = await supabase.storage.from(VIDEO_BUCKET).upload(sectionPath, await fs.promises.readFile(outputPath), {
          contentType: 'video/mp4', upsert: true, cacheControl: '3600',
        });
        if (videoError) throw videoError;
        videoPath = sectionPath;
      }

      const { error: sectionError } = await supabase.from('special_sections').upsert({
        category_id: category.id, video_path: videoPath, updated_at: new Date().toISOString(),
      }, { onConflict: 'category_id' });
      if (sectionError) throw sectionError;

      const { error: deleteError } = await supabase.from('special_section_items').delete().eq('category_id', category.id);
      if (deleteError) throw deleteError;
      const { error: insertError } = await supabase.from('special_section_items').insert(itemIds.map((menuItemId, index) => ({
        category_id: category.id, slot: index + 1, menu_item_id: menuItemId,
      })));
      if (insertError) throw insertError;

      res.json({ success: true, categories: await specialSections() });
    } catch (error) {
      console.error('Special section save failed:', error);
      const tooLarge = error.message?.includes('4.5 MB');
      res.status(tooLarge ? 400 : 500).json({ error: tooLarge ? error.message : 'Could not save this special section.' });
    } finally {
      if (sourcePath) await fs.promises.unlink(sourcePath).catch(() => {});
      await fs.promises.unlink(outputPath).catch(() => {});
      busyRelease();
    }
  });
});

module.exports = router;
