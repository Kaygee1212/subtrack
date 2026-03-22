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

// ── billing keywords filter — only match actual payment/subscription emails ──
const BILLING_FILTER = '(receipt OR payment OR invoice OR billing OR renewed OR charged OR "ต่ออายุ" OR "ยืนยัน" OR "ชำระเงิน")';

// ── keyword list: domain or subject term + platform ──
const SUBSCRIPTION_KEYWORDS = [
  { keyword: 'netflix.com',           platform: 'netflix' },
  { keyword: 'spotify.com',           platform: 'spotify' },
  { keyword: 'youtube premium',       platform: youtube' },
  { keyword: 'youtubepremium',        platform: youtube' },
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
  { keyword: 'xbox game pass',        platform: xbox' },
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

// ── GET /api/auth/gmail — ขอ URL สำหรับ login Google ──
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
  if (!code || !state) {
    return res.redirect(process.env.FRONTEND_URL + '?gmail=error');
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    const encryptedToken = Buffer.from(JSON.stringify(tokens)).toString('base64');
    await db.query(
      `UPDATE users SET gmail_token=$1 WHERE id=$2`,
      [encryptedToken, state]
    );
    res.redirect(process.env.FRONTEND_URL + '?gmail=connected');
  } catch (err) {
    console.error('Gmail callback error:', err.message);
    res.redirect(process.env.FRONTEND_URL + '?gmail=error');
  }
});

// ── helper: ดึงวันที่จริงจาก billing email ล่าสุด ──
async function getLatestEmailDate(gmail, keyword) {
  try {
    // ค้นหาเฉพาะ billing email จริงๆ ไม่ใช่ promotional
    const q = `(from:${keyword} OR subject:"${keyword}") ${BILLING_FILTER}`;
    const messages = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: 5
    });
    if (!messages.data.messages || messages.data.messages.length === 0) return null;

    const msgId = messages.data.messages[0].id;
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msgId,
      format: 'metadata',
      metadataHeaders: ['Date', 'Subject']
    });

    const internalDate = detail.data.internalDate
      ? parseInt(detail.data.internalDate)
      : Date.now();

    return new Date(internalDate).toISOString();
  } catch {
    return null;
  }
}

// ── GET /api/auth/gmail/scan — สแกนเฉพาะ billing email ──
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
        // ค้นหาเฉพาะ billing email จริงๆ เพื่อป้องกัน false positive
        const q = `(from:${item.keyword} OR subject:"${item.keyword}") ${BILLING_FILTER}`;
        const messages = await gmail.users.messages.list({
          userId: 'me',
          q,
          maxResults: 1
        });
        if (messages.data.messages && messages.data.messages.length > 0) {
          const emailDate = await getLatestEmailDate(gmail, item.keyword);
          foundMap[item.platform] = {
            platform_id: item.platform,
            subscribed_at: emailDate || new Date().toISOString()
          };
        }
      } catch {} // ข้ามถ้า error ทีละ keyword
    }

    const found = Object.values(foundMap);
    res.json({ found, message: `พบ ${found.length} subscriptions จากอีเมล` });

  } catch (err) {
    console.error('Gmail scan error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสแกน' });
  }
});

// ── POST /api/auth/gmail/confirm — ยืนยันและบันทึกพร้อมวันที่จริง ──
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

      await db.query(
        `INSERT INTO subscriptions (user_id, platform_id, subscribed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, platform_id)
         DO UPDATE SET subscribed_at = EXCLUDED.subscribed_at`,
        [req.user.userId, pid, subDate]
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
