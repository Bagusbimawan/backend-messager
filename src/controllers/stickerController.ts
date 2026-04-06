import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// GET /api/stickers/packs
export async function getStickerPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;

    const { rows } = await db.query(
      `SELECT
         sp.*,
         CASE WHEN sp.is_premium = FALSE OR usp.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_unlocked
       FROM sticker_packs sp
       LEFT JOIN user_sticker_packs usp ON usp.pack_id = sp.id AND usp.user_id = $1
       WHERE sp.is_active = TRUE
       ORDER BY sp.sort_order ASC`,
      [userId],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

// GET /api/stickers/packs/:packId
export async function getStickersInPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const packId = z.string().uuid().parse(req.params['packId']);

    // Verify user has access
    const { rows: [pack] } = await db.query(
      `SELECT sp.*, usp.user_id AS unlocked_by
       FROM sticker_packs sp
       LEFT JOIN user_sticker_packs usp ON usp.pack_id = sp.id AND usp.user_id = $2
       WHERE sp.id = $1 AND sp.is_active = TRUE`,
      [packId, userId],
    );

    if (!pack) {
      res.status(404).json({ success: false, error: 'Pack not found' });
      return;
    }

    if (pack.is_premium && !pack.unlocked_by) {
      res.status(403).json({ success: false, error: 'Pack not unlocked' });
      return;
    }

    const { rows } = await db.query(
      'SELECT * FROM stickers WHERE pack_id = $1 ORDER BY sort_order ASC',
      [packId],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}
