import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../types';
import * as messageService from './message.service';
import { ok, fail } from '../../utils/response';
import { prisma } from '../../config/database';
import { sendToUsers } from '../../websocket/ws.server';

export async function getMessagesHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().min(1).max(100).default(50),
      q: z.string().min(1).max(200).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      senderId: z.string().optional(),
      type: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'TEXT']).optional(),
    });
    const { cursor, limit, q, from, to, senderId, type } = schema.parse(req.query);
    const filters = (from || to || senderId || type) ? { from, to, senderId, type } : undefined;
    const result = await messageService.getChatMessages(
      String(req.params.chatId),
      req.user!.sub,
      cursor,
      limit,
      q,
      filters,
    );
    ok(res, result);
  } catch (err) {
    if (err instanceof Error && err.message.includes('member')) {
      fail(res, err.message, 403);
    } else {
      next(err);
    }
  }
}

export async function getMessagesAroundHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      date: z.coerce.date(),
      limit: z.coerce.number().min(1).max(100).default(50),
    });
    const { date, limit } = schema.parse(req.query);
    const result = await messageService.getMessagesAroundDate(
      String(req.params.chatId),
      req.user!.sub,
      date,
      limit,
    );
    ok(res, result);
  } catch (err) {
    if (err instanceof Error && err.message.includes('member')) {
      fail(res, err.message, 403);
    } else {
      next(err);
    }
  }
}

export async function markAsReadHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { chatId, senderId, readAt } = await messageService.markAsRead(
      String(req.params.id),
      req.user!.sub,
    );
    // Уведомить отправителя о прочтении
    sendToUsers(
      [senderId],
      {
        event: 'message:read',
        payload: {
          messageId: String(req.params.id),
          chatId,
          readBy: req.user!.sub,
          readAt,
        },
      },
    );
    ok(res, { message: 'Marked as read' });
  } catch (err) {
    if (err instanceof Error && err.message.includes('member')) {
      fail(res, err.message, 403);
    } else if (err instanceof Error && err.message === 'Message not found') {
      fail(res, err.message, 404);
    } else {
      next(err);
    }
  }
}

export async function addReactionHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { emoji } = z.object({ emoji: z.string().min(1) }).parse(req.body);
    const { reaction, chatId } = await messageService.addReaction(
      String(req.params.id),
      req.user!.sub,
      emoji,
    );
    const members = await prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
    sendToUsers(
      members.map((m) => m.userId),
      { event: 'reaction:added', payload: { reaction, chatId } },
    );
    ok(res, reaction, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'Not a member of this chat') {
      fail(res, err.message, 403);
    } else if (err instanceof Error && err.message === 'Invalid emoji') {
      fail(res, err.message, 400);
    } else {
      next(err);
    }
  }
}

export async function removeReactionHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const emoji = decodeURIComponent(String(req.params.emoji));
    const { chatId } = await messageService.removeReaction(
      String(req.params.id),
      req.user!.sub,
      emoji,
    );
    const members = await prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
    sendToUsers(
      members.map((m) => m.userId),
      {
        event: 'reaction:removed',
        payload: { messageId: String(req.params.id), userId: req.user!.sub, emoji, chatId },
      },
    );
    ok(res, { message: 'Removed' });
  } catch (err) {
    next(err);
  }
}

export async function deleteMessageHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const forEveryone = req.query.forEveryone === 'true';
    const messageId = String(req.params.id);

    const { id, chatId, newLastMessage } = await messageService.deleteMessage(messageId, req.user!.sub);

    const deletePayload = { event: 'message:deleted' as const, payload: { messageId: id, chatId, newLastMessage } };
    if (forEveryone) {
      const members = await prisma.chatMember.findMany({
        where: { chatId },
        select: { userId: true },
      });
      sendToUsers(members.map((m) => m.userId), deletePayload);
    } else {
      sendToUsers([req.user!.sub], deletePayload);
    }

    ok(res, { message: 'Deleted' });
  } catch (err) {
    if (err instanceof Error && err.message === 'Forbidden') {
      fail(res, err.message, 403);
    } else {
      next(err);
    }
  }
}

export async function editMessageHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.union([
      z.object({ text: z.string().min(1), ciphertext: z.undefined(), signalType: z.undefined() }),
      z.object({ ciphertext: z.string().min(1), signalType: z.number(), text: z.undefined() }),
    ]);
    const body = schema.parse(req.body);
    const message = await messageService.editMessage(
      String(req.params.id),
      req.user!.sub,
      body.text,
      body.ciphertext,
      body.signalType,
    );

    // Broadcast to all chat members so they see the edit in real-time
    const members = await prisma.chatMember.findMany({
      where: { chatId: message.chatId },
      select: { userId: true },
    });
    sendToUsers(
      members.map((m) => m.userId),
      { event: 'message:edited', payload: message },
    );

    ok(res, message);
  } catch (err) {
    if (err instanceof Error && err.message === 'Forbidden') {
      fail(res, err.message, 403);
    } else {
      next(err);
    }
  }
}

export async function hideMessageHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { messageId, chatId } = await messageService.hideMessage(
      String(req.params.id),
      req.user!.sub,
    );
    ok(res, { messageId, chatId });
  } catch (err) {
    if (err instanceof Error && err.message === 'Message not found') {
      fail(res, err.message, 404);
    } else if (err instanceof Error && err.message.includes('member')) {
      fail(res, err.message, 403);
    } else {
      next(err);
    }
  }
}

export async function globalSearchHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({ q: z.string().min(1).max(200) });
    const { q } = schema.parse(req.query);
    const messages = await messageService.searchMessages(req.user!.sub, q);
    ok(res, messages);
  } catch (err) { next(err); }
}
