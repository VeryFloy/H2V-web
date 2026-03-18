import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { presenceService, cacheService } from '../../config/redis';
import { decryptValue } from '../../utils/crypto';
import { isUserOnline } from '../../websocket/ws.server';
import { resolvePrivacy, canSeePrivacy } from '../../utils/privacy';

const PUBLIC_SELECT = {
  id: true,
  nickname: true,
  firstName: true,
  lastName: true,
  avatar: true,
  bio: true,
  lastOnline: true,
  isOnline: true,
};

const PRIVATE_SELECT = {
  ...PUBLIC_SELECT,
  email: true,
  settings: true,
};

// ─── Получить публичный профиль по ID ───────────────────────────────────────
export async function getById(userId: string, viewerId?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...PUBLIC_SELECT, settings: true },
  });

  if (!user) throw new Error('User not found');

  const s = user.settings as Record<string, unknown> | null;
  const onlineLevel = resolvePrivacy(s?.showOnlineStatus, 'all');
  const avatarLevel = resolvePrivacy(s?.showAvatar, 'all');
  const { settings: _s, ...pub } = user;

  let canSeeOnline = onlineLevel === 'all';
  let canSeeAvatar = avatarLevel === 'all';
  if (viewerId && viewerId !== userId) {
    canSeeOnline = await canSeePrivacy(userId, viewerId, 'showOnlineStatus', 'all');
    canSeeAvatar = await canSeePrivacy(userId, viewerId, 'showAvatar', 'all');
  }

  let online = false;
  let lastOnlineRedis: string | null = null;
  try {
    online = await presenceService.isOnline(userId);
    if (!online) lastOnlineRedis = await presenceService.getLastOnline(userId);
  } catch (err) { console.debug('[Redis] Presence fallback:', (err as Error).message); }

  let blockedByThem = false;
  if (viewerId && viewerId !== userId) {
    const block = await prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: viewerId } },
    });
    blockedByThem = !!block;
  }

  return {
    ...pub,
    avatar: canSeeAvatar ? pub.avatar : null,
    isOnline: canSeeOnline ? online : false,
    lastOnline: canSeeOnline ? (lastOnlineRedis ? new Date(lastOnlineRedis) : user.lastOnline) : null,
    blockedByThem,
  };
}

// ─── Получить полный профиль текущего пользователя (с email) ─────────────────
export async function getMyProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: PRIVATE_SELECT,
  });

  if (!user) throw new Error('User not found');

  let online = false;
  let lastOnlineRedis: string | null = null;
  try {
    online = await presenceService.isOnline(userId);
    if (!online) lastOnlineRedis = await presenceService.getLastOnline(userId);
  } catch (err) { console.debug('[Redis] Presence fallback:', (err as Error).message); }

  // Расшифровываем email для отображения в профиле
  let emailDecrypted: string | null = null;
  if (user.email) {
    try {
      emailDecrypted = decryptValue(user.email);
    } catch {
      emailDecrypted = null;
    }
  }

  return {
    ...user,
    email: emailDecrypted,
    isOnline: online,
    lastOnline: lastOnlineRedis ? new Date(lastOnlineRedis) : user.lastOnline,
  };
}

// ─── Поиск пользователей по nickname ─────────────────────────────────────────
export async function search(query: string, viewerId?: string, limit = 20) {
  const users = await prisma.user.findMany({
    where: {
      nickname: { contains: query, mode: 'insensitive' },
    },
    select: { ...PUBLIC_SELECT, settings: true },
    take: limit,
  });

  // Batch contact check: single query for all users needing "contacts" privacy level
  const needsContactCheck = viewerId
    ? users.filter((u) => {
        if (u.id === viewerId) return false;
        const s = u.settings as Record<string, unknown> | null;
        return resolvePrivacy(s?.showOnlineStatus, 'all') === 'contacts'
            || resolvePrivacy(s?.showAvatar, 'all') === 'contacts';
      }).map((u) => u.id)
    : [];

  const contactSet = new Set<string>();
  if (needsContactCheck.length > 0) {
    const rows = await prisma.contact.findMany({
      where: { userId: { in: needsContactCheck }, contactId: viewerId! },
      select: { userId: true },
    });
    for (const r of rows) contactSet.add(r.userId);
  }

  return users.map((u) => {
    const s = u.settings as Record<string, unknown> | null;
    const onlineLevel = resolvePrivacy(s?.showOnlineStatus, 'all');
    const avatarLevel = resolvePrivacy(s?.showAvatar, 'all');
    const { settings: _s, ...pub } = u;

    let canSeeOnline = onlineLevel === 'all';
    let canSeeAvatar = avatarLevel === 'all';
    if (viewerId && viewerId !== u.id) {
      if (onlineLevel === 'contacts') canSeeOnline = contactSet.has(u.id);
      if (avatarLevel === 'contacts') canSeeAvatar = contactSet.has(u.id);
    }

    return {
      ...pub,
      avatar: canSeeAvatar ? pub.avatar : null,
      isOnline: canSeeOnline ? isUserOnline(u.id) : false,
      lastOnline: canSeeOnline ? u.lastOnline : null,
    };
  });
}

// ─── Обновить профиль ────────────────────────────────────────────────────────
export async function updateProfile(
  userId: string,
  data: { nickname?: string; firstName?: string | null; lastName?: string | null; avatar?: string | null; bio?: string | null },
) {
  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: PUBLIC_SELECT,
    });
    await cacheService.invalidateProfile(userId);
    return updated;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      throw new Error('NICKNAME_TAKEN');
    }
    throw err;
  }
}

// ─── Удалить аккаунт (все данные через cascade) ───────────────────────────────
export async function deleteAccount(userId: string) {
  await prisma.user.delete({ where: { id: userId } });
  await cacheService.invalidateProfile(userId);
}

// ─── Зарегистрировать токен устройства для push-уведомлений ──────────────────
export async function registerDeviceToken(
  userId: string,
  token: string,
  platform: 'IOS' | 'ANDROID' | 'WEB',
) {
  await prisma.deviceToken.deleteMany({ where: { token, userId: { not: userId } } });
  return prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { platform },
    select: { id: true, token: true, platform: true, createdAt: true },
  });
}

// ─── Удалить токен устройства (при logout на конкретном устройстве) ───────────
export async function removeDeviceToken(token: string, userId: string) {
  await prisma.deviceToken.deleteMany({ where: { token, userId } });
}

// ─── Настройки пользователя ─────────────────────────────────────────────────
export async function getSettings(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  });
  return (user?.settings as Record<string, unknown>) ?? {};
}

export async function updateSettings(
  userId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const current = await getSettings(userId);
  const merged = { ...current, ...patch };
  await prisma.user.update({
    where: { id: userId },
    data: { settings: merged as Prisma.InputJsonValue },
  });
  await cacheService.invalidateProfile(userId);
  return merged;
}

// ─── Блокировка пользователей ────────────────────────────────────────────────
export async function blockUser(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) throw new Error('Cannot block yourself');
  return prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    update: {},
    create: { blockerId, blockedId },
  });
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
}

export async function getBlockedIds(userId: string): Promise<string[]> {
  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    select: { blockedId: true },
  });
  return blocks.map(b => b.blockedId);
}

export async function getBlockedUsers(userId: string) {
  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    include: {
      blocked: {
        select: { id: true, nickname: true, firstName: true, lastName: true, avatar: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return blocks.map(b => b.blocked);
}

export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const block = await prisma.userBlock.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });
  return !!block;
}
