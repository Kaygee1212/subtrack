// src/models/migrate.js
// รัน: node src/models/migrate.js เพื่อสร้าง tables

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const schema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  name        VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Platforms master data
CREATE TABLE IF NOT EXISTS platforms (
  id          VARCHAR(50) PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  icon        VARCHAR(10),
  category    VARCHAR(100),
  price_thb   INTEGER NOT NULL,
  color       VARCHAR(20),
  unsubscribe_url TEXT
);

-- User subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  platform_id VARCHAR(50) REFERENCES platforms(id),
  subscribed_at TIMESTAMP DEFAULT NOW(),
  reminder_days INTEGER DEFAULT 3,
  UNIQUE(user_id, platform_id)
);

-- Payment transactions
CREATE TABLE IF NOT EXISTS transactions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  amount      INTEGER NOT NULL,
  currency    VARCHAR(10) DEFAULT 'THB',
  status      VARCHAR(50) DEFAULT 'pending',
  payment_method VARCHAR(50),
  omise_charge_id VARCHAR(255),
  platforms_paid JSONB,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Seed platforms
INSERT INTO platforms (id, name, icon, category, price_thb, color, unsubscribe_url) VALUES
  ('youtube',      'YouTube Premium', '▶️', 'วิดีโอ & สตรีมมิ่ง', 179,  '#ff4444', 'https://www.youtube.com/paid_memberships'),
  ('netflix',      'Netflix',         '🎬', 'วิดีโอ & สตรีมมิ่ง', 279,  '#e50914', 'https://www.netflix.com/CancelPlan'),
  ('spotify',      'Spotify',         '🎵', 'เพลง & พอดแคสต์',   69,   '#1db954', 'https://www.spotify.com/account/subscription/cancel/'),
  ('disney',       'Disney+',         '🏰', 'วิดีโอ & สตรีมมิ่ง', 149,  '#113ccf', 'https://www.disneyplus.com/account/subscription'),
  ('appletv',      'Apple TV+',       '🍎', 'วิดีโอ & สตรีมมิ่ง', 129,  '#888888', 'https://support.apple.com/en-us/HT202039'),
  ('hbo',          'HBO Max',         '🎭', 'วิดีโอ & สตรีมมิ่ง', 209,  '#5c16c5', 'https://www.max.com/account/manage-subscription'),
  ('applemusic',   'Apple Music',     '🎸', 'เพลง & พอดแคสต์',   79,   '#fc3c44', 'https://support.apple.com/en-us/HT202039'),
  ('chatgpt',      'ChatGPT Plus',    '🤖', 'AI & เครื่องมือ',    599,  '#10a37f', 'https://chat.openai.com/account/subscription'),
  ('canva',        'Canva Pro',       '🎨', 'ความคิดสร้างสรรค์',  219,  '#7d2ae8', 'https://www.canva.com/settings/purchase-history'),
  ('notion',       'Notion Pro',      '📝', 'AI & เครื่องมือ',    320,  '#ffffff', 'https://www.notion.so/profile/plans'),
  ('xbox',         'Xbox Game Pass',  '🎮', 'เกม',               349,  '#107c10', 'https://account.microsoft.com/services'),
  ('playstation',  'PlayStation Plus','🕹️', 'เกม',               259,  '#003791', 'https://www.playstation.com/en-th/playstation-plus/cancel/'),
  ('dropbox',      'Dropbox Plus',    '📦', 'Storage & Cloud',   299,  '#0061ff', 'https://www.dropbox.com/account/plan'),
  ('googledrive',  'Google One',      '☁️', 'Storage & Cloud',   99,   '#34a853', 'https://one.google.com/storage'),
  ('amazonprime',  'Amazon Prime',    '📦', 'วิดีโอ & สตรีมมิ่ง', 169,  '#00a8e1', 'https://www.amazon.com/mc/cancel'),
  ('claude',       'Claude Pro',      '✨', 'AI & เครื่องมือ',    599,  '#cc9b7a', 'https://claude.ai/settings')
ON CONFLICT (id) DO NOTHING;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');
    await client.query(schema);
    console.log('✅ Database ready!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
