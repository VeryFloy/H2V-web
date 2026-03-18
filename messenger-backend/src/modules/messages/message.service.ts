import { prisma } from '../../config/database';
import { isBlocked } from '../users/user.service';
import { deleteFromS3, isS3Enabled } from '../../config/s3';
import { unlink } from 'fs/promises';
import { join } from 'path';

const MESSAGE_SELECT = {
  id: true,
  chatId: true,
  text: true,
  ciphertext: true,
  signalType: true,
  type: true,
  mediaUrl: true,
  mediaName: true,
  mediaSize: true,
  replyToId: true,
  forwardedFromId: true,
  forwardSenderName: true,
  mediaGroupId: true,
  isEdited: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
  sender: {
    select: { id: true, nickname: true, firstName: true, lastName: true, avatar: true },
  },
  readReceipts: {
    select: { userId: true, readAt: true },
  },
  reactions: {
    select: { id: true, userId: true, emoji: true },
  },
  replyTo: {
    select: {
      id: true,
      text: true,
      ciphertext: true,
      signalType: true,
      isDeleted: true,
      sender: { select: { id: true, nickname: true } },
    },
  },
};

// ─── Отправить сообщение ──────────────────────────────────────────────────────
export async function sendMessage(data: {
  chatId: string;
  senderId: string;
  text?: string;
  ciphertext?: string;
  signalType?: number;
  type?: 'TEXT' | 'IMAGE' | 'FILE' | 'AUDIO' | 'VIDEO';
  mediaUrl?: string;
  mediaName?: string;
  mediaSize?: number;
  replyToId?: string;
  forwardedFromId?: string;
  forwardSenderName?: string;
  mediaGroupId?: string;
}) {
  const chat = await prisma.chat.findUnique({
    where: { id: data.chatId },
    select: { type: true, members: { select: { userId: true } } },
  });

  if (!chat || !chat.members.some(m => m.userId === data.senderId)) {
    throw new Error('Not a member of this chat');
  }

  if (chat?.type === 'DIRECT' || chat?.type === 'SECRET') {
    const otherMember = chat.members.find(m => m.userId !== data.senderId);
    if (otherMember) {
      const blockedByThem = await isBlocked(otherMember.userId, data.senderId);
      const blockedByMe = await isBlocked(data.senderId, otherMember.userId);
      if (blockedByThem || blockedByMe) throw new Error('You are blocked by this user');
    }
  }

  if (chat?.type === 'SECRET') {
    if (data.text && !data.ciphertext && !data.mediaUrl) {
      throw new Error('Secret chat messages must be encrypted');
    }
    if (data.text && data.ciphertext) {
      data.text = undefined;
    }
  }

  if (data.forwardedFromId) {
    const originalMsg = await prisma.message.findUnique({
      where: { id: data.forwardedFromId },
      select: { chatId: true },
    });
    const canAccess = originalMsg
      ? await prisma.chatMember.findFirst({ where: { chatId: originalMsg.chatId, userId: data.senderId } })
      : null;
    if (!canAccess) data.forwardedFromId = undefined;
  }

  if (data.replyToId) {
    const replyMsg = await prisma.message.findUnique({
      where: { id: data.replyToId },
      select: { chatId: true },
    });
    if (!replyMsg || replyMsg.chatId !== data.chatId) {
      data.replyToId = undefined;
    }
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        chatId: data.chatId,
        senderId: data.senderId,
        text: data.text,
        ciphertext: data.ciphertext,
        signalType: data.signalType ?? 0,
        type: data.type ?? 'TEXT',
        mediaUrl: data.mediaUrl,
        mediaName: data.mediaName,
        mediaSize: data.mediaSize,
        replyToId: data.replyToId,
        forwardedFromId: data.forwardedFromId,
        forwardSenderName: data.forwardSenderName,
        mediaGroupId: data.mediaGroupId,
      },
      select: MESSAGE_SELECT,
    }),
    prisma.chat.update({
      where: { id: data.chatId },
      data: { updatedAt: new Date() },
    }),
  ]);

  return { ...message, voiceListens: [] };
}

// ─── Системное сообщение (member_left, member_joined, member_kicked) ───────────
export async function createSystemMessage(
  chatId: string,
  senderId: string,
  systemType: 'member_left' | 'member_joined' | 'member_kicked',
  targetUserId?: string,
) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        chatId,
        senderId,
        type: 'SYSTEM',
        text: targetUserId ? `${systemType}:${targetUserId}` : systemType,
      },
      select: MESSAGE_SELECT,
    }),
    prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    }),
  ]);
  return { ...message, voiceListens: [] };
}

// ─── Получить историю чата ────────────────────────────────────────────────────
export async function getChatMessages(
  chatId: string,
  userId: string,
  cursor?: string,
  limit = 50,
  query?: string,
  filters?: { from?: Date; to?: Date; senderId?: string; type?: string },
) {
  const isMember = await prisma.chatMember.findFirst({
    where: { chatId, userId },
  });

  if (!isMember) throw new Error('Not a member of this chat');

  const dateFilter: Record<string, Date> = {};
  if (filters?.from) dateFilter.gte = filters.from;
  if (filters?.to) dateFilter.lte = filters.to;

  const messages = await prisma.message.findMany({
    where: {
      chatId,
      isDeleted: false,
      hiddenBy: { none: { userId } },
      ...(query ? { text: { contains: query, mode: 'insensitive' } } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
      ...(filters?.senderId ? { senderId: filters.senderId } : {}),
      ...(filters?.type ? { type: filters.type as any } : {}),
    },
    select: MESSAGE_SELECT,
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const audioIds = messages.filter(m => m.type === 'AUDIO').map(m => m.id);
  let listenMap: Record<string, { userId: string }[]> = {};
  if (audioIds.length > 0) {
    const listens = await prisma.voiceListen.findMany({
      where: { messageId: { in: audioIds } },
      select: { messageId: true, userId: true },
    });
    for (const l of listens) {
      (listenMap[l.messageId] ??= []).push({ userId: l.userId });
    }
  }
  const enriched = messages.map(m => ({
    ...m,
    voiceListens: listenMap[m.id] ?? [],
  }));

  const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;
  return { messages: enriched, nextCursor };
}

// ─── Получить сообщения вокруг даты ("jump to date") ─────────────────────────
export async function getMessagesAroundDate(
  chatId: string,
  userId: string,
  date: Date,
  limit = 50,
) {
  const isMember = await prisma.chatMember.findFirst({ where: { chatId, userId } });
  if (!isMember) throw new Error('Not a member of this chat');

  const half = Math.ceil(limit / 2);
  const [before, after] = await Promise.all([
    prisma.message.findMany({
      where: { chatId, createdAt: { lte: date }, isDeleted: false, hiddenBy: { none: { userId } } },
      orderBy: { createdAt: 'desc' },
      take: half,
      select: MESSAGE_SELECT,
    }),
    prisma.message.findMany({
      where: { chatId, createdAt: { gt: date }, isDeleted: false, hiddenBy: { none: { userId } } },
      orderBy: { createdAt: 'asc' },
      take: half,
      select: MESSAGE_SELECT,
    }),
  ]);

  const messages = [...after.reverse(), ...before];

  const audioIds = messages.filter(m => m.type === 'AUDIO').map(m => m.id);
  let listenMap: Record<string, { userId: string }[]> = {};
  if (audioIds.length > 0) {
    const listens = await prisma.voiceListen.findMany({
      where: { messageId: { in: audioIds } },
      select: { messageId: true, userId: true },
    });
    for (const l of listens) {
      (listenMap[l.messageId] ??= []).push({ userId: l.userId });
    }
  }
  const enriched = messages.map(m => ({ ...m, voiceListens: listenMap[m.id] ?? [] }));
  return { messages: enriched, nextCursor: before.length === half ? before[before.length - 1].id : null };
}

// ─── Глобальный поиск по сообщениям ───────────────────────────────────────────
export async function searchMessages(userId: string, query: string, limit = 30) {
  if (!query.trim()) return [];

  const memberships = await prisma.chatMember.findMany({
    where: { userId },
    select: { chatId: true },
  });
  const chatIds = memberships.map(m => m.chatId);
  if (chatIds.length === 0) return [];

  const messages = await prisma.message.findMany({
    where: {
      chatId: { in: chatIds },
      isDeleted: false,
      text: { contains: query, mode: 'insensitive' },
    },
    select: {
      ...MESSAGE_SELECT,
      chat: { select: { id: true, name: true, type: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return messages.map(m => ({ ...m, voiceListens: [] as { userId: string }[] }));
}

// ─── Добавить реакцию ─────────────────────────────────────────────────────────
export async function addReaction(messageId: string, userId: string, emoji: string) {
  const ALLOWED = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  if (!ALLOWED.includes(emoji)) throw new Error('Invalid emoji');

  const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { chatId: true } });
  if (!msg) throw new Error('Message not found');

  const isMember = await prisma.chatMember.findFirst({ where: { chatId: msg.chatId, userId } });
  if (!isMember) throw new Error('Not a member of this chat');

  const reaction = await prisma.reaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
    create: { messageId, userId, emoji },
    update: {},
    select: { id: true, messageId: true, userId: true, emoji: true },
  });

  return { reaction, chatId: msg.chatId };
}

// ─── Убрать реакцию ──────────────────────────────────────────────────────────
export async function removeReaction(messageId: string, userId: string, emoji: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { chatId: true } });
  if (!msg) throw new Error('Message not found');

  const isMember = await prisma.chatMember.findFirst({ where: { chatId: msg.chatId, userId } });
  if (!isMember) throw new Error('Not a member of this chat');

  await prisma.reaction.deleteMany({ where: { messageId, userId, emoji } });
  return { chatId: msg.chatId };
}

// ─── Отметить как прочитанное ─────────────────────────────────────────────────
// Cascades: creates readReceipts for ALL unread messages up to and including
// the specified one, so the per-chat unread count drops to zero correctly.
export async function markAsRead(messageId: string, userId: string) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { chatId: true, senderId: true, createdAt: true },
  });
  if (!msg) throw new Error('Message not found');

  const isMember = await prisma.chatMember.findFirst({
    where: { chatId: msg.chatId, userId },
  });
  if (!isMember) throw new Error('Not a member of this chat');

  // Find all earlier messages in this chat that the user hasn't read yet
  const unread = await prisma.message.findMany({
    where: {
      chatId: msg.chatId,
      createdAt: { lte: msg.createdAt },
      senderId: { not: userId },
      isDeleted: false,
      readReceipts: { none: { userId } },
    },
    select: { id: true },
  });

  if (unread.length > 0) {
    const readAt = new Date();
    await prisma.readReceipt.createMany({
      data: unread.map((m) => ({ messageId: m.id, userId, readAt })),
      skipDuplicates: true,
    });
  }

  return { chatId: msg.chatId, senderId: msg.senderId, readAt: new Date() };
}

// ─── Удалить сообщение (hard delete) ─────────────────────────────────────────
// The replyTo FK has ON DELETE SET NULL so replies to this message are preserved
// (their replyToId becomes null). Reactions, ReadReceipts, VoiceListens cascade-delete.
export async function deleteMessage(messageId: string, userId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId } });

  if (!msg) throw new Error('Message not found');
  if (msg.senderId !== userId) throw new Error('Forbidden');

  await prisma.message.delete({ where: { id: messageId } });

  if (msg.mediaUrl) {
    deleteMediaFiles(msg.mediaUrl).catch(err =>
      console.warn('[Cleanup] File delete failed:', err.message));
  }

  // Find the new last message for this chat so clients can update the preview.
  const newLastMessage = await prisma.message.findFirst({
    where: { chatId: msg.chatId, isDeleted: false },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      chatId: true,
      text: true,
      ciphertext: true,
      signalType: true,
      type: true,
      isDeleted: true,
      createdAt: true,
      sender: { select: { id: true, nickname: true, firstName: true, lastName: true, avatar: true } },
    },
  });

  return { id: messageId, chatId: msg.chatId, newLastMessage: newLastMessage ?? null };
}

// ─── Редактировать сообщение ──────────────────────────────────────────────────
export async function editMessage(
  messageId: string,
  userId: string,
  text?: string,
  ciphertext?: string,
  signalType?: number,
) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    include: { chat: { select: { type: true } } },
  });

  if (!msg) throw new Error('Message not found');
  if (msg.senderId !== userId) throw new Error('Forbidden');
  if (msg.isDeleted) throw new Error('Message is deleted');

  const isSecret = msg.chat?.type === 'SECRET';

  if (isSecret && ciphertext) {
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { text: null, ciphertext, signalType: signalType ?? 3, isEdited: true },
      select: MESSAGE_SELECT,
    });
    return { ...updated, voiceListens: [] as { userId: string }[] };
  }

  if (isSecret && !ciphertext) {
    throw new Error('Secret chat messages must be encrypted');
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { text, isEdited: true, ciphertext: null, signalType: 0 },
    select: MESSAGE_SELECT,
  });
  return { ...updated, voiceListens: [] as { userId: string }[] };
}

// ─── Скрыть сообщение у себя ("удалить у себя") ──────────────────────────────
export async function hideMessage(messageId: string, userId: string) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { chatId: true },
  });
  if (!msg) throw new Error('Message not found');

  const isMember = await prisma.chatMember.findFirst({
    where: { chatId: msg.chatId, userId },
  });
  if (!isMember) throw new Error('Not a member of this chat');

  await prisma.messageHide.upsert({
    where: { userId_messageId: { userId, messageId } },
    create: { userId, messageId },
    update: {},
  });

  return { messageId, chatId: msg.chatId };
}

// ─── Отметить голосовое как прослушанное ──────────────────────────────────────
export async function markAsListened(messageId: string, userId: string) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { chatId: true, senderId: true, type: true },
  });
  if (!msg) throw new Error('Message not found');
  if (msg.type !== 'AUDIO') throw new Error('Not a voice message');

  const isMember = await prisma.chatMember.findFirst({
    where: { chatId: msg.chatId, userId },
  });
  if (!isMember) throw new Error('Not a member of this chat');

  await prisma.voiceListen.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId },
    update: {},
  });

  return { chatId: msg.chatId, senderId: msg.senderId };
}

// ─── Cleanup media files (disk + S3) ──────────────────────────────────────────
const UPLOAD_DIR = join(process.cwd(), 'uploads');
const THUMB_SUFFIXES = ['-thumb', '-medium'];

async function deleteMediaFiles(mediaUrl: string): Promise<void> {
  const filename = mediaUrl.startsWith('/uploads/')
    ? mediaUrl.slice('/uploads/'.length)
    : mediaUrl.startsWith('/') ? mediaUrl.slice(1) : mediaUrl;

  if (!filename) return;

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const base = ext ? filename.slice(0, -ext.length) : filename;
  const variants = [filename, ...THUMB_SUFFIXES.map(s => `${base}${s}${ext}`)];

  if (isS3Enabled()) {
    await Promise.all(variants.map(v => deleteFromS3(v)));
  } else {
    await Promise.all(variants.map(v =>
      unlink(join(UPLOAD_DIR, v)).catch(() => {}),
    ));
  }
}
