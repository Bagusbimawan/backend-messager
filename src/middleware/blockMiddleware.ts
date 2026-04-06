import { Response, NextFunction } from 'express';
import { db } from '../config/db';
import { AuthRequest } from './authMiddleware';

/**
 * Factory middleware: checks neither party has blocked the other.
 * Pass the name of the route param that holds the target user ID.
 * Falls back to req.body.recipientId when param is not present.
 */
export function checkNotBlocked(targetUserIdParam: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.userId;
    const targetId = (req.params[targetUserIdParam] ?? req.body?.recipientId) as string | undefined;

    if (!targetId) { next(); return; }

    const { rows } = await db.query(
      `SELECT 1 FROM blocked_users
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [userId, targetId],
    );

    if (rows.length > 0) {
      res.status(403).json({ success: false, error: 'Unable to perform this action' });
      return;
    }

    next();
  };
}
