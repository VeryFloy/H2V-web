import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../types';
import * as chatService from './chat.service';
import { exportChat, exportAllChats } from './export.service';
import { ok, fail } from '../../utils/response';
import { sendToUser, sendToUsers, invalidatePartnersCache } from '../../websocket/ws.server';
import { prisma } from '../../config/database';

export async function getMyChatsHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().min(1).max(100).default(30),
      archived: z.coerce.boolean().default(false),
    });
    const { cursor, limit, archived } = schema.parse(req.query);
    const result = await chatService.getUserChats(req.user!.sub, cursor, limit, archived);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getChatHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chat = await chatService.getChatById(String(req.params.id), req.user!.sub);
    ok(res, chat);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      fail(res, err.message, 404);
    } else {
      next(err);
    }
  }
}

export async function savedMessagesHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chat = await chatService.getOrCreateSavedMessages(req.user!.sub);
    ok(res, chat);
  } catch (err) {
    next(err);
  }
}

export async function createDirectHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { targetUserId } = z
      .object({ targetUserId: z.string().min(1) })
      .parse(req.body);

    const chat = await chatService.createDirectChat(req.user!.sub, targetUserId);

    // Do NOT send chat:new to the target user here.
    // They will see the chat only when the first real message arrives (message:new handler
    // already calls loadChats() for unknown chatIds on the recipient's side).

    ok(res, chat, 201);
  } catch (err) {
    next(err);
  }
}

export async function createGroupHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      name: z.string().min(1).max(64),
      memberIds: z.array(z.string()).min(1).max(199),
    });
    const { name, memberIds } = schema.parse(req.body);
    const chat = await chatService.createGroupChat(
      req.user!.sub,
      name,
      memberIds,
    );

    for (const uid of memberIds) {
      sendToUser(uid, { event: 'chat:new', payload: chat });
    }

    ok(res, chat, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('PRIVACY_GROUP_INVITE:')) {
      const rejectedIds = err.message.replace('PRIVACY_GROUP_INVITE:', '').split(',');
      const users = await prisma.user.findMany({
        where: { id: { in: rejectedIds } },
        select: { nickname: true, firstName: true },
      });
      const names = users.map(u => u.nickname || u.firstName || '?');
      fail(res, `PRIVACY_GROUP_INVITE:${names.join(', ')}`, 403);
      return;
    }
    if (err instanceof Error && err.message.startsWith('GROUP_LIMIT_EXCEEDED:')) {
      fail(res, err.message, 400);
      return;
    }
    next(err);
  }
}

export async function createSecretHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { targetUserId } = z
      .object({ targetUserId: z.string().min(1) })
      .parse(req.body);

    const chat = await chatService.createSecretChat(req.user!.sub, targetUserId);

    // Notify the target user about the new secret chat immediately
    sendToUser(targetUserId, { event: 'chat:new', payload: chat });

    ok(res, chat, 201);
  } catch (err) {
    next(err);
  }
}

export async function addMembersHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userIds } = z.object({ userIds: z.array(z.string()).min(1).max(199) }).parse(req.body);
    const chat = await chatService.addMembers(String(req.params.id), req.user!.sub, userIds);

    const existingMemberIds = chat.members.map((m: any) => m.userId ?? m.user?.id).filter(Boolean) as string[];

    // Invalidate partners cache for ALL members so presence/typing events reach
    // the newly added users immediately without waiting for the 60 s TTL.
    for (const uid of existingMemberIds) invalidatePartnersCache(uid);
    for (const uid of userIds) invalidatePartnersCache(uid);

    for (const uid of userIds) {
      sendToUser(uid, { event: 'chat:new', payload: chat });
    }
    for (const uid of existingMemberIds) {
      if (!userIds.includes(uid)) {
        sendToUser(uid, { event: 'chat:updated', payload: chat });
      }
    }

    ok(res, chat);
  } catch (err) {
    if (err instanceof Error && err.message.includes('OWNER')) fail(res, err.message, 403);
    else if (err instanceof Error && err.message.includes('GROUP_LIMIT')) fail(res, err.message, 400);
    else next(err);
  }
}

export async function removeMemberHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = String(req.params.id);
    const targetUserId = String(req.params.userId);
    const { allMemberIds, systemMessage } = await chatService.removeMember(chatId, req.user!.sub, targetUserId);

    // Invalidate cache for all former members so the removed user's presence
    // stops broadcasting to them and vice versa.
    for (const uid of allMemberIds) invalidatePartnersCache(uid);
    invalidatePartnersCache(targetUserId);

    sendToUser(targetUserId, { event: 'chat:deleted', payload: { chatId } });
    for (const uid of allMemberIds) {
      if (uid !== targetUserId) {
        sendToUser(uid, { event: 'chat:member-left', payload: { chatId, userId: targetUserId } });
        if (systemMessage) {
          sendToUser(uid, { event: 'message:new', payload: systemMessage });
        }
      }
    }

    ok(res, { message: 'Member removed' });
  } catch (err) {
    if (err instanceof Error && (err.message.includes('OWNER') || err.message.includes('ADMIN') || err.message.includes('Only'))) {
      fail(res, err.message, 403);
    } else next(err);
  }
}

export async function updateChatHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      name: z.string().min(1).max(64).optional(),
      avatar: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const chat = await chatService.updateChat(String(req.params.id), req.user!.sub, data);

    const memberIds = chat.members.map((m: any) => m.userId ?? m.user?.id).filter(Boolean);
    for (const uid of memberIds) {
      sendToUser(uid, { event: 'chat:updated', payload: chat });
    }

    ok(res, chat);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Only')) fail(res, err.message, 403);
    else next(err);
  }
}

export async function pinMessageHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({ messageId: z.string().nullable() });
    const { messageId } = schema.parse(req.body);
    const result = await chatService.pinMessage(String(req.params.id), req.user!.sub, messageId);
    const { allMemberIds, ...chat } = result;

    for (const uid of allMemberIds) {
      sendToUser(uid, { event: 'chat:updated', payload: chat });
    }

    ok(res, chat);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Only')) fail(res, err.message, 403);
    else next(err);
  }
}

export async function getSharedMediaHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tab = (['media', 'files', 'links', 'voice'] as const).includes(req.query.tab as any)
      ? (req.query.tab as 'media' | 'files' | 'links' | 'voice')
      : 'media';
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const result = await chatService.getSharedMedia(String(req.params.id), req.user!.sub, tab, cursor);
    ok(res, result);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Not a member')) fail(res, err.message, 403);
    else next(err);
  }
}

export async function leaveChatHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = String(req.params.id);
    const { type, allMemberIds, systemMessage } = await chatService.leaveChat(chatId, req.user!.sub);

    // Invalidate partners cache for everyone affected by the membership change.
    for (const uid of allMemberIds) invalidatePartnersCache(uid);

    if (type === 'DIRECT' || type === 'SECRET') {
      for (const uid of allMemberIds) {
        sendToUser(uid, { event: 'chat:deleted', payload: { chatId } });
      }
      ok(res, { message: 'Chat deleted' });
    } else {
      const remainingIds = allMemberIds.filter((id) => id !== req.user!.sub);
      for (const uid of allMemberIds) {
        if (uid === req.user!.sub) {
          sendToUser(uid, { event: 'chat:deleted', payload: { chatId } });
        } else {
          sendToUser(uid, { event: 'chat:member-left', payload: { chatId, userId: req.user!.sub } });
          if (systemMessage) {
            sendToUser(uid, { event: 'message:new', payload: systemMessage });
          }
        }
      }
      ok(res, { message: 'Left group' });
    }
  } catch (err) {
    next(err);
  }
}

export async function deleteGroupHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = String(req.params.id);
    const { allMemberIds } = await chatService.deleteGroup(chatId, req.user!.sub);
    for (const uid of allMemberIds) {
      invalidatePartnersCache(uid);
      sendToUser(uid, { event: 'chat:deleted', payload: { chatId } });
    }
    ok(res, { message: 'Group deleted' });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Not found')) fail(res, err.message, 403);
    else next(err);
  }
}

export async function exportChatHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = String(req.params.id);
    const format = req.query.format === 'html' ? 'html' : 'json';
    await exportChat(chatId, req.user!.sub, format, res);
  } catch (err) {
    if (err instanceof Error && err.message.includes('member')) {
      fail(res, err.message, 403);
    } else if (err instanceof Error && err.message === 'Chat not found') {
      fail(res, err.message, 404);
    } else {
      next(err);
    }
  }
}

export async function exportAllChatsHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const format = req.query.format === 'html' ? 'html' : 'json';
    await exportAllChats(req.user!.sub, format, res);
  } catch (err) {
    next(err);
  }
}

export async function upsertDraftHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      text: z.string().min(1).max(10000),
      replyToId: z.string().nullable().optional(),
    });
    const { text, replyToId } = schema.parse(req.body);
    const chatId = String(req.params.id);
    const userId = req.user!.sub;
    const draft = await chatService.upsertDraft(chatId, userId, text, replyToId);
    sendToUser(userId, {
      event: 'draft:updated',
      payload: { chatId, text: draft.text, replyToId: draft.replyToId },
    });
    ok(res, draft);
  } catch (err) {
    if (err instanceof Error && err.message.includes('member')) fail(res, err.message, 403);
    else next(err);
  }
}

export async function deleteDraftHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = String(req.params.id);
    const userId = req.user!.sub;
    await chatService.deleteDraft(chatId, userId);
    sendToUser(userId, {
      event: 'draft:updated',
      payload: { chatId, text: null, replyToId: null },
    });
    ok(res, { message: 'Draft deleted' });
  } catch (err) {
    next(err);
  }
}

export async function archiveChatHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = String(req.params.id);
    const schema = z.object({ archived: z.boolean() });
    const { archived } = schema.parse(req.body);
    const result = await chatService.toggleArchiveChat(chatId, req.user!.sub, archived);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function pinChatHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = String(req.params.id);
    const schema = z.object({ pinned: z.boolean() });
    const { pinned } = schema.parse(req.body);
    const result = await chatService.togglePinChat(chatId, req.user!.sub, pinned);
    ok(res, result);
  } catch (err) {
    if (err instanceof Error && err.message === 'PIN_LIMIT') {
      res.status(400).json({ error: 'Maximum 5 pinned chats' });
      return;
    }
    next(err);
  }
}
