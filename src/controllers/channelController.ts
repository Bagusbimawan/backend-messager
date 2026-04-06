import { Response } from 'express'
import { db } from '../config/db'
import { z } from 'zod'
import { AuthRequest } from '../middleware/authMiddleware'

// ─── Validation Schemas ────────────────────────────────────────────────────

const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  handle: z.string().min(3).max(50).regex(/^[a-z0-9_]+$/),
  description: z.string().max(1000).optional(),
  avatarUrl: z.string().url().optional(),
  coverUrl: z.string().url().optional(),
  category: z.string().max(50).default('general'),
  tags: z.array(z.string().max(30)).max(10).default([]),
  isPublic: z.boolean().default(true),
})

const createPostSchema = z.object({
  content: z.string().max(4000).optional(),
  type: z.enum(['text', 'image', 'video', 'file', 'poll', 'album']),
  mediaUrl: z.string().url().optional(),
  mediaType: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  mediaItems: z.array(z.object({
    url: z.string().url(),
    type: z.enum(['image', 'video']),
    thumbnailUrl: z.string().url().optional(),
  })).max(10).optional(),
})

const addCommentSchema = z.object({
  content: z.string().min(1).max(1000),
  replyToId: z.string().uuid().optional(),
})

const reactSchema = z.object({
  emoji: z.string().min(1).max(10),
})

// ─── Controller Functions ──────────────────────────────────────────────────

// GET /api/channels
export async function getMyChannels(req: AuthRequest, res: Response) {
  const userId = req.user!.userId

  const { rows } = await db.query(`
    SELECT c.*,
           cs.subscribed_at,
           cs.notifications,
           TRUE AS is_subscribed,
           (c.owner_id = $1) AS is_owner
    FROM channels c
    INNER JOIN channel_subscribers cs ON cs.channel_id = c.id AND cs.user_id = $1
    ORDER BY cs.subscribed_at DESC
  `, [userId])

  res.json({ success: true, data: rows })
}

// POST /api/channels
export async function createChannel(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const body = createChannelSchema.parse(req.body)

  // Check if handle is unique
  const { rows: [existing] } = await db.query(
    'SELECT 1 FROM channels WHERE handle = $1',
    [body.handle]
  )
  if (existing) return res.status(400).json({ success: false, error: 'Handle already taken' })

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const { rows: [channel] } = await client.query(`
      INSERT INTO channels (name, handle, description, avatar_url, cover_url, category, tags, is_public, owner_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [body.name, body.handle, body.description ?? null, body.avatarUrl ?? null, body.coverUrl ?? null, body.category, body.tags, body.isPublic, userId])

    // Auto-subscribe owner
    await client.query(`
      INSERT INTO channel_subscribers (channel_id, user_id)
      VALUES ($1, $2)
    `, [channel.id, userId])

    await client.query('COMMIT')
    res.status(201).json({ success: true, data: { ...channel, is_subscribed: true, is_owner: true } })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// GET /api/channels/explore?category=&q=&cursor=
export async function exploreChannels(req: AuthRequest, res: Response) {
  const category = req.query.category as string | undefined
  const search = req.query.q as string | undefined
  const cursor = req.query.cursor as string | undefined
  const limit = 20

  let query = `
    SELECT c.*,
           EXISTS(SELECT 1 FROM channel_subscribers WHERE channel_id = c.id AND user_id = $1) AS is_subscribed
    FROM channels c
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
    query += ` AND (c.name ILIKE $${paramIndex} OR c.description ILIKE $${paramIndex} OR c.handle ILIKE $${paramIndex})`
    params.push(`%${search}%`)
    paramIndex++
  }

  if (cursor) {
    query += ` AND c.created_at < $${paramIndex}`
    params.push(cursor)
    paramIndex++
  }

  query += ` ORDER BY c.subscriber_count DESC, c.created_at DESC LIMIT $${paramIndex}`
  params.push(limit)

  const { rows } = await db.query(query, params)

  const hasMore = rows.length === limit
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null

  res.json({ success: true, data: { channels: rows, nextCursor, hasMore } })
}

// GET /api/channels/:id
export async function getChannel(req: AuthRequest, res: Response) {
  const { id } = req.params
  const userId = req.user!.userId

  const { rows: [channel] } = await db.query(`
    SELECT c.*,
           EXISTS(SELECT 1 FROM channel_subscribers WHERE channel_id = c.id AND user_id = $2) AS is_subscribed,
           (c.owner_id = $2) AS is_owner
    FROM channels c
    WHERE c.id = $1
  `, [id, userId])

  if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' })

  res.json({ success: true, data: channel })
}

// POST /api/channels/:id/subscribe
export async function subscribeChannel(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { id } = req.params

  const { rows: [channel] } = await db.query('SELECT 1 FROM channels WHERE id = $1', [id])
  if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' })

  await db.query(
    'INSERT INTO channel_subscribers (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [id, userId]
  )

  await db.query(
    'UPDATE channels SET subscriber_count = subscriber_count + 1 WHERE id = $1',
    [id]
  )

  res.json({ success: true })
}

// DELETE /api/channels/:id/subscribe
export async function unsubscribeChannel(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { id } = req.params

  const { rows: [sub] } = await db.query(
    'SELECT 1 FROM channel_subscribers WHERE channel_id = $1 AND user_id = $2',
    [id, userId]
  )

  if (sub) {
    await db.query(
      'DELETE FROM channel_subscribers WHERE channel_id = $1 AND user_id = $2',
      [id, userId]
    )

    await db.query(
      'UPDATE channels SET subscriber_count = subscriber_count - 1 WHERE id = $1',
      [id]
    )
  }

  res.json({ success: true })
}

// GET /api/channels/:id/posts?cursor=&limit=20
export async function getChannelPosts(req: AuthRequest, res: Response) {
  const { id } = req.params
  const userId = req.user!.userId
  const limit = Math.min(Number(req.query.limit ?? 20), 50)
  const cursor = req.query.cursor as string | undefined

  const { rows } = await db.query(`
    SELECT
      cp.*,
      u.display_name  AS sender_display_name,
      u.avatar_url    AS sender_avatar_url,
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
          FROM channel_post_reactions
          WHERE post_id = cp.id
          GROUP BY emoji
        ) r
      ) AS reactions,
      (
        SELECT COUNT(*)::int
        FROM channel_post_comments
        WHERE post_id = cp.id
      ) AS comment_count
    FROM channel_posts cp
    LEFT JOIN users u ON u.id = cp.sender_id
    WHERE cp.channel_id = $1
      ${cursor ? 'AND cp.created_at < $4' : ''}
    ORDER BY cp.created_at DESC
    LIMIT $2
  `, cursor ? [id, limit, userId, cursor] : [id, limit, userId])

  const hasMore = rows.length === limit
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null

  res.json({ success: true, data: { posts: rows, nextCursor, hasMore } })
}

// POST /api/channels/:id/posts
export async function createChannelPost(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { id } = req.params
  const body = createPostSchema.parse(req.body)

  // Verify ownership or admin
  const { rows: [channel] } = await db.query(
    'SELECT owner_id FROM channels WHERE id = $1',
    [id]
  )

  if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' })
  if (channel.owner_id !== userId) return res.status(403).json({ success: false, error: 'Only channel owner can post' })

  const { rows: [post] } = await db.query(`
    INSERT INTO channel_posts
      (channel_id, sender_id, content, type, media_url, media_type, thumbnail_url, media_items)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    id, userId,
    body.content ?? null, body.type,
    body.mediaUrl ?? null, body.mediaType ?? null,
    body.thumbnailUrl ?? null,
    body.mediaItems ? JSON.stringify(body.mediaItems) : null,
  ])

  const { rows: [sender] } = await db.query(
    'SELECT display_name, avatar_url FROM users WHERE id = $1',
    [userId]
  )

  const fullPost = {
    ...post,
    sender_display_name: sender.display_name,
    sender_avatar_url: sender.avatar_url,
    reactions: [],
    comment_count: 0,
  }

  req.app.get('io').to(`channel:${id}`).emit('channel_new_post', {
    channelId: id,
    post: fullPost,
  })

  res.status(201).json({ success: true, data: fullPost })
}

// POST /api/channels/:id/posts/:postId/react
export async function reactToPost(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { id, postId } = req.params
  const body = reactSchema.parse(req.body)

  // Check if already reacted
  const { rows: [existing] } = await db.query(
    'SELECT 1 FROM channel_post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3',
    [postId, userId, body.emoji]
  )

  if (existing) {
    // Remove reaction
    await db.query(
      'DELETE FROM channel_post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3',
      [postId, userId, body.emoji]
    )
  } else {
    // Add reaction
    await db.query(
      'INSERT INTO channel_post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3)',
      [postId, userId, body.emoji]
    )
  }

  // Fetch updated reactions
  const { rows } = await db.query(`
    SELECT emoji,
           COUNT(*)::int AS count,
           BOOL_OR(user_id = $2) AS reacted_by_me
    FROM channel_post_reactions
    WHERE post_id = $1
    GROUP BY emoji
  `, [postId, userId])

  req.app.get('io').to(`channel:${id}`).emit('channel_post_reaction', {
    channelId: id,
    postId,
    reactions: rows,
  })

  res.json({ success: true, data: rows })
}

// GET /api/channels/:id/posts/:postId/comments
export async function getPostComments(req: AuthRequest, res: Response) {
  const { postId } = req.params

  const { rows } = await db.query(`
    SELECT
      cpc.*,
      u.display_name  AS sender_display_name,
      u.avatar_url    AS sender_avatar_url,
      u.username      AS sender_username
    FROM channel_post_comments cpc
    INNER JOIN users u ON u.id = cpc.sender_id
    WHERE cpc.post_id = $1
    ORDER BY cpc.created_at ASC
  `, [postId])

  res.json({ success: true, data: rows })
}

// POST /api/channels/:id/posts/:postId/comments
export async function addPostComment(req: AuthRequest, res: Response) {
  const userId = req.user!.userId
  const { postId } = req.params
  const body = addCommentSchema.parse(req.body)

  const { rows: [comment] } = await db.query(`
    INSERT INTO channel_post_comments (post_id, sender_id, content, reply_to_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [postId, userId, body.content, body.replyToId ?? null])

  const { rows: [sender] } = await db.query(
    'SELECT display_name, avatar_url, username FROM users WHERE id = $1',
    [userId]
  )

  const fullComment = {
    ...comment,
    sender_display_name: sender.display_name,
    sender_avatar_url: sender.avatar_url,
    sender_username: sender.username,
  }

  res.status(201).json({ success: true, data: fullComment })
}
