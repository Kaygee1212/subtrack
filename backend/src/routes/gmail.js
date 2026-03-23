// src/routes/gmail.js — Gmail OAuth Scanner (billing emails only)
const router = require('express').Router();
const { google } = require('googleapis');
const auth = require('../middleware/auth');
const db = require('../models/db');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.RAILWAY_URL + '/api/auth/gmail/callback'
);

// ── billing keywords filter ──
const BILLING_FILTER = '(receipt OR payment OR invoice OR billing OR renewed OR charged OR "ต่ออายุ" OR "ยืนยัน" OR "ชำระเงิน")';

const SUBSCRIPTION_KEYWORDS = [
  { keyword: 'netflix.com',           platform: 'netflix' },
  { keyword: 'spotify.com',           platform: 'spotify' },
  { keyword: 'youtube premium',       platform: 'youtube' },
  { keyword: 'youtubepremium',        platform: 'youtube' },
  { keyword: 'disneyplus.com',        platform: 'disney' },
  { keyword: 'disney+',               platform: 'disney' },
  { keyword: 'hbomax.com',            platform: 'hbo' },
  { keyword: 'max.com',               platform: 'hbo' },
  { keyword: 'apple.com/bill',        platform: 'appletv' },
  { keyword: 'apple tv+',             platform: 'appletv' },
  { keyword: 'applemusic',            platform: 'applemusic' },
  { keyword: 'apple music',           platform: 'applemusic' },
  { keyword: 'chat.openai.com',       platform: 'chatgpt' },
  { keyword: 'openai.com',            platform: 'chatgpt' },
  { keyword: 'chatgpt plus',          platform: 'chatgpt' },
  { keyword: 'canva.com',             platform: 'canva' },
  { keyword: 'canva pro',             platform: 'canva' },
  { keyword: 'notion.so',             platform: 'notion' },
  { keyword: 'notion plus',           platform: 'notion' },
  { keyword: 'xbox.com',              platform: 'xbox' },
  { keyword: 'xbox game pass',        platform: 'xbox' },
  { keyword: 'playstation.com',       platform: 'playstation' },
  { keyword: 'playstation plus',      platform: 'playstation' },
  { keyword: 'dropbox.com',           platform: 'dropbox' },
  { keyword: 'dropbox plus',          platform: 'dropbox' },
  { keyword: 'one.google.com',        platform: 'googledrive' },
  { keyword: 'google one',            platform: 'googledrive' },
  { keyword: 'amazon prime',          platform: 'amazonprime' },
  { keyword: 'primevideo.com',        platform: 'amazonprime' },
  { keyword: 'claude.ai',             platform: 'claude' },
  { keyword: 'anthropic.com',         platform: 'claude' },
];

// ── GET /api/auth/gmail ──
router.get('/gmail', auth, (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state: req.user.userId.toString(),
    prompt: 'consent'
  });
  res.json({ url });
});

// ── GET /api/auth/gmail/callback ──
router.get('/gmail/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.redirect(process.env.FRONTEND_URL + '?gmail=error');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    const encryptedToken = Buffer.from(JSON.stringify(tokens)).toString('base64');
    await db.query(`UPDATE users SET gmail_token=$1 WHERE id=$2`, [encryptedToken, state]);
    res.redirect(process.env.FRONTEND_URL + '?gmail=connected');
  } catch (err) {
    console.error('Gmail callback error:', err.message);
    res.redirect(process.env.FRONTEND_URL + '?gmail=error');
  }
});

// ── helper: หา info ของ billing emails (วันแรก, วันล่าสุด, จำนวนครั้ง) ──
async function getEmailInfo(gmail, keyword) {
  try {
    const q = `(from:${keyword} OR subject:"${keyword}") ${BILLING_FILTER}`;
    // ดึงสูงสุด 50 ฉบับ เพื่อนับจำนวนเดือนที่จ่าย
    const messages = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: 50
    });
    if (!messages.data.messages || messages.data.messages.length === 0) return null;

    const count = messages.data.messages.length;
    // Gmail คืนค่าใหม่ไปเก่า: [0] = ใหม่สุด, [count-1] = เก่าสุด
    const newestId = messages.data.messages[0].id;
    const oldestId = messages.data.messages[count - 1].id;

    const [newest, oldest] = await Promise.all([
      gmail.users.messages.get({ userId: 'me', id: newestId, format: 'metadata', metadataHeaders: ['Date'] }),
      gmail.users.messages.get({ userId: 'me', id: oldestId, format: 'metadata', metadataHeaders: ['Date'] }),
    ]);

    return {
      subscribed_at: new Date(parseInt(oldest.data.internalDate)).toISOString(),  // วันแรกที่พบ billing email
      latest_at:     new Date(parseInt(newest.data.internalDate)).toISOString(),  // วันล่าสุด
      months_count:  count  // จำนวน billing emails = ประมาณเดือนที่จ่าย
    };
  } catch {
    return null;
  }
}

// ── GET /api/auth/gmail/scan ──
router.get('/gmail/scan', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT gmail_token FROM users WHERE id=$1', [req.user.userId]);
    if (!result.rows[0]?.gmail_token) {
      return res.status(400).json({ error: 'ยังไม่ได้เชื่อม Gmail' });
    }

    const tokens = JSON.parse(Buffer.from(result.rows[0].gmail_token, 'base64').toString('utf8'));
    oauth2Client.setCredentials(tokens);

    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        const newEncrypted = Buffer.from(JSON.stringify(credentials)).toString('base64');
        await db.query('UPDATE users SET gmail_token=$1 WHERE id=$2', [newEncrypted, req.user.userId]);
        oauth2Client.setCredentials(credentials);
      } catch (refreshErr) {
        console.error('Token refresh failed:', refreshErr.message);
        return res.status(401).json({ error: 'Gmail token หมดอายุ กรุณาเชื่อมใหม่' });
      }
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const foundMap = {};

    for (const item of SUBSCRIPTION_KEYWORDS) {
      if (foundMap[item.platform]) continue;
      try {
        // ตรวจก่อนว่ามี billing email ไหม
        const check = await gmail.users.messages.list({
          userId: 'me',
          q: `(from:${item.keyword} OR subject:"${item.keyword}") ${BILLING_FILTER}`,
          maxResults: 1
        });
        if (check.data.messages && check.data.messages.length > 0) {
          // มี billing email — ดึง info เต็มๆ
          const info = await getEmailInfo(gmail, item.keyword);
          if (info) {
            foundMap[item.platform] = {
              platform_id:   item.platform,
              subscribed_at: info.subscribed_at,
              latest_at:     info.latest_at,
              months_count:  info.months_count
            };
          }
        }
      } catch {} // ข้าม keyword ที่ error
    }

    const found = Object.values(foundMap);
    res.json({ found, message: `พบ ${found.length} subscriptions จากอีเมล` });

  } catch (err) {
    console.error('Gmail scan error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสแกน' });
  }
});

// ── POST /api/auth/gmail/confirm ──
router.post('/gmail/confirm', auth, async (req, res) => {
  const { platform_ids } = req.body;
  if (!Array.isArray(platform_ids) || platform_ids.length === 0) {
    return res.status(400).json({ error: 'กรุณาระบุ platform_ids' });
  }
  try {
    let added = 0;
    for (const item of platform_ids) {
      const pid = typeof item === 'string' ? item : (item.platform_id || item.id || item);
      const subDate = (typeof item === 'object' && item.subscribed_at)
        ? new Date(item.subscribed_at)
        : new Date();
      const latestAt = (typeof item === 'object' && item.latest_at)
        ? new Date(item.latest_at)
        : null;
      const monthsCount = (typeof item === 'object' && item.months_count)
        ? item.months_count
        : null;

      await db.query(
        `INSERT INTO subscriptions (user_id, platform_id, subscribed_at, latest_billing_at, months_paid)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, platform_id)
         DO UPDATE SET
           subscribed_at = LEAST(EXCLUDED.subscribed_at, subscriptions.subscribed_at),
           latest_billing_at = EXCLUDED.latest_billing_at,
           months_paid = EXCLUDED.months_paid`,
        [req.user.userId, pid, subDate, latestAt, monthsCount]
      );
      added++;
    }
    res.json({ added, message: `เพิ่ม/อัปเดต ${added} subscriptions สำเร็จ` });
  } catch (err) {
    console.error('Confirm subscribe error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

module.exports = router;
