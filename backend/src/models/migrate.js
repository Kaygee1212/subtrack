// src/models/migrate.js — รัน: node src/models/migrate.js
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const schema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(255),
  gmail_token TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Platforms master data
CREATE TABLE IF NOT EXISTS platforms (
  id              VARCHAR(50) PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  icon            VARCHAR(10),
  logo_url        TEXT,
  category        VARCHAR(100),
  price_thb       INTEGER NOT NULL,
  color           VARCHAR(20),
  unsubscribe_url TEXT
);

-- User subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  platform_id   VARCHAR(50) REFERENCES platforms(id),
  subscribed_at TIMESTAMP DERAUST NOW(),
  reminder_days INTEGER DEFAULT 3,
  UNIQUE(user_id, platform_id)
);

-- Payment transactions
CREATE TABLE IF NOT EXISTS transactions (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER REFERENCES users(id),
  amount           INTEGER NOT NULL,
  currency         VARCHAR(10) DEFAULT 'THB',
  status           VARCHAR(50) DEFAULT 'pending',
  payment_method   VARCHAR(50),
  omise_charge_id  VARCHAR(255),
  platforms_paid   JSONB,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- Add gmail_token column if not exists (safe migration)
ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_token TEXT;

-- Add logo_url column to platforms if not exists
ALTER TABLE platforms ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Seed platforms (with logo_url added)
INSERT INTO platforms (id, name, icon, logo_url, category, price_thb, color, unsubscribe_url) VALUES
  ('youtube',     'YouTube Premium', '▶️', 'https://logo.clearbit.com/youtube.com',     'วิดีโอ & สตรีมมิ่ง', 179, '#ff0000', 'https://www.youtube.com/paid_memberships'),
  ('netflix',     'Netflix',         '🎬', 'https://logo.clearbit.com/netflix.com',     'วิดีโอ & สตรีมมิ่ง', 279, '#e50914', 'https://www.netflix.com/CancelPlan'),
  ('spotify',     'Spotify',         '🎵', 'https://logo.clearbit.com/spotify.com',     'เพลง & พอดแคสต์',   69,  '#1db954', 'https://www.spotify.com/account/subscription/cancel/'),
  ('disney',      'Disney+',         '🏰', 'https://logo.clearbit.com/disneyplus.com',  'วิดีโอ & สตรีมมิ่ง', 149, '#113ccf', 'https://www.disneyplus.com/account/subscription'),
  ('appletv',     'Apple TV+',       '🍎', 'https://logo.clearbit.com/apple.com',       'วิดีโอ & สตรีมมิ่ง', 129, '#555555', 'https://support.apple.com/en-us/HT202039'),
  ('hbo',         'HBO Max',         '🎭', 'https://logo.clearbit.com/max.com',         'วิดีโอ & สตรีมมิ่ง', 209, '#5c16c5', 'https://www.max.com/account/manage-subscription'),
  ('applemusic',  'Apple Music',     '🎸', 'https://logo.clearbit.com/apple.com',       'เพลง & พอดแคสต์',   79,  '#fc3c44', 'https://support.apple.com/en-us/HT202039'),
  ('chatgpt',     'ChatGPT Plus',    '🤖', 'https://logo.clearbit.com/openai.com',      'AI & เครื่องมือ',    599, '#10a37f', 'https://chat.openai.com/account/subscription'),
  ('canva',       'Canva Pro',       '🎨', 'https://logo.clearbit.com/canva.com',       'ความคิดสร้างสรรค์',  219, '#7d2ae8', 'https://www.canva.com/settings/purchase-history'),
  ('notion',      'Notion Pro',      '📝', 'https://logo.clearbit.com/notion.so',       'AI & เครื่องมือ',    320, '#ffffff', 'https://www.notion.so/profile/plans'),
  ('xbox',        'Xbox Game Pass',  '🎮', 'https://logo.clearbit.com/xbox.com',        'เกม',                349, '#107c10', 'https://account.microsoft.com/services'),
  ('playstation', 'PlayStation Plus','🕹️', 'https://logo.clearbit.com/playstation.com', 'เกม',               259, '#003791', 'https://www.playstation.com/en-th/playstation-plus/cancel/'),
  ('dropbox',     'Dropbox Plus',    '📦', 'https://logo.clearbit.com/dropbox.com',     'Storage & Cloud',   299, '#0061ff', 'https://www.dropbox.com/account/plan'),
  ('googledrive', 'Google One',      '☁️', 'https://logo.clearbit.com/google.com',      'Storage & Cloud',   99,  '#34a853', 'https://one.google.com/storage'),
  ('amazonprime', 'Amazon Prime',    '📦', 'https://logo.clearbit.com/amazon.com',      'วิดีโอ & สตรีมมิ่ง', 169, '#00a8e1', 'https://www.amazon.com/mc/cancel'),
  ('claude',      'Claude Pro',      '✨', 'https://logo.clearbit.com/anthropic.com',   'AI & เครื่องมือ',    599, '#cc9b7a', 'https://claude.ai/settings')
ON CONFLICT (id) DO UPDATE SET logo_url = EXCLUDED.logo_url;
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
