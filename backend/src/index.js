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
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, trustProxy: true });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, trustProxy: true });
app.use('/api', limiter);
app.use('/api/auth', authLimiter);

// ── Routes ──
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/auth',          require('./routes/gmail'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/payment',       require('./routes/payment'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── Start ──
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 SubTrack API running on port ${PORT}`);
  startReminderCron();
});
