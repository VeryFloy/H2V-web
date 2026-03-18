import { prisma } from '../config/database';
import { isContact } from '../modules/contacts/contact.service';

export type PrivacyLevel = 'all' | 'contacts' | 'nobody';

export function resolvePrivacy(value: unknown, fallback: PrivacyLevel = 'all'): PrivacyLevel {
  if (value === true) return 'all';
  if (value === false) return 'nobody';
  if (value === 'all' || value === 'contacts' || value === 'nobody') return value;
  return fallback;
}

export async function getUserSettings(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  });
  return (user?.settings as Record<string, unknown>) ?? {};
}

export async function canSeePrivacy(
  targetUserId: string,
  viewerId: string,
  settingKey: string,
  fallback: PrivacyLevel = 'all',
): Promise<boolean> {
  if (targetUserId === viewerId) return true;
  const settings = await getUserSettings(targetUserId);
  const level = resolvePrivacy(settings[settingKey], fallback);
  if (level === 'all') return true;
  if (level === 'nobody') return false;
  return isContact(targetUserId, viewerId);
}

/**
 * Batch privacy check — single DB round-trip for N users instead of N queries.
 * Returns Set of userIds for whom viewerId is NOT allowed.
 */
export async function batchCheckPrivacy(
  userIds: string[],
  viewerId: string,
  settingKey: string,
  fallback: PrivacyLevel = 'all',
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const ids = userIds.filter((id) => id !== viewerId);
  if (ids.length === 0) return new Set();

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, settings: true },
  });

  const needsContactCheck: string[] = [];
  const rejected = new Set<string>();
  for (const u of users) {
    const s = u.settings as Record<string, unknown> | null;
    const level = resolvePrivacy(s?.[settingKey], fallback);
    if (level === 'all') continue;
    if (level === 'nobody') { rejected.add(u.id); continue; }
    needsContactCheck.push(u.id);
  }

  if (needsContactCheck.length > 0) {
    const contacts = await prisma.contact.findMany({
      where: { userId: { in: needsContactCheck }, contactId: viewerId },
      select: { userId: true },
    });
    const contactSet = new Set(contacts.map((c) => c.userId));
    for (const uid of needsContactCheck) {
      if (!contactSet.has(uid)) rejected.add(uid);
    }
  }

  return rejected;
}
