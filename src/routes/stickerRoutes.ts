import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import * as s from '../controllers/stickerController';

const router = Router();
router.use(authMiddleware);

router.get('/packs',          s.getStickerPacks);
router.get('/packs/:packId',  s.getStickersInPack);

export default router;
