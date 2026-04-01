import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  lazyConnect: true,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

// Presence helpers
const ONLINE_TTL = 300; // 5 minutes

export async function setUserOnline(userId: string, socketId: string): Promise<void> {
  await redis.setex(`presence:${userId}`, ONLINE_TTL, socketId);
}

export async function setUserOffline(userId: string): Promise<void> {
  await redis.del(`presence:${userId}`);
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const result = await redis.exists(`presence:${userId}`);
  return result === 1;
}

// Refresh token store
export async function saveRefreshToken(userId: string, token: string, ttlSeconds: number): Promise<void> {
  await redis.setex(`refresh:${userId}`, ttlSeconds, token);
}

export async function getRefreshToken(userId: string): Promise<string | null> {
  return redis.get(`refresh:${userId}`);
}

export async function deleteRefreshToken(userId: string): Promise<void> {
  await redis.del(`refresh:${userId}`);
}

// SNS endpoint token store (for push notifications)
export async function savePushToken(userId: string, token: string, platform: 'ios' | 'android'): Promise<void> {
  await redis.hset(`push:${userId}`, platform, token);
}

export async function getPushTokens(userId: string): Promise<Record<string, string>> {
  return redis.hgetall(`push:${userId}`);
}
