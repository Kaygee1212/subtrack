// src/routes/subscriptions.js
const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../models/db');

// GET /api/subscriptions — ดึงรายการ sub ทั้งหมดของ user
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.id, s.subscribed_at, s.reminder_days,
             p.id as platform_id, p.name, p.icon, p.category,
             p.price_thb, p.color, p.unsubscribe_url
      FROM subscriptions s
      JOIN platforms p ON s.platform_id = p.id
      WHERE s.user_id = $1
      ORDER BY s.subscribed_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/subscriptions/:platformId — subscribe
router.post('/:platformId', auth, async (req, res) => {
  const { platformId } = req.params;
  const { reminder_days = 3 } = req.body;
  try {
    const platform = await db.query('SELECT * FROM platforms WHERE id=$1', [platformId]);
    if (platform.rows.length === 0) return res.status(404).json({ error: 'ไม่พบแพลตฟอร์มนี้' });

    const result = await db.query(
      `INSERT INTO subscriptions (user_id, platform_id, reminder_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, platform_id) DO UPDATE SET reminder_days=$3
       RETURNING *`,
      [req.user.id, platformId, reminder_days]
    );
    res.status(201).json({ message: 'Subscribe สำเร็จ', subscription: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/subscriptions/:platformId — unsubscribe
router.delete('/:platformId', auth, async (req, res) => {
  const { platformId } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM subscriptions WHERE user_id=$1 AND platform_id=$2 RETURNING *',
      [req.user.id, platformId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบ subscription นี้' });

    // ดึง unsubscribe_url เพื่อส่งกลับ
    const platform = await db.query('SELECT unsubscribe_url FROM platforms WHERE id=$1', [platformId]);
    res.json({
      message: 'Unsubscribe สำเร็จ',
      unsubscribe_url: platform.rows[0]?.unsubscribe_url
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/subscriptions/:platformId/reminder — ตั้งวันแจ้งเตือน
router.patch('/:platformId/reminder', auth, async (req, res) => {
  const { platformId } = req.params;
  const { reminder_days } = req.body;
  try {
    await db.query(
      'UPDATE subscriptions SET reminder_days=$1 WHERE user_id=$2 AND platform_id=$3',
      [reminder_days, req.user.id, platformId]
    );
    res.json({ message: 'อัปเดต reminder แล้ว' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/subscriptions/platforms — รายการแพลตฟอร์มทั้งหมด
router.get('/platforms/all', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM platforms ORDER BY category, name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
