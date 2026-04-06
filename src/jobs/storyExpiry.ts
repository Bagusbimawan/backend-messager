import cron from 'node-cron';
import { db } from '../config/db';
import { deleteFile } from '../services/s3Service';
import { logger } from '../utils/logger';

export function startStoryExpiryJob(): void {
  cron.schedule('0 * * * *', async () => {
    try {
      const expired = await db.query(
        `SELECT id, media_url, thumbnail_url FROM stories WHERE expires_at < NOW()`,
      );

      for (const story of expired.rows) {
        if (story.media_url) {
          await deleteFile(String(story.media_url));
        }
        if (story.thumbnail_url) {
          await deleteFile(String(story.thumbnail_url));
        }
      }

      if (expired.rows.length > 0) {
        await db.query(`DELETE FROM stories WHERE expires_at < NOW()`);
      }
    } catch (error) {
      logger.error('story expiry job failed', { error: (error as Error).message });
    }
  });
}
