require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const path = require('path');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL;
const PING_INTERVAL_MS = 10 * 60 * 1000;

app.use(cors());       // tighten this to your frontend's origin before going live
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'homepage.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', menuRoutes);
app.use('/api', orderRoutes);
app.use('/api/auth', authRoutes);

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
