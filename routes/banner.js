const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const ROOT = path.join(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
// Default banner frames are committed in git (frontend/frames). Admin uploads
// go to frontend/banner instead, so "Reset" can simply delete that folder and
// the committed default comes back. Uploaded banners are temporary: like any
// runtime file on Render, they are wiped on the next deploy/restart.
const DEFAULT_DIR = path.join(FRONTEND_DIR, 'frames');
const CUSTOM_DIR = path.join(FRONTEND_DIR, 'banner');
const TMP_DIR = path.join(FRONTEND_DIR, 'banner_tmp');
const FFMPEG_PATH = path.join(ROOT, 'ffmpeg'); // binary lives in the repo root

const MAX_SECONDS = 10;
const DEFAULT_FPS = 24;
const DEFAULT_WIDTH = 1280;
const ALLOWED_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

const upload = multer({
  dest: path.join(os.tmpdir(), 'redhouse-banner-uploads'),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported video type "${ext}". Allowed: ${ALLOWED_EXT.join(', ')}`));
  },
});

let busy = false;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function currentBanner() {
  const custom = readJson(path.join(CUSTOM_DIR, 'manifest.json'));
  if (custom && custom.count > 0) {
    return { custom: true, base: 'banner', count: custom.count, fps: custom.fps, width: custom.width, version: custom.version };
  }
  const def = readJson(path.join(DEFAULT_DIR, 'manifest.json'));
  const count = def && def.count > 0
    ? def.count
    : fs.existsSync(DEFAULT_DIR) ? fs.readdirSync(DEFAULT_DIR).filter((f) => f.endsWith('.jpg')).length : 0;
  return { custom: false, base: 'frames', count, fps: DEFAULT_FPS, width: def ? def.width : null, version: 0 };
}

// GET /api/banner  (public) - tells the homepage which frames to play.
router.get('/banner', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(currentBanner());
});

// POST /api/admin/banner  (admin) - multipart: video, fps, width
router.post('/admin/banner', requireAdmin, (req, res) => {
  if (busy) return res.status(409).json({ error: 'A banner is already being processed. Please wait.' });
  busy = true;
  const finish = () => { busy = false; };

  upload.single('video')(req, res, (uploadError) => {
    if (uploadError) {
      finish();
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? 'Video must be smaller than 300 MB.' : uploadError.message });
    }
    if (!req.file) {
      finish();
      return res.status(400).json({ error: 'No video file received.' });
    }

    const fps = Math.max(1, Math.min(60, parseInt(req.body.fps, 10) || DEFAULT_FPS));
    const width = Math.max(320, Math.min(1920, parseInt(req.body.width, 10) || DEFAULT_WIDTH));
    const uploadedPath = req.file.path;

    try { fs.chmodSync(FFMPEG_PATH, 0o755); } catch { /* best effort */ }
    removeDir(TMP_DIR);
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // Extract into a temp folder first so a failed run never destroys the
    // banner that is currently live.
    const args = [
      '-y', '-i', uploadedPath,
      '-t', String(MAX_SECONDS),
      '-vf', `fps=${fps},scale=${width}:-2`,
      '-q:v', '4',
      path.join(TMP_DIR, 'frame_%04d.jpg'),
    ];

    execFile(FFMPEG_PATH, args, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      fs.unlink(uploadedPath, () => {});

      const fail = (status, message) => {
        removeDir(TMP_DIR);
        finish();
        res.status(status).json({ error: message });
      };

      if (error) {
        console.error('ffmpeg failed:', stderr || error);
        return fail(500, 'Could not process this video. Try a different file (MP4 works best).');
      }

      const count = fs.readdirSync(TMP_DIR).filter((f) => f.endsWith('.jpg')).length;
      if (!count) return fail(500, 'No frames could be extracted from this video.');

      try {
        const manifest = { count, fps, width, version: Date.now(), generatedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(TMP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
        removeDir(CUSTOM_DIR);
        fs.renameSync(TMP_DIR, CUSTOM_DIR);
      } catch (swapError) {
        console.error('Banner swap failed:', swapError);
        return fail(500, 'Frames were created but could not be saved.');
      }

      finish();
      res.json({ success: true, banner: currentBanner() });
    });
  });
});

// POST /api/admin/banner/reset  (admin) - go back to the default banner.
router.post('/admin/banner/reset', requireAdmin, (req, res) => {
  if (busy) return res.status(409).json({ error: 'A banner is being processed. Please wait.' });
  removeDir(CUSTOM_DIR);
  res.json({ success: true, banner: currentBanner() });
});

module.exports = router;
