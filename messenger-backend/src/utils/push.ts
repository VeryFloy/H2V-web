// @ts-expect-error no type declarations for web-push
import webPush from 'web-push';
import * as apn from 'node-apn';
import { prisma } from '../config/database';
import { isUserOnline } from '../websocket/ws.server';

// ─── Web Push (VAPID for PWA / browsers) ─────────────────────────────────────

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:donotreply@h2von.com';
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT || 3000}`;

let webPushEnabled = false;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  webPushEnabled = true;
  console.log('[Push] Web Push (VAPID) enabled');
} else {
  console.log('[Push] VAPID keys not configured — web push disabled');
}

export { VAPID_PUBLIC };

// ─── APNs (Apple Push Notification service for iOS) ──────────────────────────

const APNS_KEY_ID      = process.env.APNS_KEY_ID ?? '';
const APNS_TEAM_ID     = process.env.APNS_TEAM_ID ?? '';
const APNS_BUNDLE      = process.env.APNS_BUNDLE_ID ?? 'app.storm954.quinoa167';
const APNS_KEY_PATH    = process.env.APNS_KEY_PATH ?? '';
const APNS_KEY_CONTENT = process.env.APNS_KEY_CONTENT ?? '';

let apnsProvider: apn.Provider | null = null;

if (APNS_KEY_ID && APNS_TEAM_ID && (APNS_KEY_PATH || APNS_KEY_CONTENT)) {
  const tokenConfig: apn.ProviderToken = {
    key: APNS_KEY_PATH || Buffer.from(APNS_KEY_CONTENT, 'base64'),
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
  };
  apnsProvider = new apn.Provider({
    token: tokenConfig,
    production: process.env.NODE_ENV === 'production',
  });
  console.log(
    `[Push] APNs enabled (${process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'}) ` +
    `bundle=${APNS_BUNDLE}`,
  );
} else {
  console.log('[Push] APNs not configured — set APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH or APNS_KEY_CONTENT');
}

// ─── Shared payload interface ─────────────────────────────────────────────────

interface PushPayload {
  title: string;
  body: string;
  chatId: string;
  senderId?: string;
  avatar?: string | null;
}

// ─── Send push to all devices of a user ──────────────────────────────────────

export async function sendPushToUser(userId: string, data: PushPayload): Promise<void> {
  if (isUserOnline(userId)) return;

  const tokens = await prisma.deviceToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  const ios = tokens.filter(t => t.platform === 'IOS');
  const web = tokens.filter(t => t.platform === 'WEB');

  await Promise.allSettled([
    sendApnsToDevices(ios.map(t => t.token), data, userId),
    sendVapidToDevices(web.map(t => ({ id: t.id, token: t.token })), data),
  ]);
}

// ─── APNs sender ─────────────────────────────────────────────────────────────

async function sendApnsToDevices(deviceTokens: string[], data: PushPayload, userId: string): Promise<void> {
  if (!apnsProvider || deviceTokens.length === 0) return;

  // Query the real unread count so the iOS badge reflects actual unread messages.
  const unreadCount = await prisma.message.count({
    where: {
      chat: { members: { some: { userId } } },
      senderId: { not: userId },
      isDeleted: false,
      readReceipts: { none: { userId } },
    },
  }).catch(() => 1);

  const notification = new apn.Notification();
  notification.expiry           = Math.floor(Date.now() / 1000) + 3600;
  notification.badge            = Math.max(1, unreadCount);
  notification.sound            = 'default';
  notification.alert            = { title: data.title, body: data.body };
  notification.payload          = { chatId: data.chatId, senderId: data.senderId ?? '' };
  notification.topic            = APNS_BUNDLE;
  notification.pushType         = 'alert';
  notification.contentAvailable = true;

  const result = await apnsProvider.send(notification, deviceTokens);

  if (result.failed.length > 0) {
    const badTokens = result.failed
      .filter(f => {
        const reason = (f.response as any)?.reason;
        return reason === 'BadDeviceToken' || reason === 'Unregistered';
      })
      .map(f => f.device);

    if (badTokens.length > 0) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: badTokens } } }).catch(() => {});
    }

    console.log(`[APNs] ${result.sent.length}/${deviceTokens.length} sent, ${result.failed.length} failed`);
  }
}

// ─── Web Push (VAPID) sender ──────────────────────────────────────────────────

async function sendVapidToDevices(
  tokens: { id: string; token: string }[],
  data: PushPayload,
): Promise<void> {
  if (!webPushEnabled || tokens.length === 0) return;

  const avatarUrl = data.avatar
    ? (data.avatar.startsWith('http') ? data.avatar : `${BASE_URL}${data.avatar}`)
    : `${BASE_URL}/vite.svg`;

  const payload = JSON.stringify({
    title: data.title,
    body: data.body,
    data: { chatId: data.chatId, senderId: data.senderId },
    icon: avatarUrl,
  });

  await Promise.allSettled(
    tokens.map(t =>
      webPush.sendNotification(JSON.parse(t.token), payload).catch(async (err: any) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.deviceToken.delete({ where: { id: t.id } }).catch(() => {});
        }
        throw err;
      }),
    ),
  );
}
