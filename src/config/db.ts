import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

export const db = new Pool({
  host: env.DB_HOST,
  port: parseInt(env.DB_PORT, 10),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

db.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

export async function connectDB(): Promise<void> {
  const client = await db.connect();
  try {
    // Keep runtime resilient when docker volume was created before newer migrations.
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id)
      );
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocked_users(blocker_id);',
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocked_users(blocked_id);',
    );

    // Backfill schema drifts from older local volumes.
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_wallpapers (
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        conversation_id UUID,
        conversation_type VARCHAR(20) CHECK (conversation_type IN ('dm', 'group', 'community_topic', 'global')),
        wallpaper_type VARCHAR(20) NOT NULL CHECK (wallpaper_type IN ('color', 'gradient', 'pattern', 'photo', 'preset')),
        wallpaper_value TEXT NOT NULL,
        brightness INTEGER DEFAULT 100 CHECK (brightness BETWEEN 0 AND 100),
        blur_amount INTEGER DEFAULT 0 CHECK (blur_amount BETWEEN 0 AND 10),
        extra_config JSONB,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_user_wallpapers_scope
      ON user_wallpapers (user_id, COALESCE(conversation_id, '00000000-0000-0000-0000-000000000000'::UUID));
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallpaper_presets (
        id VARCHAR(50) PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        label VARCHAR(100) NOT NULL,
        label_ph VARCHAR(100),
        thumbnail_url TEXT NOT NULL,
        full_url TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_user_wallpapers_user ON user_wallpapers(user_id);',
    );

    // Some older schemas used banned_at instead of is_banned.
    await client.query(`
      ALTER TABLE community_members
      ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    await client.query(`
      ALTER TABLE community_members
      ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP NULL;
    `);

    // Old local schemas may miss channel subscriber metadata columns.
    await client.query(`
      ALTER TABLE channel_subscribers
      ADD COLUMN IF NOT EXISTS notifications BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    await client.query(`
      ALTER TABLE channel_subscribers
      ADD COLUMN IF NOT EXISTS subscribed_at TIMESTAMP NOT NULL DEFAULT NOW();
    `);
  } finally {
    client.release();
  }
  logger.info('PostgreSQL connected');
}
