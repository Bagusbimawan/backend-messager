import { Router } from 'express';
import {
  getConversations,
  createOrGetConversation,
  getMessages,
} from '../controllers/messageController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticate);

router.get('/conversations', getConversations);
router.post('/conversations', createOrGetConversation);
router.get('/conversations/:conversationId/messages', getMessages);

export default router;
