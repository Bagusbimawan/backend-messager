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
  client.release();
  logger.info('PostgreSQL connected');
}
