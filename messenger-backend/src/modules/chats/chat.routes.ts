import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  getMyChatsHandler,
  getChatHandler,
  createDirectHandler,
  createGroupHandler,
  createSecretHandler,
  savedMessagesHandler,
  leaveChatHandler,
  addMembersHandler,
  removeMemberHandler,
  updateChatHandler,
  pinMessageHandler,
  getSharedMediaHandler,
  exportChatHandler,
  exportAllChatsHandler,
  archiveChatHandler,
  pinChatHandler,
  upsertDraftHandler,
  deleteDraftHandler,
  deleteGroupHandler,
} from './chat.controller';

const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: 'Export is limited to 1 request per 5 minutes' },
});

const router = Router();

router.use(authMiddleware);

router.get('/', getMyChatsHandler);
router.get('/export/all', exportLimiter, exportAllChatsHandler);
router.get('/:id', getChatHandler);
router.get('/:id/shared', getSharedMediaHandler);
router.get('/:id/export', exportLimiter, exportChatHandler);
router.post('/saved', savedMessagesHandler);
router.post('/direct', createDirectHandler);
router.post('/group', createGroupHandler);
router.post('/secret', createSecretHandler);
router.patch('/:id', updateChatHandler);
router.post('/:id/members', addMembersHandler);
router.delete('/:id/members/:userId', removeMemberHandler);
router.patch('/:id/pin', pinMessageHandler);
router.delete('/:id/leave', leaveChatHandler);
router.delete('/:id', deleteGroupHandler);
router.patch('/:id/archive', archiveChatHandler);
router.patch('/:id/pin-chat', pinChatHandler);
router.put('/:id/draft', upsertDraftHandler);
router.delete('/:id/draft', deleteDraftHandler);

export default router;
