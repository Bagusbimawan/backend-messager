import { Response } from 'express'
import { db } from '../config/db'
import { z } from 'zod'
import { AuthRequest } from '../middleware/authMiddleware'

// ─── Validation Schemas ────────────────────────────────────────────────────

const createCommunitySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  coverUrl: z.string().url().optional(),
  category: z.string().max(50).default('general'),
  tags: z.array(z.string().max(30)).max(10).default([]),
  isPublic: z.boolean().default(true),
})

const createTopicSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  isAnnouncementsOnly: z.boolean().default(false),
})

const sendTopicMessageSchema = z.object({
  content: z.string().max(4000).optional(),
  type: z.enum(['text', 'image', 'video', 'audio', 'file']),
  mediaUrl: z.string().url().optional(),
  mediaType: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  replyToId: z.string().uuid().optional(),
})

const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
})

// ─── Controller Functions ──────────────────────────────────────────────────

// GET /api/communities
export async function getMyCommunities(req: AuthRequest, res: Response) {
  const userId = req.user!.userId

  const { rows } = await db.query(`
    SELECT c.*, cm.role AS my_role
    FROM communities c
    INNER JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = $1
    WHERE cm.is_banned = FALSE
    ORDER BY c.created_at DESC
  `, [userId])

  res.json({ success: true, data: rows })
}

// POST /api/communities
export async function createCommunity(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const body = createCommunitySchema.parse(req.body)

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const { rows: [community] } = await client.query(`
      INSERT INTO communities (name, description, cover_url, category, tags, is_public, owner_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [body.name, body.description ?? null, body.coverUrl ?? null, body.category, body.tags, body.isPublic, userId])

    // Add owner as member
    await client.query(`
      INSERT INTO community_members (community_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `, [community.id, userId])

    // Create default topic
    await client.query(`
      INSERT INTO community_topics (community_id, name, description, is_default, position)
      VALUES ($1, 'General', 'General discussion', TRUE, 0)
    `, [community.id])

    await client.query('COMMIT')
    res.status(201).json({ success: true, data: { ...community, my_role: 'owner' } })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// GET /api/communities/explore?category=&q=&cursor=
export async function exploreCommunities(req: AuthRequest, res: Response) {
  const category = req.query.category as string | undefined
  const search = req.query.q as string | undefined
  const cursor = req.query.cursor as string | undefined
  const limit = 20

  let query = `
    SELECT c.*,
           EXISTS(SELECT 1 FROM community_members WHERE community_id = c.id AND user_id = $1) AS is_member
    FROM communities c
    WHERE c.is_public = TRUE
  `
  const params: any[] = [req.user!.userId]
  let paramIndex = 2

  if (category) {
    query += ` AND c.category = $${paramIndex}`
    params.push(category)
    paramIndex++
  }

  if (search) {
    query += ` AND (c.name ILIKE $${paramIndex} OR c.description ILIKE $${paramIndex})`
    params.push(`%${search}%`)
    paramIndex++
  }

  if (cursor) {
    query += ` AND c.created_at < $${paramIndex}`
    params.push(cursor)
    paramIndex++
  }

  query += ` ORDER BY c.member_count DESC, c.created_at DESC LIMIT $${paramIndex}`
  params.push(limit)

  const { rows } = await db.query(query, params)

  const hasMore = rows.length === limit
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null

  res.json({ success: true, data: { communities: rows, nextCursor, hasMore } })
}

// GET /api/communities/:id
export async function getCommunityDetail(req: AuthRequest, res: Response) {
  const { id } = req.params
  const userId = req.user!.userId

  const { rows: [community] } = await db.query(`
    SELECT c.*,
           cm.role AS my_role,
           cm.is_banned
    FROM communities c
    LEFT JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = $2
    WHERE c.id = $1
  `, [id, userId])

  if (!community) return res.status(404).json({ success: false, error: 'Community not found' })

  // Fetch topics
  const { rows: topics } = await db.query(`
    SELECT * FROM community_topics
    WHERE community_id = $1
    ORDER BY position ASC, created_at ASC
  `, [id])

  res.json({ success: true, data: { ...community, topics } })
}

// POST /api/communities/join/:inviteLink
export async function joinCommunity(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { inviteLink } = req.params

  const { rows: [community] } = await db.query(
    'SELECT * FROM communities WHERE invite_link = $1',
    [inviteLink]
  )
  if (!community) return res.status(404).json({ success: false, error: 'Invalid invite link' })

  const { rows: [existing] } = await db.query(
    'SELECT * FROM community_members WHERE community_id = $1 AND user_id = $2',
    [community.id, userId]
  )

  if (existing) {
    if (existing.is_banned) return res.status(403).json({ success: false, error: 'You are banned from this community' })
    return res.json({ success: true, data: community })
  }

  await db.query(
    'INSERT INTO community_members (community_id, user_id) VALUES ($1, $2)',
    [community.id, userId]
  )

  await db.query(
    'UPDATE communities SET member_count = member_count + 1 WHERE id = $1',
    [community.id]
  )

  res.json({ success: true, data: community })
}

// DELETE /api/communities/:id/leave
export async function leaveCommunity(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { id } = req.params

  const { rows: [member] } = await db.query(
    'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
    [id, userId]
  )

  if (!member) return res.status(404).json({ success: false, error: 'Not a member' })
  if (member.role === 'owner') return res.status(400).json({ success: false, error: 'Owner cannot leave. Transfer ownership first.' })

  await db.query('DELETE FROM community_members WHERE community_id = $1 AND user_id = $2', [id, userId])
  await db.query('UPDATE communities SET member_count = member_count - 1 WHERE id = $1', [id])

  res.json({ success: true })
}

// POST /api/communities/:id/topics
export async function createTopic(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { id } = req.params
  const body = createTopicSchema.parse(req.body)

  const { rows: [member] } = await db.query(
    'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
    [id, userId]
  )

  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' })
  }

  const { rows: [maxPos] } = await db.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM community_topics WHERE community_id = $1',
    [id]
  )

  const { rows: [topic] } = await db.query(`
    INSERT INTO community_topics (community_id, name, description, icon, is_announcements_only, position)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, body.name, body.description ?? null, body.icon ?? null, body.isAnnouncementsOnly, maxPos.next_pos])

  res.status(201).json({ success: true, data: topic })
}

// GET /api/communities/:id/topics/:topicId/messages?cursor=&limit=30
export async function getTopicMessages(req: AuthRequest, res: Response) {
  const { id, topicId } = req.params
  const userId = req.user!.userId
  const limit = Math.min(Number(req.query.limit ?? 30), 50)
  const cursor = req.query.cursor as string | undefined

  // Verify membership
  const { rows: [member] } = await db.query(
    'SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2 AND is_banned = FALSE',
    [id, userId]
  )
  if (!member) return res.status(403).json({ success: false, error: 'Not a member' })

  const { rows } = await db.query(`
    SELECT
      cm.*,
      u.display_name  AS sender_display_name,
      u.avatar_url    AS sender_avatar_url,
      u.username      AS sender_username,
      (
        SELECT json_build_object(
          'id', rm.id,
          'content', rm.content,
          'type', rm.type,
          'sender_display_name', ru.display_name
        )
        FROM community_messages rm
        LEFT JOIN users ru ON ru.id = rm.sender_id
        WHERE rm.id = cm.reply_to_id
      ) AS reply_to,
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
          FROM community_message_reactions
          WHERE message_id = cm.id
          GROUP BY emoji
        ) r
      ) AS reactions
    FROM community_messages cm
    LEFT JOIN users u ON u.id = cm.sender_id
    WHERE cm.topic_id = $1
      ${cursor ? 'AND cm.created_at < $4' : ''}
    ORDER BY cm.created_at DESC
    LIMIT $2
  `, cursor ? [topicId, limit, userId, cursor] : [topicId, limit, userId])

  const hasMore = rows.length === limit
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null

  res.json({ success: true, data: { messages: rows.reverse(), nextCursor, hasMore } })
}

// POST /api/communities/:id/topics/:topicId/messages
export async function sendTopicMessage(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { id, topicId } = req.params
  const body = sendTopicMessageSchema.parse(req.body)

  // Verify membership
  const { rows: [member] } = await db.query(
    'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 AND is_banned = FALSE',
    [id, userId]
  )
  if (!member) return res.status(403).json({ success: false, error: 'Not a member' })

  // Check if topic is announcements-only
  const { rows: [topic] } = await db.query(
    'SELECT is_announcements_only FROM community_topics WHERE id = $1',
    [topicId]
  )

  if (topic.is_announcements_only && member.role !== 'owner' && member.role !== 'admin' && member.role !== 'moderator') {
    return res.status(403).json({ success: false, error: 'Only admins and moderators can post in announcements' })
  }

  const { rows: [message] } = await db.query(`
    INSERT INTO community_messages
      (topic_id, sender_id, content, type, media_url, media_type, thumbnail_url, reply_to_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    topicId, userId,
    body.content ?? null, body.type,
    body.mediaUrl ?? null, body.mediaType ?? null,
    body.thumbnailUrl ?? null, body.replyToId ?? null,
  ])

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
    reply_to: null,
  }

  req.app.get('io').to(`topic:${topicId}`).emit('community_new_message', {
    topicId,
    message: fullMessage,
  })

  res.status(201).json({ success: true, data: fullMessage })
}

// GET /api/communities/:id/members
export async function getCommunityMembers(req: AuthRequest, res: Response) {
  const { id } = req.params
  const userId = req.user!.userId

  const { rows: [isMember] } = await db.query(
    'SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2',
    [id, userId]
  )
  if (!isMember) return res.status(403).json({ success: false, error: 'Not a member' })

  const { rows } = await db.query(`
    SELECT cm.*, u.display_name, u.username, u.avatar_url, u.is_online, u.last_seen
    FROM community_members cm
    INNER JOIN users u ON u.id = cm.user_id
    WHERE cm.community_id = $1 AND cm.is_banned = FALSE
    ORDER BY
      CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END,
      u.display_name ASC
  `, [id])

  res.json({ success: true, data: rows })
}

// PUT /api/communities/:id/members/:userId/role
export async function updateMemberRole(req: AuthRequest, res: Response) {
  const requesterId = req.user!.userId
  const { id, userId } = req.params
  const body = updateMemberRoleSchema.parse(req.body)

  const { rows: [requester] } = await db.query(
    'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
    [id, requesterId]
  )

  if (!requester) return res.status(403).json({ success: false, error: 'Not a member' })

  // Only owner can promote to admin
  if (body.role === 'admin' && requester.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Only owner can promote to admin' })
  }

  // Owner and admin can promote to moderator
  if (body.role === 'moderator' && requester.role !== 'owner' && requester.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' })
  }

  await db.query(
    'UPDATE community_members SET role = $1 WHERE community_id = $2 AND user_id = $3',
    [body.role, id, userId]
  )

  res.json({ success: true })
}

// DELETE /api/communities/:id/members/:userId
export async function kickMember(req: AuthRequest, res: Response) {
  const requesterId = req.user!.userId
  const { id, userId } = req.params
  const ban = req.query.ban === 'true'

  const { rows: [requester] } = await db.query(
    'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
    [id, requesterId]
  )

  if (!requester || (requester.role !== 'owner' && requester.role !== 'admin' && requester.role !== 'moderator')) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' })
  }

  if (ban) {
    await db.query(
      'UPDATE community_members SET is_banned = TRUE WHERE community_id = $1 AND user_id = $2',
      [id, userId]
    )
  } else {
    await db.query(
      'DELETE FROM community_members WHERE community_id = $1 AND user_id = $2',
      [id, userId]
    )
  }

  await db.query('UPDATE communities SET member_count = member_count - 1 WHERE id = $1', [id])

  res.json({ success: true })
}
