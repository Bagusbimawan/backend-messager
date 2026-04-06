import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

const ALLOWED_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '😡', '🔥'];

export async function toggleReaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const messageId = z.string().uuid().parse(req.params['messageId']);
    const { emoji } = z.object({ emoji: z.string().max(10) }).parse(req.body);

    if (!ALLOWED_EMOJIS.includes(emoji)) {
      res.status(400).json({ success: false, error: 'Emoji not allowed' });
      return;
    }

    // Verify message access (user must be in the conversation or community)
    const message = await db.query(
      `SELECT m.conversation_id, m.topic_id FROM messages m WHERE m.id = $1`,
      [messageId],
    );
    if (!message.rows.length) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    const existing = await db.query(
      'SELECT 1 FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [messageId, req.user!.userId, emoji],
    );

    let action: 'added' | 'removed';
    if (existing.rows.length) {
      await db.query(
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
        [messageId, req.user!.userId, emoji],
      );
      action = 'removed';
    } else {
      await db.query(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)',
        [messageId, req.user!.userId, emoji],
      );
      action = 'added';
    }

    // Return updated counts
    const counts = await db.query(
      `SELECT emoji, COUNT(*)::INT AS count FROM message_reactions
       WHERE message_id = $1 GROUP BY emoji ORDER BY count DESC`,
      [messageId],
    );

    res.json({ success: true, data: { action, reactions: counts.rows, messageId } });
  } catch (err) {
    next(err);
  }
}

export async function getReactionUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const messageId = z.string().uuid().parse(req.params['messageId']);
    const emoji = z.string().max(10).parse(req.query['emoji']);

    const result = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM message_reactions mr
       JOIN users u ON u.id = mr.user_id
       WHERE mr.message_id = $1 AND mr.emoji = $2
       ORDER BY mr.created_at`,
      [messageId, emoji],
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
}
