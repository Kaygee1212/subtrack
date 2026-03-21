// src/routes/payment.js
const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../models/db');

// หมายเหตุ: ติดตั้ง omise ด้วย: npm install omise
// const omise = require('omise')({ secretKey: process.env.OMISE_SECRET_KEY });

// POST /api/payment/charge — ชำระเงินด้วยบัตรเครดิต
router.post('/charge', auth, async (req, res) => {
  const { token, amount, platform_ids, payment_method = 'card' } = req.body;
  // amount ต้องเป็นหน่วย satang (บาท × 100)

  try {
    // ── ตรวจสอบ platforms ที่จะจ่าย ──
    const platforms = await db.query(
      `SELECT id, name, price_thb FROM platforms WHERE id = ANY($1)`,
      [platform_ids]
    );
    const totalCalc = platforms.rows.reduce((s, p) => s + p.price_thb, 0);
    if (totalCalc * 100 !== amount) {
      return res.status(400).json({ error: 'ยอดเงินไม่ตรงกัน' });
    }

    // ── เรียก Omise API (ปลด comment เมื่อมี API key จริง) ──
    /*
    const charge = await omise.charges.create({
      amount: amount,           // satang
      currency: 'thb',
      card: token,              // token จาก Omise.js ฝั่ง frontend
      description: `SubTrack - ${platforms.rows.map(p=>p.name).join(', ')}`,
      metadata: {
        user_id: req.user.id,
        platforms: platform_ids
      }
    });

    if (charge.status !== 'successful') {
      return res.status(402).json({ error: 'การชำระเงินไม่สำเร็จ: ' + charge.failure_message });
    }
    */

    // ── Mock สำหรับ development ──
    const mockChargeId = 'chrg_test_' + Math.random().toString(36).slice(2, 12);

    // บันทึก transaction
    const txn = await db.query(
      `INSERT INTO transactions (user_id, amount, payment_method, omise_charge_id, platforms_paid, status)
       VALUES ($1, $2, $3, $4, $5, 'successful') RETURNING *`,
      [req.user.id, amount / 100, payment_method, mockChargeId, JSON.stringify(platform_ids)]
    );

    // อัปเดต subscriptions
    for (const pid of platform_ids) {
      await db.query(
        `INSERT INTO subscriptions (user_id, platform_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, platform_id) DO NOTHING`,
        [req.user.id, pid]
      );
    }

    res.json({
      success: true,
      transaction_id: txn.rows[0].id,
      charge_id: mockChargeId,
      amount: amount / 100,
      platforms: platforms.rows.map(p => p.name)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/payment/promptpay — สร้าง QR PromptPay
router.post('/promptpay', auth, async (req, res) => {
  const { amount, platform_ids } = req.body;

  try {
    // ── เรียก Omise PromptPay (ปลด comment เมื่อมี API key จริง) ──
    /*
    const source = await omise.sources.create({
      type: 'promptpay',
      amount: amount,
      currency: 'thb'
    });

    const charge = await omise.charges.create({
      amount: amount,
      currency: 'thb',
      source: source.id,
      description: 'SubTrack PromptPay',
    });

    return res.json({
      charge_id: charge.id,
      qr_image: charge.source.scannable_code.image.download_uri,
      expires_at: charge.expires_at
    });
    */

    // Mock QR สำหรับ development
    res.json({
      charge_id: 'chrg_test_promptpay_' + Math.random().toString(36).slice(2),
      qr_payload: `00020101021230490016A000000677010111011300669999999990215SUBTRACK${amount}5802TH5910SubTrack6304`,
      amount: amount / 100,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/payment/history — ประวัติการชำระ
router.get('/history', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
