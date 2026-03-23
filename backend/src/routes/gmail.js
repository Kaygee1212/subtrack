// src/routes/gmail.js — Gmail OAuth Scanner (improved)
const router = require('express').Router();
const { google } = require('googleapis');
const auth = require('../middleware/auth');
const db = require('../models/db');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.RAILWAY_URL + '/api/auth/gmail/callback'
);

// ── Billing-only filter — ลดอีเมลการตลาดที่ไม่ใช่ใบเสร็จ ──
const BILLING_FILTER = [
  'receipt', 'invoice', '"payment confirmation"', '"payment receipt"',
  '"order confirmation"', '"subscription confirmed"', '"subscription receipt"',
  '"thank you for subscribing"', '"thanks for subscribing"',
  '"thank you for your payment"', '"thanks for your payment"',
  '"thank you for your order"', '"payment successful"',
  '"successfully charged"', '"charge successful"',
  '"successfully renewed"', '"renewal confirmation"',
  '"auto-renewal"', '"your subscription"', '"your plan"',
  'ใบเสร็จ', 'ชำระเงิน', 'ต่ออายุ'
].join(' OR ');

// ── Keyword list — ใช้ `query` สำหรับ platform ที่ billing ผ่าน Stripe/Google Play ──
const SUBSCRIPTION_KEYWORDS = [
  { keyword: 'netflix.com',                                    platform: 'netflix'      },
  { keyword: 'spotify.com',                                    platform: 'spotify'      },
  // YouTube Premium — billed via Google Play (monthly), NOT from youtube.com
  { query: 'from:googleplay-noreply@google.com "YouTube Premium"', platform: 'youtube' },
  { keyword: 'youtube premium',                                platform: 'youtube'      },
  { keyword: 'disneyplus.com',                                 platform: 'disney'       },
  { keyword: 'disney+',                                        platform: 'disney'       },
  { keyword: 'hbomax.com',                                     platform: 'hbo'          },
  { keyword: 'max.com',                                        platform: 'hbo'          },
  { keyword: 'apple.com/bill',                                 platform: 'appletv'      },
  { keyword: 'apple tv+',                                      platform: 'appletv'      },
  { keyword: 'applemusic',                                     platform: 'applemusic'   },
  { keyword: 'apple music',                                    platform: 'applemusic'   },
  { keyword: 'chat.openai.com',                                platform: 'chatgpt'      },
  // ChatGPT Plus billed via Stripe — receipt from stripe.com with "OpenAI" in subject
  { query: 'from:stripe.com "OpenAI"',                         platform: 'chatgpt'      },
  { keyword: 'chatgpt plus',                                   platform: 'chatgpt'      },
  { keyword: 'canva.com',                                      platform: 'canva'        },
  { query: 'from:stripe.com "Canva"',                          platform: 'canva'        },
  { keyword: 'notion.so',                                      platform: 'notion'       },
  { query: 'from:stripe.com "Notion"',                         platform: 'notion'       },
  { keyword: 'xbox.com',                                       platform: 'xbox'         },
  { keyword: 'xbox game pass',                                 platform: 'xbox'         },
  { keyword: 'playstation.com',                                platform: 'playstation'  },
  { keyword: 'playstation plus',                               platform: 'playstation'  },
  { keyword: 'dropbox.com',                                    platform: 'dropbox'      },
  // Google One — billed via Google Play
  { query: 'from:googleplay-noreply@google.com "Google One"',  platform: 'googledrive' },
  { keyword: 'one.google.com',                                 platform: 'googledrive'  },
  { keyword: 'amazon prime',                                   platform: 'amazonprime'  },
  { keyword: 'primevideo.com',                                 platform: 'amazonprime'  },
  { keyword: 'claude.ai',                                      platform: 'claude'       },
  // Claude Pro billed via Stripe — receipt from stripe.com with "Anthropic" in subject
  { query: 'from:stripe.com "Anthropic"',                      platform: 'claude'       },
];

// ── Helper: build Gmail query for an item ──
function buildQuery(item) {
  if (item.query) {
    return `(${item.query}) (${BILLING_FILTER})`;
  }
  return `(from:${item.keyword} OR subject:"${item.keyword}") (${BILLING_FILTER})`;
}

// ── Helper: get billing email dates for a platform keyword ──
async function getEmailInfo(gmail, item) {
  try {
    const q = buildQuery(item);
    // Fetch up to 500 messages (newest first) — sufficient for any realistic subscription history
    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 500 });
    const msgs = listRes.data.messages;
    if (!msgs?.length) return null;

    // Fetch newest and oldest message dates in parallel
    const newestId = msgs[0].id;
    const oldestId = msgs[msgs.length - 1].id;
    const [newestMsg, oldestMsg] = await Promise.all([
      gmail.users.messages.get({ userId: 'me', id: newestId, format: 'metadata', metadataHeaders: ['Date'] }),
      newestId !== oldestId
        ? gmail.users.messages.get({ userId: 'me', id: oldestId, format: 'metadata', metadataHeaders: ['Date'] })
        : null
    ]);

    const newestTs = parseInt(newestMsg.data.internalDate);
    const oldestTs = oldestMsg ? parseInt(oldestMsg.data.internalDate) : newestTs;

    const MS_PER_MONTH = 30.44 * 24 * 60 * 60 * 1000;
    const months_paid = Math.max(1, Math.round((newestTs - oldestTs) / MS_PER_MONTH) + 1);

    return {
      latest_billing_at: new Date(newestTs).toISOString(),
      subscribed_at:     new Date(oldestTs).toISOString(),
      months_paid
    };
  } catch {
    return null;
  }
}

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
    return res.redirect(process.env.FRONTEND_URL + '?gmail=error&reason=missing_params');
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    const encryptedToken = Buffer.from(JSON.stringify(tokens)).toString('base64');
    const updateRes = await db.query(
      `UPDATE users SET gmail_token=$1 WHERE id=$2 RETURNING id`,
      [encryptedToken, state]
    );
    if (updateRes.rowCount === 0) {
      console.error('Gmail callback: no user found for state=', state);
      return res.redirect(process.env.FRONTEND_URL + '?gmail=error&reason=user_not_found');
    }
    res.redirect(process.env.FRONTEND_URL + '?gmail=connected');
  } catch (err) {
    console.error('Gmail callback error:', err.message);
    res.redirect(process.env.FRONTEND_URL + '?gmail=error&reason=token_exchange');
  }
});

// ── GET /api/auth/gmail/status — เช็คว่าผู้ใช้เชื่อม Gmail แล้วหรือยัง ──
router.get('/gmail/status', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT gmail_token IS NOT NULL as connected FROM users WHERE id=$1', [req.user.userId]);
    res.json({ connected: result.rows[0]?.connected || false });
  } catch (err) {
    console.error('Gmail status error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// ── GET /api/auth/gmail/scan — สแกนอีเมล (ไม่ auto-subscribe) ──
router.get('/gmail/scan', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT gmail_token FROM users WHERE id=$1', [req.user.userId]);
    if (!result.rows[0]?.gmail_token) {
      return res.status(400).json({ error: 'ยังไม่ได้เชื่อม Gmail' });
    }

    // decode token
    const tokens = JSON.parse(Buffer.from(result.rows[0].gmail_token, 'base64').toString('utf8'));
    oauth2Client.setCredentials(tokens);

    // Refresh token ถ้าหมดอายุ
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
    const foundMap = {}; // platform_id → true (dedup)

    for (const item of SUBSCRIPTION_KEYWORDS) {
      try {
        const q = buildQuery(item);
        const messages = await gmail.users.messages.list({ userId: 'me', q, maxResults: 1 });
        if (messages.data.messages?.length > 0) {
          foundMap[item.platform] = true;
        }
      } catch {} // ข้ามถ้า error ทีละ keyword
    }

    const found = Object.keys(foundMap);
    // *** ไม่ auto-subscribe — ส่งรายการกลับให้ user ตัดสินใจ ***
    res.json({ found, message: `พบ ${found.length} subscriptions จากอีเมล` });

  } catch (err) {
    console.error('Gmail scan error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสแกน' });
  }
});

// ── POST /api/auth/gmail/confirm — user ยืนยันแล้ว ค่อย subscribe พร้อม billing info ──
router.post('/gmail/confirm', auth, async (req, res) => {
  const { platform_ids } = req.body;
  if (!Array.isArray(platform_ids) || platform_ids.length === 0) {
    return res.status(400).json({ error: 'กรุณาระบุ platform_ids' });
  }
  try {
    // Setup Gmail client for fetching billing info
    const userResult = await db.query('SELECT gmail_token FROM users WHERE id=$1', [req.user.userId]);
    let gmail = null;
    if (userResult.rows[0]?.gmail_token) {
      const tokens = JSON.parse(Buffer.from(userResult.rows[0].gmail_token, 'base64').toString('utf8'));
      oauth2Client.setCredentials(tokens);
      gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    }

    let added = 0;
    for (const pid of platform_ids) {
      // Find best billing info for this platform (try all matching keywords)
      let info = null;
      if (gmail) {
        const items = SUBSCRIPTION_KEYWORDS.filter(k => k.platform === pid);
        for (const item of items) {
          info = await getEmailInfo(gmail, item);
          if (info) break; // Use first keyword that has billing emails
        }
      }

      await db.query(
        `INSERT INTO subscriptions (user_id, platform_id, subscribed_at, latest_billing_at, months_paid)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, platform_id) DO UPDATE SET
           latest_billing_at = EXCLUDED.latest_billing_at,
           months_paid       = EXCLUDED.months_paid,
           subscribed_at     = LEAST(subscriptions.subscribed_at, EXCLUDED.subscribed_at)`,
        [
          req.user.userId,
          pid,
          info?.subscribed_at     || new Date().toISOString(),
          info?.latest_billing_at || null,
          info?.months_paid       || 1
        ]
      );
      added++;
    }
    res.json({ added, message: `เพิ่ม ${added} subscriptions สำเร็จ` });
  } catch (err) {
    console.error('Confirm subscribe error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

module.exports = router;
