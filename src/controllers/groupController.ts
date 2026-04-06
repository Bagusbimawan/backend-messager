import { Response } from 'express'
import { db } from '../config/db'
import { z } from 'zod'
import { AuthRequest } from '../middleware/authMiddleware'

// ─── Validation Schemas ────────────────────────────────────────────────────

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  memberIds: z.array(z.string().uuid()).min(1).max(1023),
  isPrivate: z.boolean().default(false),
})

const sendMessageSchema = z.object({
  content: z.string().max(4000).optional(),
  type: z.enum(['text', 'image', 'video', 'audio', 'file']),
  mediaUrl: z.string().url().optional(),
  mediaType: z.string().optional(),
  mediaSize: z.number().optional(),
  thumbnailUrl: z.string().url().optional(),
  replyToId: z.string().uuid().optional(),
})

// ─── Controller Functions ──────────────────────────────────────────────────

// GET /api/groups
// Returns all groups the authenticated user is a member of
// Includes: last message, unread count, my role
export async function getMyGroups(req: AuthRequest, res: Response) {
  const userId = req.user!.userId

  const { rows } = await db.query(`
    SELECT
      g.*,
      gm.role         AS my_role,
      gm.muted_until  AS my_muted_until,
      (
        SELECT COUNT(*)::int
        FROM group_members
        WHERE group_id = g.id
      ) AS member_count,
      (
        SELECT row_to_json(lm)
        FROM (
          SELECT gm2.id, gm2.content, gm2.type, gm2.created_at,
                 gm2.is_system, gm2.system_event,
                 u.display_name AS sender_display_name
          FROM group_messages gm2
          LEFT JOIN users u ON u.id = gm2.sender_id
          WHERE gm2.group_id = g.id
          ORDER BY gm2.created_at DESC
          LIMIT 1
        ) lm
      ) AS last_message,
      (
        SELECT COUNT(*)::int
        FROM group_messages gm3
        WHERE gm3.group_id = g.id
          AND gm3.created_at > COALESCE(
            (SELECT MAX(read_at) FROM group_message_reads
             WHERE user_id = $1
               AND message_id IN (
                 SELECT id FROM group_messages WHERE group_id = g.id
               )
            ), '1970-01-01'
          )
          AND gm3.sender_id != $1
      ) AS unread_count
    FROM groups g
    INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
    ORDER BY COALESCE(
      (SELECT MAX(created_at) FROM group_messages WHERE group_id = g.id),
      g.created_at
    ) DESC
  `, [userId])

  res.json({ success: true, data: rows })
}

// POST /api/groups
// Create a new group and add members
export async function createGroup(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const body = createGroupSchema.parse(req.body)

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const { rows: [group] } = await client.query(`
      INSERT INTO groups (name, description, avatar_url, is_private, owner_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [body.name, body.description ?? null, body.avatarUrl ?? null, body.isPrivate, userId])

    // Add owner
    await client.query(`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `, [group.id, userId])

    // Add members
    const otherMembers = body.memberIds.filter(id => id !== userId)
    if (otherMembers.length > 0) {
      const memberValues = otherMembers
        .map((_, i) => `($1, $${i + 2}, 'member')`)
        .join(', ')

      await client.query(`
        INSERT INTO group_members (group_id, user_id, role)
        VALUES ${memberValues}
      `, [group.id, ...otherMembers])

      // System message: group created
      await client.query(`
        INSERT INTO group_messages (group_id, sender_id, type, is_system, system_event, content)
        VALUES ($1, $2, 'system', TRUE, 'group_created', $3)
      `, [group.id, userId, `Group created`])
    }

    await client.query('COMMIT')
    res.status(201).json({ success: true, data: { ...group, my_role: 'owner' } })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// GET /api/groups/:groupId
export async function getGroup(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { groupId } = req.params

  const { rows: [group] } = await db.query(`
    SELECT g.*,
           gm.role AS my_role,
           gm.muted_until AS my_muted_until,
           (SELECT COUNT(*)::int FROM group_members WHERE group_id = g.id) AS member_count
    FROM groups g
    INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
    WHERE g.id = $1
  `, [groupId, userId])

  if (!group) return res.status(404).json({ success: false, error: 'Group not found or not a member' })
  res.json({ success: true, data: group })
}

// GET /api/groups/:groupId/messages?cursor=&limit=30
export async function getGroupMessages(req: AuthRequest, res: Response) {
  const { groupId } = req.params
  const userId = req.user!.userId
  const limit = Math.min(Number(req.query.limit ?? 30), 50)
  const cursor = req.query.cursor as string | undefined

  // Verify membership
  const { rows: [member] } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  )
  if (!member) return res.status(403).json({ success: false, error: 'Not a member' })

  const { rows } = await db.query(`
    SELECT
      gm.*,
      u.display_name  AS sender_display_name,
      u.avatar_url    AS sender_avatar_url,
      u.username      AS sender_username,
      -- reply preview
      (
        SELECT json_build_object(
          'id', rm.id,
          'content', rm.content,
          'type', rm.type,
          'sender_display_name', ru.display_name
        )
        FROM group_messages rm
        LEFT JOIN users ru ON ru.id = rm.sender_id
        WHERE rm.id = gm.reply_to_id
      ) AS reply_to,
      -- reactions
      (
        SELECT json_agg(json_build_object(
          'emoji', r.emoji,
          'count', r.cnt,
          'reacted_by_me', r.reacted_by_me
        ))
        FROM (
          SELECT emoji,
                 COUNT(*)::int AS cnt,
                 BOOL_OR(user_id = $3) AS reacted_by_me
          FROM group_message_reactions
          WHERE message_id = gm.id
          GROUP BY emoji
        ) r
      ) AS reactions,
      -- read receipts (list of userIds who read)
      (
        SELECT json_agg(gmr.user_id)
        FROM group_message_reads gmr
        WHERE gmr.message_id = gm.id
      ) AS read_by
    FROM group_messages gm
    LEFT JOIN users u ON u.id = gm.sender_id
    WHERE gm.group_id = $1
      ${cursor ? 'AND gm.created_at < $4' : ''}
    ORDER BY gm.created_at DESC
    LIMIT $2
  `, cursor ? [groupId, limit, userId, cursor] : [groupId, limit, userId])

  const hasMore = rows.length === limit
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null

  res.json({ success: true, data: { messages: rows.reverse(), nextCursor, hasMore } })
}

// POST /api/groups/:groupId/messages
export async function sendGroupMessage(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { groupId } = req.params
  const body = sendMessageSchema.parse(req.body)

  // Verify membership
  const { rows: [member] } = await db.query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  )
  if (!member) return res.status(403).json({ success: false, error: 'Not a member' })

  const { rows: [message] } = await db.query(`
    INSERT INTO group_messages
      (group_id, sender_id, content, type, media_url, media_type, media_size, thumbnail_url, reply_to_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    groupId, userId,
    body.content ?? null, body.type,
    body.mediaUrl ?? null, body.mediaType ?? null,
    body.mediaSize ?? null, body.thumbnailUrl ?? null,
    body.replyToId ?? null,
  ])

  // Fetch sender info to broadcast
  const { rows: [sender] } = await db.query(
    'SELECT display_name, avatar_url, username FROM users WHERE id = $1',
    [userId]
  )

  const fullMessage = {
    ...message,
    sender_display_name: sender.display_name,
    sender_avatar_url: sender.avatar_url,
    sender_username: sender.username,
    reactions: [],
    read_by: [],
    reply_to: null,
  }

  // Emit via Socket.IO (access io from app context)
  req.app.get('io').to(`group:${groupId}`).emit('group_new_message', {
    groupId,
    message: fullMessage,
  })

  res.status(201).json({ success: true, data: fullMessage })
}

// GET /api/groups/:groupId/members
export async function getGroupMembers(req: AuthRequest, res: Response) {
  const { groupId } = req.params
  const userId = req.user!.userId

  const { rows: [isMember] } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  )
  if (!isMember) return res.status(403).json({ success: false, error: 'Not a member' })

  const { rows } = await db.query(`
    SELECT gm.*, u.display_name, u.username, u.avatar_url, u.is_online, u.last_seen
    FROM group_members gm
    INNER JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = $1
    ORDER BY
      CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      u.display_name ASC
  `, [groupId])

  res.json({ success: true, data: rows })
}

// POST /api/groups/:groupId/members
export async function addGroupMember(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { groupId } = req.params
  const { userId: targetUserId } = z.object({ userId: z.string().uuid() }).parse(req.body)

  const { rows: [me] } = await db.query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  )
  if (!me || me.role === 'member') return res.status(403).json({ success: false, error: 'Insufficient permissions' })

  const { rows: [count] } = await db.query(
    'SELECT COUNT(*)::int AS cnt FROM group_members WHERE group_id = $1',
    [groupId]
  )
  const { rows: [group] } = await db.query('SELECT max_members FROM groups WHERE id = $1', [groupId])
  if (count.cnt >= group.max_members) return res.status(400).json({ success: false, error: 'Group is full' })

  await db.query(
    'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [groupId, targetUserId]
  )

  // System message
  const { rows: [newUser] } = await db.query('SELECT display_name FROM users WHERE id = $1', [targetUserId])
  await db.query(`
    INSERT INTO group_messages (group_id, sender_id, type, is_system, system_event, content)
    VALUES ($1, $2, 'system', TRUE, 'member_joined', $3)
  `, [groupId, userId, `${newUser.display_name} was added`])

  req.app.get('io').to(`group:${groupId}`).emit('group_member_joined', { groupId, userId: targetUserId })
  res.json({ success: true })
}

// DELETE /api/groups/:groupId/members/:targetUserId
export async function removeGroupMember(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { groupId, targetUserId } = req.params

  const { rows: [me] } = await db.query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  )
  if (!me || me.role === 'member') return res.status(403).json({ success: false, error: 'Insufficient permissions' })

  await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, targetUserId])

  const { rows: [removed] } = await db.query('SELECT display_name FROM users WHERE id = $1', [targetUserId])
  await db.query(`
    INSERT INTO group_messages (group_id, sender_id, type, is_system, system_event, content)
    VALUES ($1, $2, 'system', TRUE, 'member_removed', $3)
  `, [groupId, userId, `${removed.display_name} was removed`])

  req.app.get('io').to(`group:${groupId}`).emit('group_member_left', { groupId, userId: targetUserId })
  res.json({ success: true })
}

// DELETE /api/groups/:groupId/leave
export async function leaveGroup(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { groupId } = req.params

  const { rows: [me] } = await db.query(
    'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  )
  if (!me) return res.status(404).json({ success: false, error: 'Not a member' })
  if (me.role === 'owner') return res.status(400).json({ success: false, error: 'Owner cannot leave. Transfer ownership first.' })

  await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId])

  const { rows: [user] } = await db.query('SELECT display_name FROM users WHERE id = $1', [userId])
  await db.query(`
    INSERT INTO group_messages (group_id, sender_id, type, is_system, system_event, content)
    VALUES ($1, $2, 'system', TRUE, 'member_left', $3)
  `, [groupId, userId, `${user.display_name} left`])

  req.app.get('io').to(`group:${groupId}`).emit('group_member_left', { groupId, userId })
  res.json({ success: true })
}

// POST /api/groups/join/:inviteLink
export async function joinGroupByLink(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { inviteLink } = req.params

  const { rows: [group] } = await db.query(
    'SELECT * FROM groups WHERE invite_link = $1',
    [inviteLink]
  )
  if (!group) return res.status(404).json({ success: false, error: 'Invalid invite link' })

  const { rows: [existing] } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [group.id, userId]
  )
  if (existing) return res.json({ success: true, data: group })

  await db.query(
    'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)',
    [group.id, userId]
  )

  const { rows: [user] } = await db.query('SELECT display_name FROM users WHERE id = $1', [userId])
  await db.query(`
    INSERT INTO group_messages (group_id, sender_id, type, is_system, system_event, content)
    VALUES ($1, $2, 'system', TRUE, 'member_joined', $3)
  `, [group.id, userId, `${user.display_name} joined`])

  req.app.get('io').to(`group:${group.id}`).emit('group_member_joined', { groupId: group.id, userId })
  res.json({ success: true, data: group })
}
