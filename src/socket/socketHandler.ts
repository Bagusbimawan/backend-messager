import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { db } from '../config/db';
import { redis, setUserOnline, setUserOffline } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendPushNotification } from '../services/notificationService';

interface SocketUser {
  userId: string;
  username: string;
}

interface AuthenticatedSocket extends Socket {
  user?: SocketUser;
}

export function registerSocketHandlers(io: Server): void {
  // JWT auth middleware for Socket.IO
  io.use((socket: AuthenticatedSocket, next) => {
    const token =
      (socket.handshake.auth as Record<string, string>)['token'] ??
      socket.handshake.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as SocketUser;
      socket.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const user = socket.user!;
    logger.info('Socket connected', { userId: user.userId, socketId: socket.id });

    // Mark user online
    await setUserOnline(user.userId, socket.id);
    await db.query('UPDATE users SET is_online = TRUE WHERE id = $1', [user.userId]);
    io.emit('user_online', { userId: user.userId });

    // ── join_room ─────────────────────────────────────────────────
    socket.on('join_room', async ({ conversationId }: { conversationId: string }) => {
      try {
        const access = await db.query(
          'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
          [conversationId, user.userId],
        );
        if (!access.rows.length) return;
        await socket.join(conversationId);
      } catch (err) {
        logger.error('join_room error', { error: (err as Error).message });
      }
    });

    // ── leave_room ────────────────────────────────────────────────
    socket.on('leave_room', ({ conversationId }: { conversationId: string }) => {
      socket.leave(conversationId);
    });

    // ── send_message ──────────────────────────────────────────────
    socket.on(
      'send_message',
      async ({ conversationId, content }: { conversationId: string; content: string }) => {
        try {
          if (!content?.trim()) return;

          // Verify participation
          const access = await db.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, user.userId],
          );
          if (!access.rows.length) return;

          // Persist message
          const result = await db.query(
            `INSERT INTO messages (conversation_id, sender_id, content, type, status)
             VALUES ($1, $2, $3, 'text', 'sent')
             RETURNING id, conversation_id, sender_id, content, type, status, created_at`,
            [conversationId, user.userId, content.trim()],
          );
          const message = result.rows[0];

          // Fetch sender info
          const senderResult = await db.query(
            'SELECT id, username, display_name, avatar_url FROM users WHERE id = $1',
            [user.userId],
          );
          const fullMessage = { ...message, sender: senderResult.rows[0] };

          // Broadcast to room
          io.to(conversationId).emit('new_message', { message: fullMessage });

          // Mark as delivered for online participants
          const participants = await db.query(
            'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2',
            [conversationId, user.userId],
          );

          for (const { user_id } of participants.rows) {
            const onlineKey = await redis.exists(`presence:${user_id as string}`);
            if (onlineKey) {
              await db.query('UPDATE messages SET status = $1 WHERE id = $2', ['delivered', message.id]);
              socket.emit('message_status', { messageId: message.id, status: 'delivered' });
            } else {
              // Send push notification to offline user
              await sendPushNotification(user_id as string, {
                title: senderResult.rows[0].display_name as string,
                body: content.trim().slice(0, 100),
                data: { conversationId, messageId: message.id as string },
              });
            }
          }
        } catch (err) {
          logger.error('send_message error', { error: (err as Error).message });
        }
      },
    );

    // ── typing_start ──────────────────────────────────────────────
    socket.on('typing_start', ({ conversationId }: { conversationId: string }) => {
      socket.to(conversationId).emit('user_typing', {
        userId: user.userId,
        username: user.username,
        conversationId,
      });
    });

    // ── typing_stop ───────────────────────────────────────────────
    socket.on('typing_stop', ({ conversationId }: { conversationId: string }) => {
      socket.to(conversationId).emit('user_stop_typing', {
        userId: user.userId,
        conversationId,
      });
    });

    // ── mark_read ─────────────────────────────────────────────────
    socket.on(
      'mark_read',
      async ({ conversationId, messageId }: { conversationId: string; messageId: string }) => {
        try {
          await db.query(
            'UPDATE messages SET status = $1 WHERE id = $2 AND conversation_id = $3',
            ['read', messageId, conversationId],
          );
          await db.query(
            'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, user.userId],
          );
          socket.to(conversationId).emit('message_status', { messageId, status: 'read' });
        } catch (err) {
          logger.error('mark_read error', { error: (err as Error).message });
        }
      },
    );

    // ── disconnect ────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        await setUserOffline(user.userId);
        const lastSeen = new Date().toISOString();
        await db.query(
          'UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1',
          [user.userId],
        );
        io.emit('user_offline', { userId: user.userId, lastSeen });
        logger.info('Socket disconnected', { userId: user.userId });
      } catch (err) {
        logger.error('disconnect handler error', { error: (err as Error).message });
      }
    });
  });
}
