import { Router } from 'express';
import {
  searchUsers,
  getUserById,
  getMe,
  updateMe,
  getAvatarUploadUrl,
} from '../controllers/userController';
import { authenticate } from '../middleware/authMiddleware';
import { checkNotBlocked } from '../middleware/blockMiddleware';

const router = Router();

router.use(authenticate);

router.get('/me', getMe);
router.put('/me', updateMe);
router.post('/me/avatar-url', getAvatarUploadUrl);
router.get('/search', searchUsers);
router.get('/:id', checkNotBlocked('id'), getUserById);

export default router;
