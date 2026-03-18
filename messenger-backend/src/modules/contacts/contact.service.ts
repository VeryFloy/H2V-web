import { prisma } from '../../config/database';
import { isUserOnline } from '../../websocket/ws.server';
import { resolvePrivacy } from '../../utils/privacy';

export async function addContact(userId: string, contactId: string) {
  if (userId === contactId) throw new Error('CANNOT_ADD_SELF');

  const target = await prisma.user.findUnique({ where: { id: contactId }, select: { id: true } });
  if (!target) throw new Error('USER_NOT_FOUND');

  return prisma.contact.upsert({
    where: { userId_contactId: { userId, contactId } },
    update: {},
    create: { userId, contactId },
  });
}

export async function removeContact(userId: string, contactId: string) {
  await prisma.contact.deleteMany({ where: { userId, contactId } });
}

export async function getContacts(userId: string) {
  const rows = await prisma.contact.findMany({
    where: { userId },
    include: {
      contact: {
        select: {
          id: true, nickname: true, firstName: true, lastName: true,
          avatar: true, isOnline: true, lastOnline: true, settings: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const contactIds = rows.map(r => r.contactId);
  const mutualSet = new Set<string>();
  if (contactIds.length > 0) {
    const reverses = await prisma.contact.findMany({
      where: { userId: { in: contactIds }, contactId: userId },
      select: { userId: true },
    });
    for (const r of reverses) mutualSet.add(r.userId);
  }

  return rows.map(r => {
    const s = r.contact.settings as Record<string, unknown> | null;
    const hideOnline = resolvePrivacy(s?.showOnlineStatus, 'all') === 'nobody';
    const { settings: _s, ...pub } = r.contact;
    return {
      ...pub,
      isOnline: hideOnline ? false : isUserOnline(r.contactId),
      lastOnline: hideOnline ? null : pub.lastOnline,
      isMutual: mutualSet.has(r.contactId),
    };
  });
}

export async function isContact(userId: string, contactId: string): Promise<boolean> {
  const row = await prisma.contact.findUnique({
    where: { userId_contactId: { userId, contactId } },
    select: { id: true },
  });
  return !!row;
}

export async function isMutualContact(userId: string, otherUserId: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    isContact(userId, otherUserId),
    isContact(otherUserId, userId),
  ]);
  return a && b;
}

export async function checkContact(userId: string, contactId: string) {
  const [mine, theirs] = await Promise.all([
    isContact(userId, contactId),
    isContact(contactId, userId),
  ]);
  return { isContact: mine, isMutual: mine && theirs };
}
