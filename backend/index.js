// VideoGrab - index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { initDb } = require('./services/db');
const { startQueueWorker } = require('./services/jobQueue');

const downloadRouter = require('./routes/download');
const telegramRouter = require('./routes/telegram');
const statusRouter = require('./routes/status');

const app = express();
const PORT = process.env.PORT || 3000;
const startTime = Date.now();

// 1. Initialize folders
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const downloadsDir = path.join(DATA_DIR, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// 2. Setup CORS to support Chrome Extensions dynamically
const corsOptions = {
  origin: (origin, callback) => {
    const allowed = process.env.ALLOWED_ORIGIN || '*';
    // Allow if no origin (e.g. server-to-server), if wildcard, if matches extension scheme, or if exact matches env
    if (
      allowed === '*' ||
      !origin ||
      origin.startsWith('chrome-extension://') ||
      origin === allowed
    ) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS'));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. /ping route - No API key verification required to allow easy HF Space wakeup calls
app.get('/ping', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round((Date.now() - startTime) / 1000)
  });
});

// 4. API Key verification middleware for all subsequent routes
app.use((req, res, next) => {
  // Allow browser CORS preflight check requests
  if (req.method === 'OPTIONS') {
    return next();
  }

  const systemApiKey = process.env.API_KEY || 'omnitrix2.0';
  const requestApiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (requestApiKey !== systemApiKey) {
    console.warn(`[Security] Unauthorized access attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing X-API-Key header.' });
  }

  next();
});

// 5. Mount API routes
app.use('/download', downloadRouter);
app.use('/telegram', telegramRouter);
app.use('/', statusRouter); // Mount status and history query on root

// 6. Global error handler
app.use((err, req, res, next) => {
  console.error('[Express Error]', err);
  res.status(500).json({ error: 'Internal Server Error.' });
});

// 7. Initialize Database and Queue Worker
initDb();
startQueueWorker();

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`VideoGrab Backend listening on port ${PORT}`);
  console.log(`Server environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`===============================================`);
});
