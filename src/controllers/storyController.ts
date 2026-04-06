import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateUploadUrl, detectMediaType } from '../services/mediaService';

const createStorySchema = z.object({
  media_url: z
    .string()
    .min(1)
    .refine((u) => u === 'text://' || /^https?:\/\//i.test(u), 'Must be a valid http(s) URL or text://'),
  media_type: z.enum(['image', 'video', 'text']),
  caption: z.string().max(500).optional(),
  bg_color: z.string().max(30).optional(),
  overlays: z.array(z.record(z.unknown())).optional(),
  privacy: z.enum(['all', 'contacts', 'custom', 'closefriends']).default('contacts'),
  custom_audience: z.array(z.string().uuid()).optional(),
});

export async function getStoryUploadUrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { contentType } = z
      .object({ contentType: z.string() })
      .parse(req.body);

    const mediaType = detectMediaType(contentType);
    if (!mediaType || (mediaType !== 'image' && mediaType !== 'video')) {
      res.status(400).json({ success: false, error: 'Only images and videos allowed for stories' });
      return;
    }

    const result = await generateUploadUrl('stories', req.user!.userId, contentType);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function createStory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createStorySchema.parse(req.body);

    // Check story limit (10/24h)
    const countResult = await db.query(
      `SELECT COUNT(*) FROM stories
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [req.user!.userId],
    );
    if (parseInt(countResult.rows[0].count, 10) >= 10) {
      res.status(429).json({ success: false, error: 'Maximum 10 stories per 24 hours' });
      return;
    }

    const result = await db.query(
      `INSERT INTO stories
         (user_id, media_url, media_type, caption, bg_color, overlays, privacy, custom_audience, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() + INTERVAL '24 hours')
       RETURNING *`,
      [
        req.user!.userId,
        body.media_url,
        body.media_type,
        body.caption ?? null,
        body.bg_color ?? null,
        body.overlays ? JSON.stringify(body.overlays) : null,
        body.privacy,
        body.custom_audience ? `{${body.custom_audience.join(',')}}` : '{}',
      ],
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function getStoryFeed(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const myId = req.user!.userId;

    // Get stories from contacts (users I have conversations with) + own stories
    const result = await db.query(
      `SELECT
         s.*,
         u.username, u.display_name, u.avatar_url,
         EXISTS (
           SELECT 1 FROM story_views sv
           WHERE sv.story_id = s.id AND sv.viewer_id = $1
         ) AS is_viewed
       FROM stories s
       JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > NOW()
         AND (
           s.user_id = $1
           OR (
             s.user_id IN (
               SELECT DISTINCT cp2.user_id
               FROM conversation_participants cp1
               JOIN conversation_participants cp2
                 ON cp1.conversation_id = cp2.conversation_id AND cp2.user_id <> $1
               WHERE cp1.user_id = $1
             )
             AND (
               s.privacy = 'all'
               OR s.privacy = 'contacts'
               OR (s.privacy = 'closefriends' AND $1 = ANY(
                 SELECT friend_id FROM close_friends WHERE user_id = s.user_id
               ))
               OR (s.privacy = 'custom' AND $1 = ANY(s.custom_audience))
             )
           )
         )
       ORDER BY s.user_id = $1 DESC, is_viewed ASC, s.created_at DESC`,
      [myId],
    );

    // Group by user
    const grouped: Record<string, { user: unknown; stories: unknown[] }> = {};
    for (const row of result.rows) {
      const uid: string = row.user_id;
      if (!grouped[uid]) {
        grouped[uid] = {
          user: {
            id: row.user_id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
          },
          stories: [],
        };
      }
      const { username: _u, display_name: _d, avatar_url: _a, ...story } = row;
      grouped[uid].stories.push(story);
    }

    res.json({ success: true, data: Object.values(grouped) });
  } catch (err) {
    next(err);
  }
}

export async function getMyStories(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await db.query(
      `SELECT s.*, (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id)::INT AS view_count
       FROM stories s
       WHERE s.user_id = $1 AND s.expires_at > NOW()
       ORDER BY s.created_at DESC`,
      [req.user!.userId],
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function deleteStory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params['id']);
    const result = await db.query(
      'DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user!.userId],
    );
    if (!result.rows.length) {
      res.status(404).json({ success: false, error: 'Story not found' });
      return;
    }
    res.json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
}

export async function recordStoryView(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params['id']);
    await db.query(
      `INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, req.user!.userId],
    );
    await db.query(
      'UPDATE stories SET view_count = view_count + 1 WHERE id = $1 AND user_id <> $2',
      [id, req.user!.userId],
    );
    res.json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
}

export async function getStoryViewers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params['id']);

    // Only story owner can see viewers
    const ownership = await db.query('SELECT 1 FROM stories WHERE id = $1 AND user_id = $2', [id, req.user!.userId]);
    if (!ownership.rows.length) {
      res.status(403).json({ success: false, error: 'Not your story' });
      return;
    }

    const result = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, sv.viewed_at
       FROM story_views sv
       JOIN users u ON u.id = sv.viewer_id
       WHERE sv.story_id = $1
       ORDER BY sv.viewed_at DESC`,
      [id],
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function replyToStory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = z.string().uuid().parse(req.params['id']);
    const { content } = z.object({ content: z.string().min(1).max(1000) }).parse(req.body);

    const storyResult = await db.query('SELECT user_id FROM stories WHERE id = $1 AND expires_at > NOW()', [id]);
    if (!storyResult.rows.length) {
      res.status(404).json({ success: false, error: 'Story not found or expired' });
      return;
    }

    const result = await db.query(
      'INSERT INTO story_replies (story_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
      [id, req.user!.userId, content],
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
}
