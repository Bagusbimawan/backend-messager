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
  io.use((socket: AuthenticatedSocket, next) => {
    const token =
      (socket.handshake.auth as Record<string, string>)['token'] ??
      socket.handshake.headers['authorization']?.replace('Bearer ', '');

    if (!token) { next(new Error('Authentication required')); return; }
    try {
      socket.user = jwt.verify(token, env.JWT_SECRET) as SocketUser;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const user = socket.user!;
    logger.info('Socket connected', { userId: user.userId, socketId: socket.id });

    await setUserOnline(user.userId, socket.id);
    await db.query('UPDATE users SET is_online = TRUE WHERE id = $1', [user.userId]);
    io.emit('user_online', { userId: user.userId });

    // ── Personal room (for incoming call notifications) ───────────
    void socket.join(`user:${user.userId}`);

    // ── WebRTC call signaling ─────────────────────────────────────
    socket.on('call_join_room', ({ callId }: { callId: string }) => {
      void socket.join(`call:${callId}`);
    });

    socket.on('call_leave_room', ({ callId }: { callId: string }) => {
      void socket.leave(`call:${callId}`);
    });

    socket.on('webrtc_offer', ({ callId, targetUserId, sdp }: {
      callId: string;
      targetUserId: string;
      sdp: Record<string, unknown>;
    }) => {
      socket.to(`user:${targetUserId}`).emit('webrtc_offer', {
        callId,
        fromUserId: user.userId,
        sdp,
      });
    });

    socket.on('webrtc_answer', ({ callId, targetUserId, sdp }: {
      callId: string;
      targetUserId: string;
      sdp: Record<string, unknown>;
    }) => {
      socket.to(`user:${targetUserId}`).emit('webrtc_answer', {
        callId,
        fromUserId: user.userId,
        sdp,
      });
    });

    socket.on('webrtc_ice_candidate', ({ callId, targetUserId, candidate }: {
      callId: string;
      targetUserId: string;
      candidate: Record<string, unknown>;
    }) => {
      socket.to(`user:${targetUserId}`).emit('webrtc_ice_candidate', {
        callId,
        fromUserId: user.userId,
        candidate,
      });
    });

    socket.on('call_toggle_mute', ({ callId, isMuted }: { callId: string; isMuted: boolean }) => {
      socket.to(`call:${callId}`).emit('call_participant_muted', {
        userId: user.userId,
        isMuted,
      });
    });

    socket.on('call_toggle_camera', ({ callId, isCameraOff }: { callId: string; isCameraOff: boolean }) => {
      socket.to(`call:${callId}`).emit('call_participant_camera', {
        userId: user.userId,
        isCameraOff,
      });
    });

    // ── 1-on-1 conversation room ──────────────────────────────────
    socket.on('join_room', async ({ conversationId }: { conversationId: string }) => {
      const access = await db.query(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
        [conversationId, user.userId],
      );
      if (access.rows.length) await socket.join(conversationId);
    });

    socket.on('leave_room', ({ conversationId }: { conversationId: string }) => {
      socket.leave(conversationId);
    });

    // ── Community topic room ──────────────────────────────────────
    socket.on('join_topic', async ({ communityId, topicId }: { communityId: string; topicId: string }) => {
      const access = await db.query(
        'SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2 AND is_banned = FALSE',
        [communityId, user.userId],
      );
      if (access.rows.length) await socket.join(`topic:${topicId}`);
    });

    socket.on('leave_topic', ({ topicId }: { topicId: string }) => {
      socket.leave(`topic:${topicId}`);
    });

    socket.on('community_typing', ({ topicId, isTyping }: { topicId: string; isTyping: boolean }) => {
      const event = isTyping ? 'community_user_typing' : 'community_user_stop_typing';
      socket.to(`topic:${topicId}`).emit(event, {
        topicId,
        userId: user.userId,
        displayName: (socket as AuthenticatedSocket & { user?: SocketUser }).user?.username ?? '',
      });
    });

    // ── Send message (conversation) ───────────────────────────────
    socket.on(
      'send_message',
      async (payload: {
        conversationId: string;
        content: string;
        media_url?: string;
        media_type?: string;
        media_size?: number;
        media_duration?: number;
        thumbnail_url?: string;
        media_filename?: string;
        reply_to_id?: string;
      }) => {
        try {
          const { conversationId, content, ...media } = payload;
          if (!content?.trim() && !media.media_url) return;

          const access = await db.query(
            'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
            [conversationId, user.userId],
          );
          if (!access.rows.length) return;

          const result = await db.query(
            `INSERT INTO messages
               (conversation_id, sender_id, content, type, status,
                media_url, media_type, media_size, media_duration,
                thumbnail_url, media_filename, reply_to_id)
             VALUES ($1,$2,$3,$4,'sent',$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
              conversationId,
              user.userId,
              (content?.trim() || media.media_filename || media.media_type || 'media'),
              media.media_url ? (media.media_type ?? 'image') : 'text',
              media.media_url ?? null,
              media.media_type ?? null,
              media.media_size ?? null,
              media.media_duration ?? null,
              media.thumbnail_url ?? null,
              media.media_filename ?? null,
              media.reply_to_id ?? null,
            ],
          );
          const message = result.rows[0];

          // Attach sender info + reply_to preview
          const senderResult = await db.query(
            'SELECT id, username, display_name, avatar_url FROM users WHERE id = $1',
            [user.userId],
          );
          let replyTo = null;
          if (media.reply_to_id) {
            const replyResult = await db.query(
              'SELECT id, content, sender_id FROM messages WHERE id = $1',
              [media.reply_to_id],
            );
            replyTo = replyResult.rows[0] ?? null;
          }

          const fullMessage = { ...message, sender: senderResult.rows[0], reply_to: replyTo };
          io.to(conversationId).emit('new_message', { message: fullMessage });

          // Disappearing message schedule
          await checkDisappearingSetting(conversationId, message.id);

          // Push notification for offline participants
          const participants = await db.query(
            'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2',
            [conversationId, user.userId],
          );
          for (const { user_id } of participants.rows) {
            if (await redis.exists(`presence:${user_id as string}`)) {
              await db.query("UPDATE messages SET status = 'delivered' WHERE id = $1", [message.id]);
              socket.emit('message_status', { messageId: message.id, status: 'delivered' });
            } else {
              void sendPushNotification(user_id as string, {
                title: senderResult.rows[0].display_name as string,
                body: content?.trim().slice(0, 100) || `📎 ${media.media_type ?? 'media'}`,
                data: { conversationId, messageId: message.id as string },
              });
            }
          }
        } catch (err) {
          logger.error('send_message error', { error: (err as Error).message });
        }
      },
    );

    // ── Send community topic message ──────────────────────────────
    socket.on(
      'send_community_message',
      async (payload: { communityId: string; topicId: string; content: string; reply_to_id?: string }) => {
        try {
          const { communityId, topicId, content, reply_to_id } = payload;
          if (!content?.trim()) return;

          // Verify membership + check announcements-only
          const member = await db.query(
            `SELECT cm.role, ct.is_announcements_only
             FROM community_members cm
             JOIN community_topics ct ON ct.id = $2
             WHERE cm.community_id = $1 AND cm.user_id = $3 AND cm.banned_at IS NULL`,
            [communityId, topicId, user.userId],
          );
          if (!member.rows.length) return;
          const { role, is_announcements_only } = member.rows[0];
          if (is_announcements_only && !['owner', 'admin'].includes(role)) return;

          // Slow mode check
          const community = await db.query(
            'SELECT slow_mode_seconds FROM communities WHERE id = $1', [communityId],
          );
          if (community.rows[0]?.slow_mode_seconds > 0) {
            const lastMsgKey = `slowmode:${communityId}:${user.userId}`;
            if (await redis.exists(lastMsgKey)) return;
            await redis.setex(lastMsgKey, community.rows[0].slow_mode_seconds, '1');
          }

          const result = await db.query(
            `INSERT INTO messages (topic_id, sender_id, content, type, reply_to_id)
             VALUES ($1, $2, $3, 'text', $4) RETURNING *`,
            [topicId, user.userId, content.trim(), reply_to_id ?? null],
          );
          const senderResult = await db.query(
            'SELECT id, username, display_name, avatar_url FROM users WHERE id = $1',
            [user.userId],
          );

          const fullMessage = { ...result.rows[0], sender: senderResult.rows[0] };
          io.to(`community:${communityId}:topic:${topicId}`).emit('community_message', {
            communityId,
            topicId,
            message: fullMessage,
          });
        } catch (err) {
          logger.error('send_community_message error', { error: (err as Error).message });
        }
      },
    );

    // ── Edit message ──────────────────────────────────────────────
    socket.on('edit_message', async ({ messageId, content }: { messageId: string; content: string }) => {
      try {
        if (!content?.trim()) return;
        const result = await db.query(
          `UPDATE messages SET content = $1, is_edited = TRUE, edited_at = NOW()
           WHERE id = $2 AND sender_id = $3
             AND created_at > NOW() - INTERVAL '15 minutes'
           RETURNING conversation_id, topic_id`,
          [content.trim(), messageId, user.userId],
        );
        if (!result.rows.length) return;

        const { conversation_id, topic_id } = result.rows[0];
        const room = conversation_id ?? `community:*:topic:${topic_id as string}`;
        io.to(conversation_id ?? room).emit('message_edited', {
          messageId,
          content: content.trim(),
          edited_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.error('edit_message error', { error: (err as Error).message });
      }
    });

    // ── Delete message ────────────────────────────────────────────
    socket.on('delete_message', async ({ messageId }: { messageId: string }) => {
      try {
        const result = await db.query(
          `UPDATE messages SET deleted_for_all = TRUE, content = '[Tinanggal na mensahe]'
           WHERE id = $1 AND sender_id = $2
           RETURNING conversation_id, topic_id`,
          [messageId, user.userId],
        );
        if (!result.rows.length) return;

        const { conversation_id, topic_id } = result.rows[0];
        io.to(conversation_id ?? `community:*:topic:${topic_id as string}`).emit('message_deleted', { messageId });
      } catch (err) {
        logger.error('delete_message error', { error: (err as Error).message });
      }
    });

    // ── Reaction (broadcast) ──────────────────────────────────────
    socket.on(
      'reaction_updated',
      ({ messageId, reactions, conversationId, topicId }: {
        messageId: string;
        reactions: unknown[];
        conversationId?: string;
        topicId?: string;
      }) => {
        const room = conversationId ?? (topicId ? `community:*:topic:${topicId}` : null);
        if (room) io.to(room).emit('reaction_updated', { messageId, reactions });
      },
    );

    // ── Typing ────────────────────────────────────────────────────
    socket.on('typing_start', ({ conversationId }: { conversationId: string }) => {
      socket.to(conversationId).emit('user_typing', { userId: user.userId, username: user.username, conversationId });
    });
    socket.on('typing_stop', ({ conversationId }: { conversationId: string }) => {
      socket.to(conversationId).emit('user_stop_typing', { userId: user.userId, conversationId });
    });

    // ── Mark read ─────────────────────────────────────────────────
    socket.on('mark_read', async ({ conversationId, messageId }: { conversationId: string; messageId: string }) => {
      try {
        await db.query("UPDATE messages SET status = 'read' WHERE id = $1 AND conversation_id = $2", [messageId, conversationId]);
        await db.query(
          'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
          [conversationId, user.userId],
        );
        socket.to(conversationId).emit('message_status', { messageId, status: 'read' });
      } catch (err) {
        logger.error('mark_read error', { error: (err as Error).message });
      }
    });

    // ── Group chat rooms ──────────────────────────────────────────
    socket.on('group_join', async ({ groupId }: { groupId: string }) => {
      const access = await db.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, user.userId],
      );
      if (access.rows.length) await socket.join(`group:${groupId}`);
    });

    socket.on('group_leave', ({ groupId }: { groupId: string }) => {
      socket.leave(`group:${groupId}`);
    });

    socket.on('group_typing_start', ({ groupId }: { groupId: string }) => {
      socket.to(`group:${groupId}`).emit('group_user_typing', {
        groupId,
        userId: user.userId,
        displayName: (socket as AuthenticatedSocket & { user?: SocketUser }).user?.username ?? '',
      });
    });

    socket.on('group_typing_stop', ({ groupId }: { groupId: string }) => {
      socket.to(`group:${groupId}`).emit('group_user_stop_typing', {
        groupId,
        userId: user.userId,
      });
    });

    // ── Channel rooms ─────────────────────────────────────────────
    socket.on('channel_join', async ({ channelId }: { channelId: string }) => {
      const access = await db.query(
        `SELECT 1 FROM channels WHERE id = $1 AND (is_public = TRUE
           OR owner_id = $2
           OR EXISTS(SELECT 1 FROM channel_subscribers WHERE channel_id = $1 AND user_id = $2))`,
        [channelId, user.userId],
      );
      if (access.rows.length) await socket.join(`channel:${channelId}`);
    });

    socket.on('channel_leave', ({ channelId }: { channelId: string }) => {
      socket.leave(`channel:${channelId}`);
    });

    // ── Story events ──────────────────────────────────────────────
    socket.on('story_viewed', ({ storyOwnerId }: { storyOwnerId: string }) => {
      socket.to(`story:${storyOwnerId}`).emit('story_view_update', { viewerId: user.userId });
    });

    socket.on('join_story_updates', ({ userId }: { userId: string }) => {
      socket.join(`story:${userId}`);
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        await setUserOffline(user.userId);
        await db.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1', [user.userId]);
        io.emit('user_offline', { userId: user.userId, lastSeen: new Date().toISOString() });
        logger.info('Socket disconnected', { userId: user.userId });
      } catch (err) {
        logger.error('disconnect handler error', { error: (err as Error).message });
      }
    });
  });
}

async function checkDisappearingSetting(conversationId: string, messageId: string): Promise<void> {
  const result = await db.query(
    'SELECT disappear_after FROM conversation_participants WHERE conversation_id = $1 LIMIT 1',
    [conversationId],
  );
  const setting: string = result.rows[0]?.disappear_after ?? 'off';
  if (setting === 'off') return;

  const intervals: Record<string, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
  const interval = intervals[setting];
  if (!interval) return;

  await db.query(
    `UPDATE messages SET disappears_at = NOW() + INTERVAL '${interval}' WHERE id = $1`,
    [messageId],
  );
}
