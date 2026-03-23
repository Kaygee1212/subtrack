// routes/auth.js — Authentication + reCAPTCHA + Forgot/Reset Password
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const https   = require('https');
const nodemailer = require('nodemailer');
const pool    = require('../models/db');
const authenticateToken = require('../middleware/auth');

// ── Email normalizer — Gmail treats dots as identical ──────────────────────
// kennk.knnek2@gmail.com  ===  kennkknnek2@gmail.com  (same inbox)
// Normalize to dot-free form so duplicates are blocked at registration
function normalizeEmail(raw) {
  const lower = raw.toLowerCase().trim();
  const [local, domain] = lower.split('@');
  if (!domain) return lower;
  const gmailDomains = ['gmail.com', 'googlemail.com'];
  if (gmailDomains.includes(domain)) {
    // Remove dots, strip anything after + (alias)
    const clean = local.replace(/\./g, '').split('+')[0];
    return `${clean}@${domain}`;
  }
  return lower;
}

// ── Nodemailer transporter ─────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendResetEmail(toEmail, resetUrl) {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"SubTrack" <${process.env.SMTP_USER}>`,
    to:   toEmail,
    subject: 'SubTrack — รีเซ็ตรหัสผ่านของคุณ',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0f0f1a; color: #e0e0ff; border-radius: 12px;">
        <h2 style="color: #7c6fff; margin-bottom: 8px;">🔐 รีเซ็ตรหัสผ่าน SubTrack</h2>
        <p style="color: #aaa;">เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้</p>
        <p>คลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p>
        <a href="${resetUrl}" style="display:inline-block; margin: 16px 0; padding: 12px 28px; background: linear-gradient(135deg, #7c6fff, #00d4aa); color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 15px;">
          ตั้งรหัสผ่านใหม่
        </a>
        <p style="color: #888; font-size: 13px;">ลิงก์นี้จะหมดอายุใน <strong style="color:#e0e0ff">1 ชั่วโมง</strong></p>
        <p style="color: #888; font-size: 13px;">หากคุณไม่ได้ขอรีเซ็ตรหัสผ่าน สามารถเพิกเฉยอีเมลนี้ได้เลย</p>
        <hr style="border-color: #333; margin: 20px 0;">
        <p style="color: #555; font-size: 12px;">SubTrack — จัดการ Subscription ของคุณ</p>
      </div>
    `
  });
}

// ── reCAPTCHA v2 verification ──────────────────────────────────────────────
function verifyCaptcha(token) {
  return new Promise((resolve, reject) => {
    const secret = process.env.RECAPTCHA_SECRET_KEY || '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
    const postData = `secret=${secret}&response=${token}`;
    const options = {
      hostname: 'www.google.com',
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid reCAPTCHA response')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function checkCaptcha(req, res, next) {
  const token = req.body.captchaToken;
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) return next();
  if (!token) return res.status(400).json({ error: 'กรุณายืนยัน CAPTCHA ก่อน' });
  try {
    const result = await verifyCaptcha(token);
    if (!result.success) {
      return res.status(400).json({ error: 'CAPTCHA ไม่ถูกต้อง กรุณาลองใหม่' });
    }
    next();
  } catch (e) {
    console.error('reCAPTCHA error:', e.message);
    next(); // fail open
  }
}

// ── Register ───────────────────────────────────────────────────────────────
router.post('/register', checkCaptcha, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  try {
    // Normalize email to catch Gmail dot-variants (a.b@gmail.com == ab@gmail.com)
    const normalized = normalizeEmail(email);
    const existing = await pool.query(
      'SELECT id FROM users WHERE normalized_email = $1',
      [normalized]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว (หรือเป็น Gmail ที่มีจุดต่างกัน)' });
    }
    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, normalized_email, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, created_at`,
      [name.trim(), email.toLowerCase().trim(), normalized, hashed]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// ── Login ──────────────────────────────────────────────────────────────────
router.post('/login', checkCaptcha, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'กรุณากรอก Email และรหัสผ่าน' });
  }
  try {
    // Try exact match first, then normalized match (for Gmail dot variants)
    const normalized = normalizeEmail(email);
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR normalized_email = $2 LIMIT 1',
      [email.toLowerCase().trim(), normalized]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email หรือรหัสผ่านไม่ถูกต้อง' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Email หรือรหัสผ่านไม่ถูกต้อง' });
    }
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// ── Get current user ───────────────────────────────────────────────────────
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// ── POST /forgot-password — ส่งลิงก์รีเซ็ตไปยัง email ────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'กรุณาระบุ Email' });

  try {
    const normalized = normalizeEmail(email);
    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1 OR normalized_email = $2 LIMIT 1',
      [email.toLowerCase().trim(), normalized]
    );

    // Always respond success to prevent email enumeration attacks
    if (result.rows.length === 0) {
      return res.json({ message: 'หากมีบัญชีนี้ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปแล้ว' });
    }

    const user = result.rows[0];

    // Invalidate old tokens for this user
    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE',
      [user.id]
    );

    // Generate secure token (64-char hex = 256 bits)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    const resetUrl = `${process.env.FRONTEND_URL}?reset_token=${token}`;

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      // SMTP not configured — log token for debugging
      console.log(`[DEV] Reset URL for ${user.email}: ${resetUrl}`);
      return res.json({ message: 'หากมีบัญชีนี้ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปแล้ว' });
    }

    await sendResetEmail(user.email, resetUrl);
    res.json({ message: 'หากมีบัญชีนี้ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปแล้ว' });

  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// ── POST /reset-password — ตั้งรหัสผ่านใหม่ด้วย token ───────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  try {
    const result = await pool.query(
      `SELECT prt.id, prt.user_id, prt.expires_at
       FROM password_reset_tokens prt
       WHERE prt.token = $1 AND prt.used = FALSE`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'ลิงก์รีเซ็ตไม่ถูกต้องหรือใช้งานไปแล้ว' });
    }
    const row = result.rows[0];
    if (new Date() > new Date(row.expires_at)) {
      return res.status(400).json({ error: 'ลิงก์รีเซ็ตหมดอายุแล้ว กรุณาขอใหม่อีกครั้ง' });
    }

    const hashed = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, row.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [row.id]);

    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// ── GET /verify-reset-token — เช็คว่า token ยังใช้ได้อยู่ ────────────────
router.get('/verify-reset-token', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false });
  try {
    const result = await pool.query(
      `SELECT expires_at FROM password_reset_tokens
       WHERE token = $1 AND used = FALSE`,
      [token]
    );
    if (result.rows.length === 0) return res.json({ valid: false, reason: 'not_found' });
    if (new Date() > new Date(result.rows[0].expires_at)) {
      return res.json({ valid: false, reason: 'expired' });
    }
    res.json({ valid: true });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
});

module.exports = router;
