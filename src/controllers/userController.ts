import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { db } from '../config/db';
import { env } from '../config/env';
import { AuthRequest } from '../middleware/authMiddleware';

const s3 = new S3Client({ region: env.AWS_REGION });

const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  bio: z.string().max(300).optional(),
});

export async function searchUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = z.string().min(1).max(50).parse(req.query['q']);
    const result = await db.query(
      `SELECT id, username, display_name, avatar_url, bio, is_online, last_seen
       FROM users
       WHERE (username ILIKE $1 OR display_name ILIKE $1 OR phone ILIKE $1)
         AND id <> $2
       LIMIT 20`,
      [`%${q}%`, req.user!.userId],
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function getUserById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params['id']);
    const result = await db.query(
      'SELECT id, username, display_name, avatar_url, bio, is_online, last_seen FROM users WHERE id = $1',
      [id],
    );
    if (!result.rows.length) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await db.query(
      'SELECT id, phone, username, display_name, avatar_url, bio, is_online, last_seen, created_at FROM users WHERE id = $1',
      [req.user!.userId],
    );
    if (!result.rows.length) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updateProfileSchema.parse(req.body);
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.display_name !== undefined) {
      setClauses.push(`display_name = $${idx++}`);
      values.push(body.display_name);
    }
    if (body.bio !== undefined) {
      setClauses.push(`bio = $${idx++}`);
      values.push(body.bio);
    }

    if (!setClauses.length) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    values.push(req.user!.userId);
    const result = await db.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx}
       RETURNING id, phone, username, display_name, avatar_url, bio`,
      values,
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function getAvatarUploadUrl(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { contentType } = z
      .object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']) })
      .parse(req.body);

    const key = `avatars/${req.user!.userId}/${Date.now()}`;
    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;

    // Persist avatar_url immediately (client will upload then refresh profile)
    await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [publicUrl, req.user!.userId]);

    res.json({ success: true, data: { uploadUrl, publicUrl } });
  } catch (err) {
    next(err);
  }
}
