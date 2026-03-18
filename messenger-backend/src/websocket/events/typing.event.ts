import { prisma } from '../../config/database';
import { presenceService } from '../../config/redis';
import { sendToUsers } from '../ws.server';

const chatMembersCache = new Map<string, { ids: Set<string>; expiresAt: number }>();
const MEMBERS_CACHE_TTL = 30_000;

let _cleanupInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of chatMembersCache) {
    if (val.expiresAt < now) chatMembersCache.delete(key);
  }
}, 5 * 60_000);

export function cleanupTypingCache(): void {
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
}

async function getChatMemberIds(chatId: string): Promise<Set<string>> {
  const cached = chatMembersCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;

  const members = await prisma.chatMember.findMany({
    where: { chatId },
    select: { userId: true },
  });
  const ids = new Set(members.map((m) => m.userId));
  chatMembersCache.set(chatId, { ids, expiresAt: Date.now() + MEMBERS_CACHE_TTL });
  return ids;
}

export async function handleTypingStart(
  userId: string,
  chatId: string,
): Promise<void> {
  const memberIds = await getChatMemberIds(chatId);
  if (!memberIds.has(userId)) return;

  await presenceService.setTyping(chatId, userId);

  sendToUsers([...memberIds], {
    event: 'typing:started',
    payload: { chatId, userId },
  }, userId);
}

export async function handleTypingStop(
  userId: string,
  chatId: string,
): Promise<void> {
  const memberIds = await getChatMemberIds(chatId);
  if (!memberIds.has(userId)) return;

  await presenceService.clearTyping(chatId, userId);

  sendToUsers([...memberIds], {
    event: 'typing:stopped',
    payload: { chatId, userId },
  }, userId);
}
