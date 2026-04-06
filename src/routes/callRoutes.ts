import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import * as c from '../controllers/callController';

const router = Router();
router.use(authMiddleware);

router.post('/initiate',         c.initiateCall);
router.post('/:callId/answer',   c.answerCall);
router.post('/:callId/decline',  c.declineCall);
router.post('/:callId/end',      c.endCall);
router.get('/history',           c.getCallHistory);

export default router;
