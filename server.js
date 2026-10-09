require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/cart');
const adminRoutes = require('./routes/admin');
const bannerRoutes = require('./routes/banner');
const contactRoutes = require('./routes/contact');
const musicRoutes = require('./routes/music');
const posterRoutes = require('./routes/poster');

const app = express();

// Render (like most hosts) runs the app behind one reverse proxy that sets
// X-Forwarded-For. Trusting exactly 1 hop lets express-rate-limit see each
// visitor's real IP instead of treating everyone as the proxy's IP.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL;
const PING_INTERVAL_MS = 10 * 60 * 1000;

// ---------- CORS ----------
// ALLOWED_ORIGINS: comma-separated list, e.g.
//   ALLOWED_ORIGINS=https://your-service.onrender.com,https://yourdomain.com
// Falls back to APP_URL alone if ALLOWED_ORIGINS isn't set. Requests with
// no Origin header (curl, server-to-server, same-origin page loads) are
// always allowed since the browser only sends Origin for cross-origin
// fetches — this only restricts *other websites'* JS from calling the API.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.APP_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);

app.use(helmet({
  // the app serves its own inline <script>/<style> tags in homepage.html,
  // so a default strict CSP would break it; leave CSP off here and add a
  // tuned policy later if you split JS/CSS into separate files.
  contentSecurityPolicy: false,
}));
app.use(express.json());
// Menu page: the poster image at the top is editable in Admin -> Poster. The custom image URL is put
// straight into the HTML so there is no flash of the default image. Must be registered before
// express.static so /menu-page.html (used by the landing page buttons) is served this way too.
const MENU_PAGE_FILE = path.join(__dirname, 'frontend', 'menu-page.html');
const DEFAULT_POSTER_TAG = 'src="images/page2img.jpeg"';
let menuPageHtml = null;

async function sendMenuPage(req, res) {
  try {
    if (menuPageHtml === null) menuPageHtml = await fs.promises.readFile(MENU_PAGE_FILE, 'utf8');
    const posterUrl = await posterRoutes.getPosterUrl();
    const html = posterUrl
      ? menuPageHtml.replace(DEFAULT_POSTER_TAG, `src="${posterUrl.replace(/"/g, '&quot;')}"`)
      : menuPageHtml;
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (error) {
    console.error('Could not serve the menu page:', error.message);
    res.sendFile(MENU_PAGE_FILE);
  }
}
app.get('/menu-page.html', sendMenuPage);

app.use('/demo', express.static(path.join(__dirname, 'demo')));
app.use(express.static(path.join(__dirname, 'frontend')));

// New flow: / = landing page (index.html) -> /menu = menu page (menu-page.html).
// The previous single-page app is kept at /homepage.html (static) for reference.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/menu', sendMenuPage);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Public, non-secret runtime config the frontend needs. Keeps
// WHATSAPP_NUMBER/BRANCH_NAME/DELIVERY_FEE defined once, server-side,
// instead of hardcoded in homepage.html.
app.get('/api/config', (req, res) => {
  res.json({
    whatsappNumber: process.env.WHATSAPP_NUMBER || '',
    branchName: process.env.BRANCH_NAME || 'Red House Trading',
    deliveryFee: Number(process.env.DELIVERY_FEE || 20),
  });
});

app.use('/api', menuRoutes);
app.use('/api', orderRoutes);
app.use('/api', cartRoutes);
app.use('/api', bannerRoutes);
app.use('/api', contactRoutes);
app.use('/api', musicRoutes);
app.use('/api', posterRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`Red House Catering server running on port ${PORT}`);

  if (!APP_URL) {
    console.log('APP_URL is not set; external keep-alive pinger is disabled.');
    return;
  }

  const pingUrl = new URL('/health', APP_URL);
  const client = pingUrl.protocol === 'https:' ? https : http;

  const ping = () => {
    const request = client.get(pingUrl, { timeout: 10_000 }, (response) => {
      response.resume();
      console.log(`Keep-alive ping: ${response.statusCode}`);
    });

    request.on('error', (error) => {
      console.error(`Keep-alive ping failed: ${error.message}`);
    });
  };

  setInterval(ping, PING_INTERVAL_MS);
  ping();
  console.log(`External keep-alive pinger enabled for ${pingUrl.origin}`);
});
