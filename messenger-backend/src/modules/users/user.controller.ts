import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../types';
import * as userService from './user.service';
import { ok, fail } from '../../utils/response';
import { userSockets, broadcastUserUpdated, updateUserShowOnline, sendToUser } from '../../websocket/ws.server';

export async function getMeHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await userService.getMyProfile(req.user!.sub);
    ok(res, user);
  } catch (err) {
    next(err);
  }
}

export async function getUserHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await userService.getById(String(req.params.id), req.user?.sub);
    ok(res, user);
  } catch (err) {
    if (err instanceof Error && err.message === 'User not found') {
      fail(res, err.message, 404);
    } else {
      next(err);
    }
  }
}

export async function searchUsersHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const q = z.string().min(1).max(100).parse(req.query.q);
    const users = await userService.search(q, req.user?.sub);
    ok(res, users);
  } catch (err) {
    next(err);
  }
}

export async function updateMeHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      nickname:  z.string().min(5).max(32).regex(/^[a-zA-Z][a-zA-Z0-9.]{4,31}$/).optional(),
      firstName: z.string().max(64).nullable().optional(),
      lastName:  z.string().max(64).nullable().optional(),
      avatar:    z.string().nullable().optional(),
      bio:       z.string().max(70).nullable().optional(),
    });
    const data = schema.parse(req.body);
    const user = await userService.updateProfile(req.user!.sub, data);
    await broadcastUserUpdated(req.user!.sub, {
      nickname: user.nickname,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      bio: user.bio,
    });
    ok(res, user);
  } catch (err) {
    if (err instanceof Error && err.message === 'NICKNAME_TAKEN') {
      fail(res, 'NICKNAME_TAKEN', 409); return;
    }
    next(err);
  }
}

export async function deleteMeHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    await userService.deleteAccount(userId);

    // Принудительно закрываем все активные WS-соединения удалённого пользователя
    const sockets = userSockets.get(userId);
    if (sockets) {
      for (const ws of sockets) {
        ws.close(4001, 'Account deleted');
      }
      userSockets.delete(userId);
    }

    ok(res, { message: 'Account deleted' });
  } catch (err) {
    next(err);
  }
}

export async function registerDeviceTokenHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const schema = z.object({
      token: z.string().min(1),
      platform: z.enum(['IOS', 'ANDROID', 'WEB']),
    });
    const { token, platform } = schema.parse(req.body);
    const result = await userService.registerDeviceToken(req.user!.sub, token, platform);
    ok(res, result, 201);
  } catch (err) {
    next(err);
  }
}

export async function removeDeviceTokenHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    await userService.removeDeviceToken(token, req.user!.sub);
    ok(res, { message: 'Device token removed' });
  } catch (err) {
    next(err);
  }
}

export async function getSettingsHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const settings = await userService.getSettings(req.user!.sub);
    ok(res, settings);
  } catch (err) { next(err); }
}

export async function updateSettingsHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const privacyEnum = z.enum(['all', 'contacts', 'nobody']);
    const schema = z.object({
      notifSound:        z.boolean().optional(),
      notifDesktop:      z.boolean().optional(),
      sendByEnter:       z.boolean().optional(),
      fontSize:          z.enum(['small', 'medium', 'large']).optional(),
      showOnlineStatus:  z.union([z.boolean(), privacyEnum]).optional(),
      showReadReceipts:  z.union([z.boolean(), privacyEnum]).optional(),
      showAvatar:        privacyEnum.optional(),
      allowGroupInvites: privacyEnum.optional(),
      mediaAutoDownload: z.boolean().optional(),
      chatWallpaper:     z.enum(['default', 'dark', 'dots', 'gradient']).optional(),
      locale:            z.enum(['ru', 'en']).optional(),
      autoDeleteMonths:  z.enum(['1', '3', '6', '12', 'never']).optional(),
    });
    const data = schema.parse(req.body);
    const settings = await userService.updateSettings(req.user!.sub, data);

    if (data.showOnlineStatus !== undefined) {
      const val = data.showOnlineStatus;
      const level = val === true ? 'all' : val === false ? 'nobody' : val;
      updateUserShowOnline(req.user!.sub, level as 'all' | 'contacts' | 'nobody');
    }

    const privacyKeys = ['showAvatar', 'showOnlineStatus', 'showReadReceipts', 'allowGroupInvites'];
    if (privacyKeys.some(k => (data as Record<string, unknown>)[k] !== undefined)) {
      broadcastUserUpdated(req.user!.sub, { id: req.user!.sub });
    }

    ok(res, settings);
  } catch (err) { next(err); }
}

export async function blockUserHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const blockedId = String(req.params.id);
    await userService.blockUser(req.user!.sub, blockedId);
    sendToUser(blockedId, { event: 'user:updated', payload: { id: req.user!.sub, blockedByThem: true } as any });
    ok(res, { blocked: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'Cannot block yourself') fail(res, err.message, 400);
    else next(err);
  }
}

export async function unblockUserHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const blockedId = String(req.params.id);
    await userService.unblockUser(req.user!.sub, blockedId);
    sendToUser(blockedId, { event: 'user:updated', payload: { id: req.user!.sub, blockedByThem: false } as any });
    ok(res, { blocked: false });
  } catch (err) { next(err); }
}

export async function getBlockedHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const full = req.query.full === '1';
    if (full) {
      const users = await userService.getBlockedUsers(req.user!.sub);
      ok(res, users);
    } else {
      const ids = await userService.getBlockedIds(req.user!.sub);
      ok(res, ids);
    }
  } catch (err) { next(err); }
}
