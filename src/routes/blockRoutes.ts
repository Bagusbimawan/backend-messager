import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import * as b from '../controllers/blockController';

const router = Router();
router.use(authMiddleware);

router.get('/check/:userId',  b.checkBlocked);
router.get('/',               b.getBlockedUsers);
router.post('/:userId',       b.blockUser);
router.delete('/:userId',     b.unblockUser);

export default router;
