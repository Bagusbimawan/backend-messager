import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateUploadUrl, detectMediaType } from '../services/mediaService';
import { db } from '../config/db';

const uploadUrlSchema = z.object({
  contentType: z.string(),
  filename: z.string().max(255).optional(),
  folder: z.enum(['messages', 'stories', 'voices']).default('messages'),
});

export async function getMediaUploadUrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = uploadUrlSchema.parse(req.body);
    const mediaType = detectMediaType(body.contentType);

    if (!mediaType) {
      res.status(400).json({ success: false, error: 'Unsupported file type' });
      return;
    }

    // Max 100MB check happens client-side; presigned URL TTL is 10 min
    const result = await generateUploadUrl(body.folder, req.user!.userId, body.contentType, body.filename);

    res.json({
      success: true,
      data: { ...result, mediaType },
    });
  } catch (err) {
    next(err);
  }
}

// Fetch media gallery for a conversation (photos, videos, files, voice)
export async function getConversationMedia(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const conversationId = z.string().uuid().parse(req.params['conversationId']);
    const { type, cursor, limit = '30' } = req.query as Record<string, string>;
    const limitNum = Math.min(100, parseInt(limit, 10));

    // Verify participation
    const access = await db.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.user!.userId],
    );
    if (!access.rows.length) {
      res.status(403).json({ success: false, error: 'Not a participant' });
      return;
    }

    const conditions = [`m.conversation_id = $1`, `m.media_url IS NOT NULL`, `m.deleted_for_all = FALSE`];
    const values: unknown[] = [conversationId];
    let idx = 2;

    if (type) {
      conditions.push(`m.media_type = $${idx++}`);
      values.push(type);
    }
    if (cursor) {
      conditions.push(`m.created_at < $${idx++}`);
      values.push(cursor);
    }

    values.push(limitNum + 1);
    const result = await db.query(
      `SELECT m.id, m.media_url, m.media_type, m.media_size, m.media_duration,
              m.thumbnail_url, m.media_filename, m.created_at,
              u.display_name AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at DESC
       LIMIT $${idx}`,
      values,
    );

    const items = result.rows.slice(0, limitNum);
    res.json({
      success: true,
      data: {
        items,
        hasMore: result.rows.length > limitNum,
        cursor: items.length > 0 ? items[items.length - 1].created_at : null,
      },
    });
  } catch (err) {
    next(err);
  }
}
