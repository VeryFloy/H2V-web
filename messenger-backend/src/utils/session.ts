import crypto from 'crypto';
import { prisma } from '../config/database';

const SESSION_MAX_AGE_DAYS = parseInt(process.env.SESSION_MAX_AGE_DAYS || '90', 10);
const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 10;

async function resolveIpLocation(ip: string | null): Promise<string | null> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return null;
  try {
    const cleanIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const res = await fetch(`http://ip-api.com/json/${cleanIp}?fields=city,country`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { city?: string; country?: string };
    if (data.city && data.country) return `${data.city}, ${data.country}`;
    if (data.country) return data.country;
    return null;
  } catch {
    return null;
  }
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseDeviceName(ua: string | undefined): string {
  if (!ua) return 'Unknown device';

  let browser = 'Unknown';
  let os = 'Unknown';

  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) os = 'macOS';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return `${browser}, ${os}`;
}

function expiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_MAX_AGE_DAYS);
  return d;
}

export const SESSION_COOKIE_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  sub: string;
  nickname: string;
  sessionId: string;
}

export async function createSession(
  userId: string,
  nickname: string,
  req: { ip?: string; headers: { [key: string]: string | string[] | undefined } },
): Promise<{ token: string; session: { id: string } }> {
  const token = generateSessionToken();
  const tokenH = hashToken(token);
  const ua = (Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent']) ?? undefined;
  const deviceName = parseDeviceName(ua);
  const ip = req.ip ?? null;

  const existingCount = await prisma.session.count({ where: { userId } });
  if (existingCount >= MAX_SESSIONS_PER_USER) {
    const oldest = await prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: existingCount - MAX_SESSIONS_PER_USER + 1,
      select: { id: true },
    });
    await prisma.session.deleteMany({
      where: { id: { in: oldest.map((s) => s.id) } },
    });
  }

  const location = await resolveIpLocation(ip);

  const session = await prisma.session.create({
    data: {
      tokenHash: tokenH,
      userId,
      deviceName,
      ip,
      location,
      expiresAt: expiresAt(),
    },
  });

  return { token, session: { id: session.id } };
}

export async function validateSession(
  rawToken: string,
): Promise<(SessionPayload & { expiresAt: Date }) | null> {
  const tokenH = hashToken(rawToken);

  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenH },
    include: { user: { select: { id: true, nickname: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }

  // Sliding expiry: update lastActiveAt / expiresAt at most once per 5 min
  const sinceLastActive = Date.now() - session.lastActiveAt.getTime();
  if (sinceLastActive > ACTIVITY_DEBOUNCE_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date(), expiresAt: expiresAt() },
    }).catch(() => {});
  }

  return {
    sub: session.user.id,
    nickname: session.user.nickname,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}

export async function deleteSessionByToken(rawToken: string): Promise<string | null> {
  const tokenH = hashToken(rawToken);
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenH }, select: { id: true } });
  if (!session) return null;
  await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  return session.id;
}

export async function deleteOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, id: { not: currentSessionId } },
  });
  return count;
}

export async function getUserSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId },
    select: {
      id: true,
      deviceName: true,
      location: true,
      lastActiveAt: true,
      createdAt: true,
    },
    orderBy: { lastActiveAt: 'desc' },
  });
}
