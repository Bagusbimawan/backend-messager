import { Router } from 'express';
import { getMediaUploadUrl, getConversationMedia } from '../controllers/mediaController';
import { toggleReaction, getReactionUsers } from '../controllers/reactionController';
import { createPoll, votePoll, getPoll } from '../controllers/pollController';
import { authenticate } from '../middleware/authMiddleware';
import rateLimit from 'express-rate-limit';

const router = Router();
router.use(authenticate);

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'Upload rate limit exceeded (20/min)' },
});

router.post('/media/upload-url', uploadLimiter, getMediaUploadUrl);
router.post('/media/presigned-url', uploadLimiter, getMediaUploadUrl);
router.get('/conversations/:conversationId/media', getConversationMedia);

router.post('/messages/:messageId/reactions', toggleReaction);
router.get('/messages/:messageId/reactions', getReactionUsers);

router.post('/polls', createPoll);
router.get('/polls/:pollId', getPoll);
router.post('/polls/:pollId/vote', votePoll);

export default router;
