import cron from 'node-cron';
import { db } from '../config/db';
import { deleteS3Object } from '../services/mediaService';
import { logger } from '../utils/logger';

export function startBackgroundJobs(): void {
  // ── Expired story cleanup — every hour ───────────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await db.query(
        `DELETE FROM stories
         WHERE expires_at < NOW()
         RETURNING id, media_url, thumbnail_url`,
      );

      if (result.rows.length === 0) return;

      logger.info('Cleaned up expired stories', { count: result.rows.length });

      // Delete S3 objects asynchronously — don't block DB operations
      for (const story of result.rows) {
        const url: string = story.media_url;
        // Extract S3 key from URL
        const key = extractS3Key(url);
        if (key) void deleteS3Object(key);

        if (story.thumbnail_url) {
          const thumbKey = extractS3Key(story.thumbnail_url);
          if (thumbKey) void deleteS3Object(thumbKey);
        }
      }
    } catch (err) {
      logger.error('Story cleanup job failed', { error: (err as Error).message });
    }
  });

  // ── Community member_count sync — every 10 minutes ───────────────
  cron.schedule('*/10 * * * *', async () => {
    try {
      await db.query(`
        UPDATE communities c
        SET member_count = (
          SELECT COUNT(*) FROM community_members cm
          WHERE cm.community_id = c.id AND cm.banned_at IS NULL
        )
      `);
    } catch (err) {
      logger.error('member_count sync job failed', { error: (err as Error).message });
    }
  });

  // ── Disappearing messages cleanup — every 30 minutes ─────────────
  cron.schedule('*/30 * * * *', async () => {
    try {
      await db.query(`
        UPDATE messages
        SET deleted_for_all = TRUE, content = '[Mensahe ay nawala na]'
        WHERE disappears_at IS NOT NULL
          AND disappears_at < NOW()
          AND deleted_for_all = FALSE
      `);
    } catch (err) {
      logger.error('Disappearing messages cleanup failed', { error: (err as Error).message });
    }
  });

  logger.info('Background jobs started (story cleanup, member sync, disappearing messages)');
}

function extractS3Key(url: string): string | null {
  try {
    const parsed = new URL(url);
    // handles both CloudFront and S3 direct URLs
    return parsed.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}
