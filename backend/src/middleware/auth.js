// src/middleware/auth.js — JWT authentication + token-version invalidation
const jwt  = require('jsonwebtoken');
const pool = require('../models/db');

module.exports = async function authenticateToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'ไม่ได้รับอนุญาต' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;

    // ── Token-version check ──────────────────────────────────────────────────
    // If token carries a tokenVersion, verify it matches DB.
    // Incremented on password change/reset — invalidates all old sessions.
    if (payload.tokenVersion !== undefined) {
      const result = await pool.query(
        'SELECT token_version FROM users WHERE id = $1',
        [payload.userId]
      );
      if (!result.rows[0] || result.rows[0].token_version !== payload.tokenVersion) {
        return res.status(401).json({ error: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      }
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' });
  }
};
