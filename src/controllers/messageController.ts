import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

export async function getConversations(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;

    // Fetch conversations with last message + partner info + unread count
    const result = await db.query(
      `SELECT
         c.id                    AS conversation_id,
         c.created_at,
         -- Partner user (the other participant)
         u.id                    AS partner_id,
         u.username              AS partner_username,
         u.display_name          AS partner_display_name,
         u.avatar_url            AS partner_avatar_url,
         u.is_online             AS partner_is_online,
         u.last_seen             AS partner_last_seen,
         -- Last message
         lm.content              AS last_message,
         lm.sender_id            AS last_sender_id,
         lm.created_at           AS last_message_at,
         lm.status               AS last_message_status,
         -- Unread
         COALESCE((
           SELECT COUNT(*)::INT
           FROM messages m2
           WHERE m2.conversation_id = c.id
             AND m2.created_at > cp_me.last_read_at
             AND m2.sender_id <> $1
         ), 0)                   AS unread_count
       FROM conversation_participants cp_me
       JOIN conversations c ON c.id = cp_me.conversation_id
       JOIN conversation_participants cp_other
         ON cp_other.conversation_id = c.id AND cp_other.user_id <> $1
       JOIN users u ON u.id = cp_other.user_id
       LEFT JOIN LATERAL (
         SELECT content, sender_id, created_at, status
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON TRUE
       WHERE cp_me.user_id = $1
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [userId],
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function createOrGetConversation(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId: partnerId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    const myId = req.user!.userId;

    if (myId === partnerId) {
      res.status(400).json({ success: false, error: 'Cannot start conversation with yourself' });
      return;
    }

    // Check if conversation already exists between both users
    const existing = await db.query(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = $1
       JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = $2`,
      [myId, partnerId],
    );

    if (existing.rows.length) {
      res.json({ success: true, data: { conversationId: existing.rows[0].id, isNew: false } });
      return;
    }

    // Create new conversation
    const convResult = await db.query(
      'INSERT INTO conversations DEFAULT VALUES RETURNING id',
    );
    const conversationId: string = convResult.rows[0].id;

    await db.query(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)',
      [conversationId, myId, partnerId],
    );

    res.status(201).json({ success: true, data: { conversationId, isNew: true } });
  } catch (err) {
    next(err);
  }
}

export async function getMessages(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const conversationId = z.string().uuid().parse(req.params['conversationId']);
    const { page = '1', limit = '30' } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    // Verify participation
    const access = await db.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.user!.userId],
    );
    if (!access.rows.length) {
      res.status(403).json({ success: false, error: 'Not a participant in this conversation' });
      return;
    }

    const result = await db.query(
      `SELECT
         m.id, m.conversation_id, m.content, m.type, m.status, m.created_at,
         u.id           AS sender_id,
         u.username     AS sender_username,
         u.display_name AS sender_display_name,
         u.avatar_url   AS sender_avatar_url
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, limitNum, offset],
    );

    // Update last_read_at
    await db.query(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, req.user!.userId],
    );

    res.json({
      success: true,
      data: {
        messages: result.rows.reverse(), // oldest first
        page: pageNum,
        limit: limitNum,
        hasMore: result.rows.length === limitNum,
      },
    });
  } catch (err) {
    next(err);
  }
}
