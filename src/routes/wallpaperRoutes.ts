import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/authMiddleware';
import {
  getWallpapers,
  upsertGlobalWallpaper,
  upsertConversationWallpaper,
  resetConversationWallpaper,
  resetAllWallpapers,
  getWallpaperPresets,
  getWallpaperUploadPresignedUrl,
} from '../controllers/wallpaperController';

const router = Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'Upload rate limit exceeded (20/min)' },
});

router.use(authenticate);

router.get('/presets', getWallpaperPresets);
router.post('/upload-presigned-url', uploadLimiter, getWallpaperUploadPresignedUrl);
router.get('/', getWallpapers);
router.put('/global', upsertGlobalWallpaper);
router.put('/:conversationId', upsertConversationWallpaper);
router.delete('/:conversationId', resetConversationWallpaper);
router.delete('/', resetAllWallpapers);

export default router;
