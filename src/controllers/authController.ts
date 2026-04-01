import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../config/db';
import { saveRefreshToken, getRefreshToken, deleteRefreshToken } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { JwtPayload, AuthRequest } from '../middleware/authMiddleware';

// Philippine mobile number: +639XXXXXXXXX or 09XXXXXXXXX
const phPhoneSchema = z
  .string()
  .regex(/^(\+63|0)\d{9,11}$/, 'Invalid mobile number format (e.g. +639171234567)');

const registerSchema = z.object({
  phone: phPhoneSchema,
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  display_name: z.string().min(1).max(100),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  phone: phPhoneSchema,
  password: z.string(),
});

function normalizePhone(phone: string): string {
  // Convert 09XXXXXXXXX -> +639XXXXXXXXX
  if (phone.startsWith('0')) return `+63${phone.slice(1)}`;
  return phone;
}

function generateTokens(payload: JwtPayload): { accessToken: string; refreshToken: string } {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = jwt.sign(payload, env.REFRESH_TOKEN_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
  return { accessToken, refreshToken };
}

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = registerSchema.parse(req.body);
    const phone = normalizePhone(body.phone);

    const exists = await db.query(
      'SELECT id FROM users WHERE phone = $1 OR username = $2',
      [phone, body.username],
    );
    if (exists.rowCount && exists.rowCount > 0) {
      res.status(409).json({ success: false, error: 'Phone number or username already taken' });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const result = await db.query(
      `INSERT INTO users (phone, username, display_name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, phone, username, display_name, avatar_url, bio, created_at`,
      [phone, body.username, body.display_name, passwordHash],
    );

    const user = result.rows[0];
    const tokens = generateTokens({ userId: user.id, username: user.username });
    await saveRefreshToken(user.id, tokens.refreshToken, REFRESH_TTL_SECONDS);

    logger.info('User registered', { userId: user.id, username: user.username });
    res.status(201).json({
      success: true,
      data: { user, ...tokens },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = loginSchema.parse(req.body);
    const phone = normalizePhone(body.phone);

    const result = await db.query(
      'SELECT id, username, display_name, avatar_url, bio, phone, password_hash FROM users WHERE phone = $1',
      [phone],
    );
    if (!result.rows.length) {
      res.status(401).json({ success: false, error: 'Invalid phone number or password' });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid phone number or password' });
      return;
    }

    const { password_hash: _, ...safeUser } = user;
    const tokens = generateTokens({ userId: user.id, username: user.username });
    await saveRefreshToken(user.id, tokens.refreshToken, REFRESH_TTL_SECONDS);

    logger.info('User logged in', { userId: user.id });
    res.json({ success: true, data: { user: safeUser, ...tokens } });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);

    let payload: JwtPayload;
    try {
      payload = jwt.verify(refreshToken, env.REFRESH_TOKEN_SECRET) as JwtPayload;
    } catch {
      res.status(401).json({ success: false, error: 'Invalid refresh token' });
      return;
    }

    const stored = await getRefreshToken(payload.userId);
    if (stored !== refreshToken) {
      res.status(401).json({ success: false, error: 'Refresh token revoked' });
      return;
    }

    const tokens = generateTokens({ userId: payload.userId, username: payload.username });
    await saveRefreshToken(payload.userId, tokens.refreshToken, REFRESH_TTL_SECONDS);

    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user) {
      await deleteRefreshToken(req.user.userId);
    }
    res.json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
}
