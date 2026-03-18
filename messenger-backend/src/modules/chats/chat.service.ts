import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { isBlocked } from '../users/user.service';
import { batchCheckPrivacy, resolvePrivacy } from '../../utils/privacy';

const MAX_GROUP_MEMBERS = 200;

const MEMBER_INCLUDE = {
  user: {
    select: { id: true, nickname: true, firstName: true, lastName: true, avatar: true, bio: true, isOnline: true, lastOnline: true, settings: true },
  },
};

function stripMemberSettings(members: any[]): any[] {
  return members.map(m => {
    const s = m.user?.settings as Record<string, unknown> | null;
    const onlineVal = s?.showOnlineStatus;
    const hide = onlineVal === false || onlineVal === 'nobody';
    const avatarVal = s?.showAvatar;
    const hideAvatar = avatarVal === 'nobody';
    const { settings: _s, ...userPub } = m.user ?? {};
    return {
      ...m,
      user: {
        ...userPub,
        avatar: hideAvatar ? null : userPub.avatar,
        isOnline: hide ? false : userPub.isOnline,
        lastOnline: hide ? null : userPub.lastOnline,
      },
    };
  });
}

async function stripMemberPrivacy(members: any[], viewerId: string): Promise<any[]> {
  // Collect IDs of members that use 'contacts' level for any privacy setting.
  // Settings are already loaded via MEMBER_INCLUDE (no extra DB query needed).
  const contactsCheckIds: string[] = [];
  for (const m of members) {
    if (!m.user || m.user.id === viewerId) continue;
    const s = m.user.settings as Record<string, unknown> | null;
    const onlineLevel = resolvePrivacy(s?.showOnlineStatus, 'all');
    const avatarLevel = resolvePrivacy(s?.showAvatar, 'all');
    if (onlineLevel === 'contacts' || avatarLevel === 'contacts') {
      contactsCheckIds.push(m.user.id);
    }
  }

  // ONE batch query: which of those members have viewerId in their contacts?
  // "member has viewerId as contact" = "member added viewerId" = Contact(userId=member, contactId=viewerId)
  let hasViewerAsContact = new Set<string>();
  if (contactsCheckIds.length > 0) {
    const rows = await prisma.contact.findMany({
      where: { userId: { in: contactsCheckIds }, contactId: viewerId },
      select: { userId: true },
    });
    hasViewerAsContact = new Set(rows.map((r) => r.userId));
  }

  // Synchronous map — no more per-member DB calls
  return members.map((m) => {
    const { settings: _s, ...userPub } = m.user ?? {};
    if (!m.user || m.user.id === viewerId) return { ...m, user: userPub };

    const s = m.user.settings as Record<string, unknown> | null;

    const onlineLevel = resolvePrivacy(s?.showOnlineStatus, 'all');
    const canOnline =
      onlineLevel === 'all' ||
      (onlineLevel === 'contacts' && hasViewerAsContact.has(m.user.id));

    const avatarLevel = resolvePrivacy(s?.showAvatar, 'all');
    const canAvatar =
      avatarLevel === 'all' ||
      (avatarLevel === 'contacts' && hasViewerAsContact.has(m.user.id));

    return {
      ...m,
      user: {
        ...userPub,
        avatar: canAvatar ? userPub.avatar : null,
        isOnline: canOnline ? userPub.isOnline : false,
        lastOnline: canOnline ? userPub.lastOnline : null,
      },
    };
  });
}

// ─── Создать личный чат (DIRECT) ─────────────────────────────────────────────
export async function getOrCreateSavedMessages(userId: string) {
  const existing = await prisma.chat.findFirst({
    where: {
      type: 'SELF',
      members: { some: { userId } },
    },
    include: { members: { include: MEMBER_INCLUDE } },
  });

  if (existing) return { ...existing, members: stripMemberSettings(existing.members) };

  const chat = await prisma.chat.create({
    data: {
      type: 'SELF',
      name: 'Saved Messages',
      members: {
        create: [{ userId, role: 'OWNER' }],
      },
    },
    include: { members: { include: MEMBER_INCLUDE } },
  });
  return { ...chat, members: stripMemberSettings(chat.members) };
}

export async function createDirectChat(
  initiatorId: string,
  targetUserId: string,
) {
  if (initiatorId === targetUserId) throw new Error('Cannot create chat with yourself');
  if (await isBlocked(targetUserId, initiatorId)) throw new Error('BLOCKED');

  return prisma.$transaction(async (tx) => {
    const existing = await tx.chat.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { userId: initiatorId } } },
          { members: { some: { userId: targetUserId } } },
        ],
      },
      include: { members: { include: MEMBER_INCLUDE } },
    });

    if (existing) return { ...existing, members: stripMemberSettings(existing.members) };

    const chat = await tx.chat.create({
      data: {
        type: 'DIRECT',
        members: {
          create: [
            { userId: initiatorId, role: 'OWNER' },
            { userId: targetUserId, role: 'MEMBER' },
          ],
        },
      },
      include: { members: { include: MEMBER_INCLUDE } },
    });
    return { ...chat, members: stripMemberSettings(chat.members) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// ─── Создать секретный чат (SECRET, E2E) ─────────────────────────────────────
// В отличие от DIRECT, позволяет создавать несколько секретных чатов между
// одними и теми же участниками (каждый — отдельная сессия шифрования).
export async function createSecretChat(
  initiatorId: string,
  targetUserId: string,
) {
  if (initiatorId === targetUserId) throw new Error('Cannot create chat with yourself');
  if (await isBlocked(targetUserId, initiatorId)) throw new Error('BLOCKED');
  const chat = await prisma.chat.create({
    data: {
      type: 'SECRET',
      members: {
        create: [
          { userId: initiatorId, role: 'OWNER' },
          { userId: targetUserId, role: 'MEMBER' },
        ],
      },
    },
    include: { members: { include: MEMBER_INCLUDE } },
  });
  return { ...chat, members: stripMemberSettings(chat.members) };
}

// ─── Создать групповой чат ────────────────────────────────────────────────────
export async function createGroupChat(
  ownerId: string,
  name: string,
  memberIds: string[],
) {
  const uniqueMembers = [...new Set([ownerId, ...memberIds])];

  if (uniqueMembers.length > MAX_GROUP_MEMBERS) {
    throw new Error(`GROUP_LIMIT_EXCEEDED:${MAX_GROUP_MEMBERS}`);
  }

  const othersToCheck = uniqueMembers.filter((uid) => uid !== ownerId);
  const rejected = await batchCheckPrivacy(othersToCheck, ownerId, 'allowGroupInvites', 'all');
  if (rejected.size > 0) {
    throw new Error(`PRIVACY_GROUP_INVITE:${[...rejected].join(',')}`);
  }

  const chat = await prisma.chat.create({
    data: {
      type: 'GROUP',
      name,
      members: {
        create: uniqueMembers.map((uid) => ({
          userId: uid,
          role: uid === ownerId ? 'OWNER' : 'MEMBER',
        })),
      },
    },
    include: { members: { include: MEMBER_INCLUDE } },
  });
  return { ...chat, members: stripMemberSettings(chat.members) };
}

const MAX_PINNED = 5;

export async function togglePinChat(chatId: string, userId: string, pinned: boolean) {
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  if (!member) throw new Error('Not a member of this chat');

  if (pinned && !member.pinnedAt) {
    const pinnedCount = await prisma.chatMember.count({
      where: { userId, pinnedAt: { not: null } },
    });
    if (pinnedCount >= MAX_PINNED) throw new Error('PIN_LIMIT');
  }

  const updated = await prisma.chatMember.update({
    where: { id: member.id },
    data: { pinnedAt: pinned ? new Date() : null },
  });
  return { chatId, pinned, pinnedAt: updated.pinnedAt };
}

// ─── Список чатов пользователя (cursor pagination) ───────────────────────────
export async function toggleArchiveChat(chatId: string, userId: string, archived: boolean) {
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  if (!member) throw new Error('Not a member of this chat');
  await prisma.chatMember.update({
    where: { id: member.id },
    data: { isArchived: archived },
  });
  return { chatId, archived };
}

export async function getUserChats(
  userId: string,
  cursor?: string,
  limit = 30,
  archived = false,
) {
  const chats = await prisma.chat.findMany({
    where: { members: { some: { userId, isArchived: archived } } },
    include: {
      members: { include: MEMBER_INCLUDE },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          text: true,
          ciphertext: true,
          signalType: true,
          type: true,
          isDeleted: true,
          createdAt: true,
          sender: { select: { id: true, nickname: true, firstName: true, lastName: true, avatar: true } },
        },
      },
      drafts: {
        where: { userId },
        take: 1,
        select: { text: true, replyToId: true, updatedAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  // Один агрегирующий SQL-запрос вместо N параллельных — устраняет N+1.
  const chatIds = chats.map((c) => c.id);
  let unreadMap = new Map<string, number>();

  if (chatIds.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ chat_id: string; cnt: bigint }>>(
      Prisma.sql`
        SELECT m.chat_id, COUNT(*)::int AS cnt
        FROM messages m
        WHERE m.chat_id = ANY(ARRAY[${Prisma.join(chatIds)}]::text[])
          AND m.sender_id != ${userId}
          AND m.is_deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM read_receipts rr
            WHERE rr.message_id = m.id AND rr.user_id = ${userId}
          )
        GROUP BY m.chat_id
      `,
    );
    unreadMap = new Map(rows.map((r) => [r.chat_id, Number(r.cnt)]));
  }

  const chatsWithUnread = await Promise.all(chats.map(async (c) => ({
    ...c,
    members: await stripMemberPrivacy(c.members, userId),
    unread: unreadMap.get(c.id) ?? 0,
    draft: c.drafts[0] ?? null,
    drafts: undefined,
  })));

  const nextCursor = chats.length === limit ? chats[chats.length - 1].id : null;
  return { chats: chatsWithUnread, nextCursor };
}

// ─── Получить чат по ID (с проверкой членства) ───────────────────────────────
export async function getChatById(chatId: string, userId: string) {
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      members: { some: { userId } },
    },
    include: { members: { include: MEMBER_INCLUDE } },
  });

  if (!chat) throw new Error('Chat not found or access denied');
  return { ...chat, members: await stripMemberPrivacy(chat.members, userId) };
}

// ─── Добавить участников ──────────────────────────────────────────────────────
export async function addMembers(chatId: string, requesterId: string, userIds: string[]) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, type: 'GROUP', members: { some: { userId: requesterId } } },
    include: { members: { select: { userId: true, role: true } } },
  });
  if (!chat) throw new Error('Chat not found or access denied');

  const requesterRole = chat.members.find(m => m.userId === requesterId)?.role;
  if (requesterRole !== 'OWNER' && requesterRole !== 'ADMIN') {
    throw new Error('Only OWNER or ADMIN can add members');
  }

  const existing = new Set(chat.members.map(m => m.userId));
  const toAdd = userIds.filter(id => !existing.has(id));

  const count = chat.members.length + toAdd.length;
  if (count > MAX_GROUP_MEMBERS) {
    throw new Error(`GROUP_LIMIT_EXCEEDED:${MAX_GROUP_MEMBERS}`);
  }

  const rejected = await batchCheckPrivacy(toAdd, requesterId, 'allowGroupInvites', 'all');
  if (rejected.size > 0) {
    throw new Error(`PRIVACY_GROUP_INVITE:${[...rejected].join(',')}`);
  }

  if (toAdd.length > 0) {
    await prisma.chatMember.createMany({
      data: toAdd.map(userId => ({ chatId, userId, role: 'MEMBER' as const })),
      skipDuplicates: true,
    });
  }

  return getChatById(chatId, requesterId);
}

// ─── Исключить участника ──────────────────────────────────────────────────────
export async function removeMember(chatId: string, requesterId: string, targetUserId: string) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, type: 'GROUP', members: { some: { userId: requesterId } } },
    include: { members: { select: { userId: true, role: true } } },
  });
  if (!chat) throw new Error('Chat not found or access denied');

  const requester = chat.members.find(m => m.userId === requesterId);
  const target = chat.members.find(m => m.userId === targetUserId);
  if (!requester || !target) throw new Error('Member not found');

  if (requester.role !== 'OWNER' && requester.role !== 'ADMIN') {
    throw new Error('Only OWNER or ADMIN can remove members');
  }
  if (target.role === 'OWNER') {
    throw new Error('Cannot remove the owner');
  }
  if (target.role === 'ADMIN' && requester.role !== 'OWNER') {
    throw new Error('Only OWNER can remove admins');
  }

  const { createSystemMessage } = await import('../messages/message.service');
  const systemMsg = await createSystemMessage(chatId, requesterId, 'member_kicked', targetUserId);
  await prisma.chatMember.deleteMany({ where: { chatId, userId: targetUserId } });

  const allMemberIds = chat.members.map(m => m.userId);
  return { allMemberIds, systemMessage: systemMsg };
}

// ─── Обновить чат (имя, аватар) ──────────────────────────────────────────────
export async function updateChat(chatId: string, requesterId: string, data: { name?: string; avatar?: string }) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, type: 'GROUP', members: { some: { userId: requesterId } } },
    include: { members: { select: { userId: true, role: true } } },
  });
  if (!chat) throw new Error('Chat not found or access denied');

  const requester = chat.members.find(m => m.userId === requesterId);
  if (requester?.role !== 'OWNER' && requester?.role !== 'ADMIN') {
    throw new Error('Only OWNER or ADMIN can update group');
  }

  const updated = await prisma.chat.update({
    where: { id: chatId },
    data: { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.avatar !== undefined ? { avatar: data.avatar } : {}) },
    include: { members: { include: MEMBER_INCLUDE } },
  });
  return { ...updated, members: stripMemberSettings(updated.members) };
}

// ─── Закрепить/открепить сообщение ────────────────────────────────────────────
export async function pinMessage(chatId: string, requesterId: string, messageId: string | null) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, members: { some: { userId: requesterId } } },
    include: { members: { select: { userId: true, role: true } } },
  });
  if (!chat) throw new Error('Chat not found or access denied');

  if (chat.type === 'GROUP') {
    const requester = chat.members.find(m => m.userId === requesterId);
    if (requester?.role !== 'OWNER' && requester?.role !== 'ADMIN') {
      throw new Error('Only OWNER or ADMIN can pin messages');
    }
  }

  if (messageId) {
    const msg = await prisma.message.findFirst({
      where: { id: messageId, chatId },
    });
    if (!msg) throw new Error('Message not found in this chat');
  }

  const updated = await prisma.chat.update({
    where: { id: chatId },
    data: { pinnedMessageId: messageId },
    include: { members: { include: MEMBER_INCLUDE } },
  });

  return { ...updated, members: stripMemberSettings(updated.members), allMemberIds: chat.members.map(m => m.userId) };
}

// ─── Покинуть чат ─────────────────────────────────────────────────────────────
export async function leaveChat(chatId: string, userId: string) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, members: { some: { userId } } },
    include: { members: { select: { userId: true, role: true }, orderBy: { joinedAt: 'asc' } } },
  });

  if (!chat) throw new Error('Chat not found or access denied');

  const allMemberIds = chat.members.map((m) => m.userId);

  if (chat.type === 'DIRECT' || chat.type === 'SECRET') {
    await prisma.chat.delete({ where: { id: chatId } });
    return { type: chat.type as 'DIRECT' | 'SECRET', allMemberIds };
  }

  const remaining = chat.members.filter((m) => m.userId !== userId);

  if (remaining.length === 0) {
    await prisma.chat.delete({ where: { id: chatId } });
    return { type: 'GROUP' as const, allMemberIds };
  }

  const leavingMember = chat.members.find((m) => m.userId === userId);

  const { createSystemMessage } = await import('../messages/message.service');
  const systemMsg = await createSystemMessage(chatId, userId, 'member_left');

  await prisma.$transaction(async (tx) => {
    if (leavingMember?.role === 'OWNER') {
      const newOwner = remaining[0];
      await tx.chatMember.update({
        where: { chatId_userId: { chatId, userId: newOwner.userId } },
        data: { role: 'OWNER' },
      });
    }
    await tx.chatMember.deleteMany({ where: { chatId, userId } });
  });

  return { type: 'GROUP' as const, allMemberIds, systemMessage: systemMsg };
}

// ─── Удалить группу (только OWNER) ────────────────────────────────────────────
export async function deleteGroup(chatId: string, userId: string) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, type: 'GROUP', members: { some: { userId, role: 'OWNER' } } },
    include: { members: { select: { userId: true } } },
  });

  if (!chat) throw new Error('Not found or not owner');

  const allMemberIds = chat.members.map((m) => m.userId);
  await prisma.chat.delete({ where: { id: chatId } });
  return { allMemberIds };
}

// ─── Черновики ────────────────────────────────────────────────────────────────
export async function upsertDraft(
  chatId: string,
  userId: string,
  text: string,
  replyToId?: string | null,
) {
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  if (!member) throw new Error('Not a member of this chat');

  const draft = await prisma.draft.upsert({
    where: { userId_chatId: { userId, chatId } },
    create: { userId, chatId, text, replyToId: replyToId ?? null },
    update: { text, replyToId: replyToId ?? null },
  });
  return draft;
}

export async function deleteDraft(chatId: string, userId: string) {
  await prisma.draft.deleteMany({
    where: { userId, chatId },
  });
}

// ─── Shared media for gallery ─────────────────────────────────────────────────
export async function getSharedMedia(
  chatId: string,
  userId: string,
  tab: 'media' | 'files' | 'links' | 'voice',
  cursor?: string,
  limit = 50,
) {
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  if (!member) throw new Error('Not a member of this chat');

  const typeFilter: Record<string, object> = {
    media: { type: { in: ['IMAGE', 'VIDEO'] } },
    files: { type: 'FILE' },
    voice: { type: 'AUDIO' },
    links: { text: { not: null }, type: 'TEXT' },
  };

  const where: any = {
    chatId,
    isDeleted: false,
    ...typeFilter[tab],
  };

  if (tab === 'links') {
    where.OR = [
      { text: { contains: 'http://', mode: 'insensitive' } },
      { text: { contains: 'https://', mode: 'insensitive' } },
    ];
  }

  const items = await prisma.message.findMany({
    where,
    select: {
      id: true,
      type: true,
      text: true,
      mediaUrl: true,
      mediaName: true,
      createdAt: true,
      sender: { select: { id: true, nickname: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const nextCursor = items.length === limit ? items[items.length - 1].id : null;
  return { items, nextCursor };
}
