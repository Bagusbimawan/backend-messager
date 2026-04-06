import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import * as c from '../controllers/contactController';

const router = Router();
router.use(authMiddleware);

router.post('/sync',          c.syncContacts);
router.get('/',               c.getContacts);
router.post('/:userId',       c.addContact);
router.delete('/:userId',     c.removeContact);
router.get('/qr/:userId',     c.getQrData);

export default router;
