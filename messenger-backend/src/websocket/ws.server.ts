import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { validateSession } from '../utils/session';
import { presenceService } from '../config/redis';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { handleWsEvent } from './ws.handler';
import { WsServerEvent } from '../types';
import { resolvePrivacy } from '../utils/privacy';

import { cleanupTypingCache } from './events/typing.event';

// ─── Карта: userId → Set<WebSocket> (несколько вкладок одного юзера) ─────────
export const userSockets = new Map<string, Set<WebSocket>>();

// ─── Карта: WebSocket → userId ────────────────────────────────────────────────
export const socketUser = new Map<WebSocket, string>();

// ─── Карта: WebSocket → sessionId (для удалённого завершения сессий) ──────────
const socketSession = new WeakMap<WebSocket, string>();

// ─── Карта: userId → showOnlineStatus privacy level ─────────────────────────
type PrivacyLevel = 'all' | 'contacts' | 'nobody';
const userOnlinePrivacy = new Map<string, PrivacyLevel>();
const socketOnlinePrivacy = new WeakMap<WebSocket, PrivacyLevel>();

// ─── Rate limiter per socket ────────────────────────────────────────────────
const WS_RATE_WINDOW_MS = 10_000;
const WS_RATE_MAX_MESSAGES = 50;

const socketMessageTimestamps = new WeakMap<WebSocket, number[]>();

function checkRateLimit(ws: WebSocket): boolean {
  const now = Date.now();
  let timestamps = socketMessageTimestamps.get(ws);
  if (!timestamps) {
    timestamps = [];
    socketMessageTimestamps.set(ws, timestamps);
  }
  timestamps.push(now);
  const cutoff = now - WS_RATE_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
  return timestamps.length <= WS_RATE_MAX_MESSAGES;
}

// ─── Per-socket message queue (guarantees every message:send is processed) ──
const socketQueue = new WeakMap<WebSocket, Promise<void>>();
const socketQueueDepth = new WeakMap<WebSocket, number>();
const MAX_QUEUE_DEPTH = 20;

function enqueueMessage(ws: WebSocket, userId: string, data: unknown): void {
  const depth = socketQueueDepth.get(ws) ?? 0;
  if (depth >= MAX_QUEUE_DEPTH) {
    sendToSocket(ws, { event: 'error', payload: { message: 'Message queue full' } });
    return;
  }
  socketQueueDepth.set(ws, depth + 1);
  const prev = socketQueue.get(ws) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      await handleWsEvent(ws, userId, data);
    } catch (err) {
      console.error('[WS] Queued message:send error:', (err as Error).message);
      sendToSocket(ws, { event: 'error', payload: { message: 'Failed to send message' } });
    } finally {
      socketQueueDepth.set(ws, (socketQueueDepth.get(ws) ?? 1) - 1);
    }
  });
  socketQueue.set(ws, next);
}

// ─── Extract session token from cookie header ───────────────────────────────
function extractCookieToken(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const match = cookieHeader.split(';').find((c) => c.trim().startsWith('h2v_session='));
  return match ? decodeURIComponent(match.split('=')[1].trim()) : undefined;
}

function handleAuthedMessage(ws: WebSocket, userId: string, nickname: string, data: any): void {
  if (data.event === 'auth') return;

  if (!checkRateLimit(ws)) {
    sendToSocket(ws, { event: 'error', payload: { message: 'Rate limit exceeded' } });
    return;
  }

  if (data.event === 'message:send') {
    enqueueMessage(ws, userId, data);
    return;
  }

  handleWsEvent(ws, userId, data).catch((err) => {
    console.error(`[WS] Event handler error for ${nickname}:`, (err as Error).message);
    sendToSocket(ws, { event: 'error', payload: { message: 'Internal error' } });
  });
}

export function createWsServer(httpServer: Server): WebSocketServer {
  const MAX_SOCKETS_PER_USER = 10;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });

  // ── Native ping/pong to detect zombie connections ──────────────────────────
  const wsPingTimer = setInterval(() => {
    for (const client of wss.clients) {
      const c = client as WebSocket & { _isAlive?: boolean };
      if (c._isAlive === false) { c.terminate(); continue; }
      c._isAlive = false;
      c.ping();
    }
  }, 30_000);

  const cacheCleanupTimer = startChatPartnersCacheCleanup();

  wss.on('close', () => {
    clearInterval(wsPingTimer);
    clearInterval(cacheCleanupTimer);
    _chatPartnersCacheCleanupInterval = null;
    cleanupTypingCache();
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    (ws as any)._isAlive = true;
    ws.on('pong', () => { (ws as any)._isAlive = true; });

    let userId: string | null = null;
    let nickname: string | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let authed = false;

    // ── Try cookie-based auth first (web clients) ─────────────────────────
    const cookieToken = extractCookieToken(req);
    if (cookieToken) {
      const session = await validateSession(cookieToken).catch(() => null);
      if (session) {
        userId = session.sub;
        nickname = session.nickname;
        authed = true;
        socketSession.set(ws, session.sessionId);
        await finishAuth(ws, userId, nickname, MAX_SOCKETS_PER_USER);
        heartbeatInterval = startHeartbeat(ws, userId);
      }
    }

    // ── Auth timeout for non-cookie connections ─────────────────────────────
    const authTimeout = !authed ? setTimeout(() => {
      if (!userId) ws.close(4001, 'Auth timeout');
    }, 10_000) : null;

    // ── Message handler ─────────────────────────────────────────────────────
    ws.on('message', async (raw) => {
      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        sendToSocket(ws, { event: 'error', payload: { message: 'Bad JSON' } });
        return;
      }

      // Already authenticated — handle as normal event
      if (userId) {
        handleAuthedMessage(ws, userId, nickname!, data);
        return;
      }

      // Not yet authed — expect first message to be auth
      if (data.event !== 'auth' || !data.payload?.token) {
        ws.close(4001, 'First message must be auth');
        return;
      }

      try {
        const session = await validateSession(data.payload.token).catch(() => null);
        if (!session) {
          ws.close(4001, 'Invalid session');
          return;
        }

        if (authTimeout) clearTimeout(authTimeout);
        userId = session.sub;
        nickname = session.nickname;
        socketSession.set(ws, session.sessionId);
        await finishAuth(ws, userId, nickname, MAX_SOCKETS_PER_USER);
        heartbeatInterval = startHeartbeat(ws, userId);
      } catch (err) {
        console.error('[WS] Auth error:', (err as Error).message);
        ws.close(4001, 'Auth failed');
      }
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    ws.on('close', async () => {
      if (authTimeout) clearTimeout(authTimeout);
      if (heartbeatInterval) clearInterval(heartbeatInterval);

      if (userId) {
        const sockets = userSockets.get(userId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            userSockets.delete(userId);
            const level = socketOnlinePrivacy.get(ws) ?? 'all';
            userOnlinePrivacy.delete(userId);
            await presenceService.setOffline(userId);

            const now = new Date();
            await prisma.user.update({
              where: { id: userId },
              data: { isOnline: false, lastOnline: now },
            }).catch(err => console.warn('[WS] DB offline update failed:', err.message));

            if (level !== 'nobody') {
              await broadcastPresence(userId, 'user:offline', now.toISOString(), level);
            }
          }
        }
        socketUser.delete(ws);
        console.log(`[WS] Disconnected: ${nickname} (${userId})`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error for ${nickname ?? 'unauthenticated'}:`, err.message);
    });
  });

  return wss;
}

// ─── Shared post-auth setup ──────────────────────────────────────────────────
async function finishAuth(
  ws: WebSocket,
  userId: string,
  nickname: string,
  maxSockets: number,
): Promise<void> {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  const existingSockets = userSockets.get(userId)!;
  if (existingSockets.size >= maxSockets) {
    const oldest = existingSockets.values().next().value;
    if (oldest) { oldest.close(4002, 'Too many connections'); existingSockets.delete(oldest); }
  }
  existingSockets.add(ws);
  socketUser.set(ws, userId);

  sendToSocket(ws, { event: 'auth:ok' as any, payload: {} });

  let onlineLevel: PrivacyLevel = 'all';
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
    const s = u?.settings as Record<string, unknown> | null;
    onlineLevel = resolvePrivacy(s?.showOnlineStatus, 'all') as PrivacyLevel;
  } catch (err) { console.warn('[WS] Failed to fetch user settings:', (err as Error).message); }
  socketOnlinePrivacy.set(ws, onlineLevel);
  userOnlinePrivacy.set(userId, onlineLevel);

  await presenceService.setOnline(userId);
  await prisma.user.update({ where: { id: userId }, data: { isOnline: true } }).catch(err => console.warn('[WS] DB online update failed:', err.message));

  const partnerIds = await getChatPartnerIds(userId);
  const contactsLevelPartners: string[] = [];
  const alreadyOnline: string[] = [];

  for (const id of userSockets.keys()) {
    if (id === userId || !partnerIds.has(id)) continue;
    const pLevel = userOnlinePrivacy.get(id) ?? 'all';
    if (pLevel === 'nobody') continue;
    if (pLevel === 'contacts') { contactsLevelPartners.push(id); continue; }
    alreadyOnline.push(id);
  }

  if (contactsLevelPartners.length > 0) {
    const rows = await prisma.contact.findMany({
      where: { userId: { in: contactsLevelPartners }, contactId: userId },
      select: { userId: true },
    });
    const hasContact = new Set(rows.map(r => r.userId));
    for (const id of contactsLevelPartners) {
      if (hasContact.has(id)) alreadyOnline.push(id);
    }
  }

  sendToSocket(ws, { event: 'presence:snapshot', payload: { onlineUserIds: alreadyOnline } });

  if (onlineLevel !== 'nobody') {
    await broadcastPresence(userId, 'user:online', null);
  }

  deliverPendingMessages(userId).catch((err) =>
    console.warn('[WS] deliverPendingMessages error:', (err as Error).message),
  );

  console.log(`[WS] Connected: ${nickname} (${userId})`);
}

function startHeartbeat(ws: WebSocket, userId: string): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    if (ws.readyState === WebSocket.OPEN && userId && !socketAway.get(ws)) {
      await presenceService.heartbeat(userId);
    }
  }, 30_000);
}

// ─── Close all sockets for a specific session (remote termination) ──────────
export function closeSessionSockets(sessionId: string): void {
  for (const [ws] of socketUser) {
    if (socketSession.get(ws) === sessionId) {
      ws.close(4003, 'Session terminated');
    }
  }
}

// ─── Close all sockets except a given session (terminate all other) ─────────
export function closeOtherSessionSockets(userId: string, keepSessionId: string): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    if (socketSession.get(ws) !== keepSessionId) {
      ws.close(4003, 'Session terminated');
    }
  }
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

export function sendToSocket<T>(ws: WebSocket, event: WsServerEvent<T>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

export function sendToUser<T>(userId: string, event: WsServerEvent<T>): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export function sendToUsers<T>(
  userIds: string[],
  event: WsServerEvent<T>,
  excludeUserId?: string,
): void {
  const payload = JSON.stringify(event);
  for (const uid of userIds) {
    if (uid === excludeUserId) continue;
    const sockets = userSockets.get(uid);
    if (!sockets) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

// ─── Cache: userId → Set of chat-partner userIds (TTL-based) ────────────────
const chatPartnersCache = new Map<string, { ids: Set<string>; expiresAt: number }>();
const PARTNERS_CACHE_TTL_MS = 60_000;

let _chatPartnersCacheCleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startChatPartnersCacheCleanup(): ReturnType<typeof setInterval> {
  if (_chatPartnersCacheCleanupInterval) return _chatPartnersCacheCleanupInterval;
  _chatPartnersCacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, val] of chatPartnersCache) {
      if (val.expiresAt < now) chatPartnersCache.delete(key);
    }
  }, 5 * 60_000);
  return _chatPartnersCacheCleanupInterval;
}

async function getChatPartnerIds(userId: string): Promise<Set<string>> {
  const cached = chatPartnersCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;

  const members = await prisma.chatMember.findMany({
    where: { chat: { members: { some: { userId } } }, userId: { not: userId } },
    select: { userId: true },
    distinct: ['userId'],
  }).catch(() => [] as { userId: string }[]);

  const ids = new Set(members.map(m => m.userId));
  chatPartnersCache.set(userId, { ids, expiresAt: Date.now() + PARTNERS_CACHE_TTL_MS });
  return ids;
}

export function invalidatePartnersCache(userId: string): void {
  chatPartnersCache.delete(userId);
}

async function broadcastPresence(
  userId: string,
  eventType: 'user:online' | 'user:offline',
  lastOnline: string | null,
  levelOverride?: PrivacyLevel,
): Promise<void> {
  const level = levelOverride ?? userOnlinePrivacy.get(userId) ?? 'all';
  if (level === 'nobody') return;

  const partnerIds = await getChatPartnerIds(userId);

  let userContactIds: Set<string> | null = null;
  if (level === 'contacts') {
    const rows = await prisma.contact.findMany({
      where: { userId },
      select: { contactId: true },
    }).catch(() => [] as { contactId: string }[]);
    userContactIds = new Set(rows.map((r) => r.contactId));
  }

  const event = JSON.stringify({
    event: eventType,
    payload: { userId, lastOnline },
  });

  for (const [uid, sockets] of userSockets) {
    if (!partnerIds.has(uid)) continue;
    if (level === 'contacts' && !userContactIds!.has(uid)) continue;

    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(event);
      }
    }
  }
}

export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId);
  return !!sockets && sockets.size > 0;
}

// ─── Away-state per socket ──────────────────────────────────────────────────
const socketAway = new WeakMap<WebSocket, boolean>();

function isUserFullyAway(userId: string): boolean {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return true;
  for (const s of sockets) {
    if (!socketAway.get(s) && s.readyState === WebSocket.OPEN) return false;
  }
  return true;
}

export async function handlePresenceAway(ws: WebSocket, userId: string): Promise<void> {
  socketAway.set(ws, true);
  if (isUserFullyAway(userId)) {
    const now = new Date();
    await presenceService.setOffline(userId);
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: false, lastOnline: now },
    }).catch(err => console.warn('[WS] DB away-offline update failed:', err.message));

    const level = userOnlinePrivacy.get(userId) ?? 'all';
    if (level !== 'nobody') {
      await broadcastPresence(userId, 'user:offline', now.toISOString());
    }
  }
}

export async function handlePresenceBack(ws: WebSocket, userId: string): Promise<void> {
  const wasFully = isUserFullyAway(userId);
  socketAway.set(ws, false);
  if (wasFully) {
    await presenceService.setOnline(userId);
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: true },
    }).catch(err => console.warn('[WS] DB back-online update failed:', err.message));

    const level = userOnlinePrivacy.get(userId) ?? 'all';
    if (level !== 'nobody') {
      await broadcastPresence(userId, 'user:online', null);
    }
  }
  await presenceService.heartbeat(userId);
}

export async function updateUserShowOnline(userId: string, newLevel: PrivacyLevel): Promise<void> {
  const prevLevel = userOnlinePrivacy.get(userId) ?? 'all';
  userOnlinePrivacy.set(userId, newLevel);

  const sockets = userSockets.get(userId);
  if (sockets) {
    for (const ws of sockets) {
      socketOnlinePrivacy.set(ws, newLevel);
    }
  }

  if (!isUserOnline(userId)) return;
  if (prevLevel === newLevel) return;

  if (newLevel === 'nobody') {
    const fakeOffline = JSON.stringify({
      event: 'user:offline',
      payload: { userId, lastOnline: new Date().toISOString() },
    });
    const partnerIds = await getChatPartnerIds(userId);
    for (const [uid, uSockets] of userSockets) {
      if (!partnerIds.has(uid)) continue;
      for (const ws of uSockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(fakeOffline);
      }
    }
  } else {
    await broadcastPresence(userId, 'user:online', null);
  }
}

export async function broadcastUserUpdated(userId: string, patch: Record<string, unknown>): Promise<void> {
  const event = JSON.stringify({ event: 'user:updated', payload: { id: userId, ...patch } });

  const partnerIds = await getChatPartnerIds(userId);
  const recipientIds = new Set([userId, ...partnerIds]);

  for (const [uid, sockets] of userSockets) {
    if (!recipientIds.has(uid)) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(event);
      }
    }
  }
}

async function deliverPendingMessages(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastOnline: true },
  });
  if (!user?.lastOnline) return;

  const chatIds = (
    await prisma.chatMember.findMany({
      where: { userId },
      select: { chatId: true },
    })
  ).map((m) => m.chatId);

  if (chatIds.length === 0) return;

  const rows = await prisma.$queryRaw<
    Array<{ chat_id: string; sender_id: string; msg_id: string }>
  >(Prisma.sql`
    SELECT DISTINCT ON (m.chat_id, m.sender_id)
           m.chat_id, m.sender_id, m.id AS msg_id
    FROM messages m
    WHERE m.chat_id = ANY(ARRAY[${Prisma.join(chatIds)}]::text[])
      AND m.sender_id != ${userId}
      AND m.is_deleted = false
      AND m.created_at > ${user.lastOnline}
    ORDER BY m.chat_id, m.sender_id, m.created_at DESC
  `);

  for (const row of rows) {
    sendToUser(row.sender_id, {
      event: 'message:delivered',
      payload: { messageId: row.msg_id, chatId: row.chat_id },
    });
  }

  if (rows.length > 0) {
    console.log(`[WS] Delivered ${rows.length} pending message(s) for ${userId}`);
  }
}
