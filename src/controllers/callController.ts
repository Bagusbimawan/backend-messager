import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

const initiateCallSchema = z.object({
  callType: z.enum(['voice', 'video']),
  roomType: z.enum(['direct', 'group']),
  conversationId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  recipientIds: z.array(z.string().uuid()).min(1).max(7),
});

// POST /api/calls/initiate
export async function initiateCall(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const body = initiateCallSchema.parse(req.body);

    // Check any recipient hasn't blocked initiator (or vice versa)
    for (const recipientId of body.recipientIds) {
      const block = await db.query(
        `SELECT 1 FROM blocked_users
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)`,
        [userId, recipientId],
      );
      if (block.rows.length) {
        res.status(403).json({ success: false, error: 'Unable to perform this action' });
        return;
      }
    }

    const { rows: [call] } = await db.query(
      `INSERT INTO calls (call_type, room_type, initiator_id, conversation_id, group_id, status)
       VALUES ($1, $2, $3, $4, $5, 'ringing')
       RETURNING *`,
      [body.callType, body.roomType, userId, body.conversationId ?? null, body.groupId ?? null],
    );

    await db.query(
      'INSERT INTO call_participants (call_id, user_id, joined_at) VALUES ($1, $2, NOW())',
      [call.id, userId],
    );

    for (const recipientId of body.recipientIds) {
      await db.query(
        'INSERT INTO call_participants (call_id, user_id) VALUES ($1, $2)',
        [call.id, recipientId],
      );
    }

    const { rows: [initiator] } = await db.query(
      'SELECT display_name, avatar_url FROM users WHERE id = $1',
      [userId],
    );

    const io = req.app.get('io');
    body.recipientIds.forEach(recipientId => {
      io.to(`user:${recipientId}`).emit('call_incoming', {
        callId: call.id,
        callType: body.callType,
        roomType: body.roomType,
        initiatorId: userId,
        initiatorName: initiator.display_name,
        initiatorAvatar: initiator.avatar_url,
      });
    });

    res.status(201).json({ success: true, data: { callId: call.id } });
  } catch (err) {
    next(err);
  }
}

// POST /api/calls/:callId/answer
export async function answerCall(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { callId } = req.params;

    await db.query(
      'UPDATE call_participants SET joined_at = NOW() WHERE call_id = $1 AND user_id = $2',
      [callId, userId],
    );

    await db.query(
      `UPDATE calls SET status = 'active', started_at = NOW()
       WHERE id = $1 AND status = 'ringing'`,
      [callId],
    );

    req.app.get('io').to(`call:${callId}`).emit('call_answered', { callId, userId });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// POST /api/calls/:callId/decline
export async function declineCall(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { callId } = req.params;

    const { rows: [call] } = await db.query('SELECT * FROM calls WHERE id = $1', [callId]);
    if (!call) {
      res.status(404).json({ success: false, error: 'Call not found' });
      return;
    }

    await db.query(
      `UPDATE calls SET status = 'declined', ended_at = NOW() WHERE id = $1`,
      [callId],
    );

    req.app.get('io').to(`user:${call.initiator_id}`).emit('call_declined', { callId, userId });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// POST /api/calls/:callId/end
export async function endCall(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { callId } = req.params;

    const { rows: [call] } = await db.query('SELECT * FROM calls WHERE id = $1', [callId]);
    if (!call) {
      res.status(404).json({ success: false, error: 'Call not found' });
      return;
    }

    const durationSecs = call.started_at
      ? Math.floor((Date.now() - new Date(call.started_at as string).getTime()) / 1000)
      : 0;

    await db.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW(), duration_secs = $2 WHERE id = $1`,
      [callId, durationSecs],
    );

    await db.query(
      `UPDATE call_participants SET left_at = NOW()
       WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [callId, userId],
    );

    req.app.get('io').to(`call:${callId}`).emit('call_ended', { callId });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/calls/history
export async function getCallHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(Number(req.query['limit'] ?? 30), 50);
    const cursor = req.query['cursor'] as string | undefined;

    const { rows } = await db.query(
      `SELECT
         c.*,
         u.display_name  AS initiator_name,
         u.avatar_url    AS initiator_avatar,
         cp.joined_at,
         cp.left_at,
         CASE WHEN c.initiator_id = $1 THEN TRUE ELSE FALSE END AS is_outgoing
       FROM calls c
       INNER JOIN call_participants cp ON cp.call_id = c.id AND cp.user_id = $1
       INNER JOIN users u ON u.id = c.initiator_id
       WHERE c.created_at < COALESCE($3::TIMESTAMP, NOW())
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [userId, limit, cursor ?? null],
    );

    const hasMore = rows.length === limit;
    res.json({
      success: true,
      data: {
        calls: rows,
        nextCursor: hasMore ? rows[rows.length - 1].created_at : null,
        hasMore,
      },
    });
  } catch (err) {
    next(err);
  }
}
