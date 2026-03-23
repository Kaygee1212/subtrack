// src/routes/statement.js — Bank statement PDF parser
const router  = require('express').Router();
const multer  = require('multer');
const pdf     = require('pdf-parse');
const auth    = require('../middleware/auth');
const db      = require('../models/db');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ PDF เท่านั้น'));
  }
});

// ── platform patterns to search for in statement text ──
const PLATFORM_PATTERNS = [
  { pattern: /netflix/i,                              platform: 'netflix' },
  { pattern: /spotify/i,                              platform: 'spotify' },
  { pattern: /youtube[\s_]?premium|google[\s*]+youtube/i, platform: 'youtube' },
  { pattern: /disney[\s+]*plus|disneyplus|disney\+/i,    platform: 'disney' },
  { pattern: /hbo[\s]?max|hbomax/i,                  platform: 'hbo' },
  { pattern: /apple\.com[\s/]?bill|apple\s+tv|apple\s+music|apple\s+one/i, platform: 'applemusic' },
  { pattern: /openai|chatgpt/i,                       platform: 'chatgpt' },
  { pattern: /canva/i,                                platform: 'canva' },
  { pattern: /notion/i,                               platform: 'notion' },
  { pattern: /xbox[\s]+game[\s]+pass|xbox\.com/i,     platform: 'xbox' },
  { pattern: /playstation[\s+]*plus|ps[\s]+plus|psn\b/i, platform: 'playstation' },
  { pattern: /dropbox/i,                              platform: 'dropbox' },
  { pattern: /google[\s]+one|one\.google/i,           platform: 'googledrive' },
  { pattern: /amazon[\s]+prime|primevideo/i,           platform: 'amazonprime' },
  { pattern: /anthropic|claude\.ai/i,                 platform: 'claude' },
  { pattern: /line[\s]+tv|line[\s]+music/i,           platform: 'youtube' }, // map to nearest
];

// ── Thai bank date patterns (DD/MM/YY, DD/MM/YYYY, DD-MM-YYYY, etc.) ──
const DATE_PATTERNS = [
  /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/,  // DD/MM/YYYY
  /(\d{2})[\/\-](\d{2})[\/\-](\d{2})/,  // DD/MM/YY
  /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i,
  /(\d{1,2})\s+(ม\.?ค|ก\.?พ|มี\.?ค|เม\.?ย|พ\.?ค|มิ\.?ย|ก\.?ค|ส\.?ค|ก\.?ย|ต\.?ค|พ\.?ย|ธ\.?ค)\.?\s+(\d{4})/,
];

const THAI_MONTHS = {
  'ม.ค': 1, 'ก.พ': 2, 'มี.ค': 3, 'เม.ย': 4, 'พ.ค': 5, 'มิ.ย': 6,
  'ก.ค': 7, 'ส.ค': 8, 'ก.ย': 9, 'ต.ค': 10, 'พ.ย': 11, 'ธ.ค': 12,
  'มค': 1, 'กพ': 2, 'มีค': 3, 'เมย': 4, 'พค': 5, 'มิย': 6,
  'กค': 7, 'สค': 8, 'กย': 9, 'ตค': 10, 'พย': 11, 'ธค': 12
};

function extractDate(line) {
  for (const pattern of DATE_PATTERNS) {
    const m = line.match(pattern);
    if (!m) continue;
    try {
      let year = parseInt(m[3]);
      // Buddhist year → Christian year
      if (year > 2400) year -= 543;
      // 2-digit year
      if (year < 100) year += year > 50 ? 1900 : 2000;
      let month, day;
      if (m[2] && isNaN(parseInt(m[2]))) {
        // Month name
        const mName = m[2].replace(/\./g,'');
        month = THAI_MONTHS[mName] || new Date(`${m[2]} 1, 2000`).getMonth() + 1;
        day = parseInt(m[1]);
      } else {
        day = parseInt(m[1]);
        month = parseInt(m[2]);
      }
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString();
    } catch {}
  }
  return null;
}

function extractAmount(line) {
  const m = line.match(/([\d,]+\.\d{2})/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

// ── POST /api/statement/parse ──
router.post('/parse', auth, upload.single('statement'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาอัปโหลดไฟล์ PDF' });

  try {
    const data = await pdf(req.file.buffer);
    const text = data.text;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const foundMap = {};   // platform → best match
    const allLines = {};   // platform → all matching lines

    for (const line of lines) {
      for (const { pattern, platform } of PLATFORM_PATTERNS) {
        if (!pattern.test(line)) continue;
        if (!allLines[platform]) allLines[platform] = [];
        allLines[platform].push(line);
        // First match = tentative entry
        if (!foundMap[platform]) {
          foundMap[platform] = {
            platform_id:   platform,
            subscribed_at: extractDate(line) || new Date().toISOString(),
            latest_at:     extractDate(line) || new Date().toISOString(),
            amount:        extractAmount(line),
            months_count:  1,
            source:        'statement'
          };
        }
      }
    }

    // Refine: find earliest date, count occurrences
    for (const platform of Object.keys(foundMap)) {
      const matchLines = allLines[platform];
      let earliest = null, latest = null;
      for (const l of matchLines) {
        const d = extractDate(l);
        if (!d) continue;
        if (!earliest || d < earliest) earliest = d;
        if (!latest   || d > latest)   latest   = d;
      }
      if (earliest) foundMap[platform].subscribed_at = earliest;
      if (latest)   foundMap[platform].latest_at     = latest;
      foundMap[platform].months_count = matchLines.length;
    }

    const found = Object.values(foundMap);
    res.json({
      found,
      pages: data.numpages,
      message: `พบ ${found.length} subscriptions ใน statement (${data.numpages} หน้า)`
    });

  } catch (err) {
    console.error('Statement parse error:', err.message);
    if (err.message.includes('PDF')) {
      return res.status(400).json({ error: 'ไม่สามารถอ่านไฟล์ PDF นี้ได้ กรุณาลองไฟล์อื่น' });
    }
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการประมวลผล' });
  }
});

module.exports = router;
