import { Router } from 'express';
import {
  createStory,
  getStoryFeed,
  getMyStories,
  deleteStory,
  recordStoryView,
  getStoryViewers,
  replyToStory,
  getStoryUploadUrl,
} from '../controllers/storyController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();
router.use(authenticate);

router.post('/upload-url', getStoryUploadUrl);
router.post('/presigned-url', getStoryUploadUrl);
router.get('/feed', getStoryFeed);
router.get('/my', getMyStories);
router.post('/', createStory);
router.delete('/:id', deleteStory);
router.post('/:id/view', recordStoryView);
router.get('/:id/viewers', getStoryViewers);
router.post('/:id/reply', replyToStory);

export default router;
