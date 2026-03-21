const router = require('express').Router();
const { google } = require('googleapis');
const auth = require('../middleware/auth');
const db = require('../models/db');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.RAILWAY_URL + '/api/auth/gmail/callback'
);

const SUBSCRIPTION_KEYWORDS = [
  { keyword: 'netflix.com', platform: 'netflix' },
  { keyword: 'spotify.com', platform: 'spotify' },
  { keyword: 'youtube premium', platform: 'youtube' },
  { keyword: 'disneyplus.com', platform: 'disney' },
  { keyword: 'hbo max', platform: 'hbo' },
  { keyword: 'apple.com/bill', platform: 'appletv' },
  { keyword: 'chatgpt', platform: 'chatgpt' },
  { keyword: 'canva.com', platform: 'canva' },
  { keyword: 'notion.so', platform: 'notion' },
  { keyword: 'xbox', platform: 'xbox' },
  { keyword: 'playstation', platform: 'playstation' },
  { keyword: 'dropbox.com', platform: 'dropbox' },
  { keyword: 'google one', platform: 'googledrive' },
  { keyword: 'amazon prime', platform: 'amazonprime' },
  { keyword: 'claude.ai', platform: 'claude' },
];

// GET /api/auth/gmail — ขอ URL สำหรับ login Google
router.get('/gmail', auth, (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state: req.user.id.toString()
  });
  res.json({ url });
});

// GET /api/auth/gmail/callback — รับ token จาก Google
router.get('/gmail/callback', async (req, res) => {
  const { code, state } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    await db.query(
      `UPDATE users SET gmail_token=$1 WHERE id=$2`,
      [JSON.stringify(tokens), state]
    );
    res.redirect(process.env.FRONTEND_URL + '?gmail=connected');
  } catch (err) {
    console.error(err);
    res.redirect(process.env.FRONTEND_URL + '?gmail=error');
  }
});

// GET /api/auth/gmail/scan — สแกนอีเมลหา subscriptions
router.get('/gmail/scan', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT gmail_token FROM users WHERE id=$1', [req.user.id]
    );
    if (!result.rows[0]?.gmail_token) {
      return res.status(400).json({ error: 'ยังไม่ได้เชื่อม Gmail' });
    }

    oauth2Client.setCredentials(JSON.parse(result.rows[0].gmail_token));
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const found = [];

    for (const item of SUBSCRIPTION_KEYWORDS) {
      try {
        const messages = await gmail.users.messages.list({
          userId: 'me',
          q: `from:${item.keyword} OR subject:${item.keyword}`,
          maxResults: 1
        });
        if (messages.data.messages?.length > 0) {
          found.push(item.platform);
          // Auto subscribe
          await db.query(
            `INSERT INTO subscriptions (user_id, platform_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [req.user.id, item.platform]
          );
        }
      } catch {}
    }

    res.json({ found, message: `พบ ${found.length} subscriptions จากอีเมล` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

module.exports = router;