import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  getMessagesHandler,
  getMessagesAroundHandler,
  deleteMessageHandler,
  editMessageHandler,
  addReactionHandler,
  removeReactionHandler,
  markAsReadHandler,
  hideMessageHandler,
  globalSearchHandler,
} from './message.controller';

const router = Router();

router.use(authMiddleware);

/**
 * GET    /api/chats/:chatId/messages        — история (cursor pagination, ?q=поиск)
 * DELETE /api/messages/:id                  — удалить сообщение (для всех)
 * POST   /api/messages/:id/hide             — скрыть у себя ("удалить у себя")
 * PATCH  /api/messages/:id                  — редактировать
 * POST   /api/messages/:id/read             — отметить как прочитанное
 * POST   /api/messages/:id/reactions        — добавить реакцию { emoji }
 * DELETE /api/messages/:id/reactions/:emoji — убрать реакцию
 */
router.get('/messages/search', globalSearchHandler);
router.get('/chats/:chatId/messages/around', getMessagesAroundHandler);
router.get('/chats/:chatId/messages', getMessagesHandler);
router.delete('/messages/:id', deleteMessageHandler);
router.post('/messages/:id/hide', hideMessageHandler);
router.patch('/messages/:id', editMessageHandler);
router.post('/messages/:id/read', markAsReadHandler);
router.post('/messages/:id/reactions', addReactionHandler);
router.delete('/messages/:id/reactions/:emoji', removeReactionHandler);

export default router;
