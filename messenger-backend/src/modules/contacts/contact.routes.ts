import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  addContactHandler,
  removeContactHandler,
  getContactsHandler,
  checkContactHandler,
} from './contact.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', getContactsHandler);
router.get('/check/:userId', checkContactHandler);
router.post('/:userId', addContactHandler);
router.delete('/:userId', removeContactHandler);

export default router;
