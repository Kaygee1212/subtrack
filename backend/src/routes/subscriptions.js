// src/routes/subscriptions.js
const express = require('express');
const router  = express.Router();
const db      = require('../models/db');
const auth    = require('../middleware/auth');

// ── GET /api/subscriptions — ดึงรายการ sub ทั้งหมดของ user ──────────────
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(`
  SECTCT }s.id, s.subscribed_at, s.reminder_days, s.latest_billing_at, s.months_paid,
             s.custom_price, s.notes,
             p.id as platform_id, p.name, p.icon, p.category, p.price_thb, p.color, p.unsubscribe_url
      FROM subscriptions s
      JOIN platforms p ON s.platform_id = p.id
      WHERE s.user_id = $1
      ORDER BY s.subscribed_at DESC
    `, [req.user.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/subscriptions/stats — สรุปค่าใช้จ่ายรายเดือน ────────────────
router.get('/stats', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*)::int AS total_subscriptions,
        COALESCE(SUM(COALESCE(s.custom_price, p.price_thb)), 0)::numeric AS total_monthly_thb
      FROM subscriptions s
      JOIN platforms p ON s.platform_id = p.id
      WHERE s.user_id = $1
    `, [req.user.userId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/subscriptions/platforms/all — รายการ platform ทั้งหมด ────────
router.get('/platforms/all', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM platforms ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/subscriptions/:platformId — subscribe ───────────────────────
router.post('/:platformId', auth, async (req, res) => {
  const { platformId } = req.params;
  const { reminder_days, subscribed_at, latest_billing_at, months_paid, custom_price, notes } = req.body;
  const subDate = subscribed_at || new Date().toISOString();

  if (custom_price !== undefined && custom_price !== null) {
    const price = parseFloat(custom_price);
    if (isNaN(price) || price < 0 || price > 100000) {
      return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO subscriptions (user_id, platform_id, reminder_days, subscribed_at, latest_billing_at, months_paid, custom_price, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, platform_id) DO UPDATE SET
         reminder_days     = EXCLUDED.reminder_days,
         latest_billing_at = COALESCE(EXCLUDED.latest_billing_at, subscriptions.latest_billing_at),
         months_paid       = COALESCE(EXCLUDED.months_paid, subscriptions.months_paid),
         custom_price      = COALESCE(EXCLUDED.custom_price, subscriptions.custom_price),
         notes             = COALESCE(EXCLUDED.notes, subscriptions.notes)
       RETURNING *`,
      [req.user.userId, platformId, reminder_days ?? 3, subDate, latest_billing_at ?? null, months_paid ?? 1, custom_price ?? null, notes ?? null]
    );
    res.status(201).json({ message: 'Subscribe สำเร็จ', subscription: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/subscriptions/:platformId — unsubscribe ──────────────────
router.delete('/:platformId', auth, async (req, res) => {
  const { platformId } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM subscriptions WHERE user_id = $1 AND platform_id = $2 RETURNING id',
      [req.user.userId, platformId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบ subscription นี้' });
    }
    res.json({ message: 'ยกเลิก subscription สำเร็จ' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/subscriptions/:platformId/reminder — อัปเดต reminder ──────
router.patch('/:platformId/reminder', auth, async (req, res) => {
  const { platformId } = req.params;
  const { reminder_days } = req.body;
  try {
    await db.query(
      'UPDATE subscriptions SET reminder_days = $1 WHERE user_id = $2 AND platform_id = $3',
      [reminder_days, req.user.userId, platformId]
    );
    res.json({ message: 'อัปเดต reminder แล้ว' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/subscriptions/:platformId/details — อัปเดตราคา/notes ──────
router.patch('/:platformId/details', auth, async (req, res) => {
  const { platformId } = req.params;
  const { custom_price, notes } = req.body;

  if (custom_price !== undefined && custom_price !== null) {
    const price = parseFloat(custom_price);
    if (isNaN(price) || price < 0 || price > 100000) {
      return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
    }
  }
  if (notes !== undefined && notes !== null && notes.length > 500) {
    return res.status(400).json({ error: 'Notes ต้องไม่เกิน 500 ตัวอักษร' });
  }

  try {
    const result = await db.query(
      `UPDATE subscriptions
       SET custom_price = COALESCE($1, custom_price),
           notes        = COALESCE($2, notes)
       WHERE user_id = $3 AND platform_id = $4
       RETURNING *`,
      [custom_price ?? null, notes ?? null, req.user.userId, platformId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบ subscription นี้' });
    }
    res.json({ message: 'อัปเดตสำเร็จ', subscription: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
