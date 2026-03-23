// src/index.js — Main server entry point
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { startReminderCron } = require('./services/reminder');

const app = express();

// ── Security middleware ──
app.use(helmet());

// Multi-origin CORS (supports Vercel, custom domain, localhost)
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://subtrack-tau.vercel.app',
  'https://www.subtrack.com',
  'https://subtrack.com',
  'http://localhost:3000',
  'http://localhost:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Limit request body to 10kb to prevent abuse
app.use(express.json({ limit: '10kb' }));
app.set('trust proxy', 1);

// ── Rate limiters ──
// General API: 100 requests / 15 min
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
// Auth (login/register): 20 requests / 15 min
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
// Password reset: 5 requests / hour — prevents email spam & token brute-force
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'คำขอมากเกินไป กรุณาลองใหม่ใน 1 ชั่วโมง' }
});

app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', resetLimiter);
app.use('/api/auth/reset-password', resetLimiter);
app.use('/api/auth/verify-reset-token', resetLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/gmail'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/payment', require('./routes/payment'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Start cron jobs
startReminderCron();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Subtrack API running on port ${PORT}`));
