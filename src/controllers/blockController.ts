import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// POST /api/blocks/:userId
export async function blockUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const blockerId = req.user!.userId;
    const blockedId = z.string().uuid().parse(req.params['userId']);

    if (blockerId === blockedId) {
      res.status(400).json({ success: false, error: 'Cannot block yourself' });
      return;
    }

    await db.query(
      `INSERT INTO blocked_users (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [blockerId, blockedId],
    );

    // Remove from contacts both ways
    await db.query(
      `DELETE FROM contacts
       WHERE (user_id = $1 AND contact_id = $2)
          OR (user_id = $2 AND contact_id = $1)`,
      [blockerId, blockedId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/blocks/:userId
export async function unblockUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const blockerId = req.user!.userId;
    const blockedId = z.string().uuid().parse(req.params['userId']);

    await db.query(
      'DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2',
      [blockerId, blockedId],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/blocks
export async function getBlockedUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;

    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.username, u.avatar_url, b.blocked_at
       FROM blocked_users b
       INNER JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.blocked_at DESC`,
      [userId],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/blocks/check/:userId
export async function checkBlocked(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const targetId = z.string().uuid().parse(req.params['userId']);

    const { rows } = await db.query(
      `SELECT blocker_id FROM blocked_users
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [userId, targetId],
    );

    res.json({
      success: true,
      data: {
        isBlocked: rows.length > 0,
        iBlockedThem: rows.some(r => r.blocker_id === userId),
        theyBlockedMe: rows.some(r => r.blocker_id === targetId),
      },
    });
  } catch (err) {
    next(err);
  }
}
