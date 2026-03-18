import { WebSocket } from 'ws';
import { sendMessage, markAsRead, markAsListened } from '../../modules/messages/message.service';
import { sendToSocket, sendToUsers, isUserOnline, sendToUser } from '../ws.server';
import { prisma } from '../../config/database';
import { WsMessageSendEvent, WsMessageReadEvent, WsMessageListenedEvent } from '../../types';
import { sendPushToUser } from '../../utils/push';
import { canSeePrivacy } from '../../utils/privacy';

// ─── Отправка сообщения через WS ─────────────────────────────────────────────
export async function handleMessageSend(
  ws: WebSocket,
  userId: string,
  payload: WsMessageSendEvent['payload'],
): Promise<void> {
  const MAX_MSG_LENGTH = 10_000;
  const content = payload.ciphertext || payload.text || '';
  if (content.length > MAX_MSG_LENGTH) {
    sendToSocket(ws, { event: 'error', payload: { message: 'Message too long' } });
    return;
  }

  try {
    const message = await sendMessage({
      chatId: payload.chatId,
      senderId: userId,
      text: payload.text,
      ciphertext: payload.ciphertext,
      signalType: payload.signalType ?? 0,
      type: payload.type ?? 'TEXT',
      mediaUrl: payload.mediaUrl,
      mediaName: payload.mediaName,
      mediaSize: payload.mediaSize,
      replyToId: payload.replyToId,
      forwardedFromId: payload.forwardedFromId,
      forwardSenderName: payload.forwardSenderName,
      mediaGroupId: payload.mediaGroupId,
    });

    const members = await prisma.chatMember.findMany({
      where: { chatId: payload.chatId },
      select: { userId: true },
    });

    const memberIds = members.map((m) => m.userId);

    // Разослать message:new всем участникам
    sendToUsers(memberIds, { event: 'message:new', payload: message });

    // Проверить кто из получателей онлайн → отправить delivered отправителю
    const onlineRecipients = memberIds.filter(
      (id) => id !== userId && isUserOnline(id),
    );

    if (onlineRecipients.length > 0) {
      sendToUser(userId, {
        event: 'message:delivered',
        payload: {
          messageId: message.id,
          chatId: payload.chatId,
        },
      });
    }

    const offlineRecipients = memberIds.filter(id => id !== userId && !isUserOnline(id));
    if (offlineRecipients.length > 0) {
      const senderName = message.sender?.nickname ?? message.sender?.firstName ?? 'User';
      const bodyRaw = message.text ?? (message.ciphertext ? '🔒' : '[media]');
      const bodyChars = [...bodyRaw];
      const body = bodyChars.length > 100 ? bodyChars.slice(0, 100).join('') + '...' : bodyRaw;
      for (const recipientId of offlineRecipients) {
        sendPushToUser(recipientId, {
          title: senderName,
          body,
          chatId: payload.chatId,
          senderId: userId,
          avatar: message.sender?.avatar,
        }).catch(err => console.warn('[Push] Failed for', recipientId, err.message));
      }
    }
  } catch (err) {
    sendToSocket(ws, {
      event: 'error',
      payload: {
        message: err instanceof Error ? err.message : 'Failed to send message',
      },
    });
  }
}

// ─── Прочитать сообщение ──────────────────────────────────────────────────────
export async function handleMessageRead(
  ws: WebSocket,
  userId: string,
  payload: WsMessageReadEvent['payload'],
): Promise<void> {
  try {
    const { chatId, senderId } = await markAsRead(payload.messageId, userId);

    // Respect the reader's showReadReceipts privacy setting.
    const canSeeRead = await canSeePrivacy(userId, senderId, 'showReadReceipts', 'all');
    if (!canSeeRead) return;

    // Broadcast to ALL chat members so group read receipts are visible to
    // everyone, not only the original message sender.
    const members = await prisma.chatMember.findMany({
      where: { chatId },
      select: { userId: true },
    });
    const memberIds = members.map((m) => m.userId);

    sendToUsers(memberIds, {
      event: 'message:read',
      payload: {
        messageId: payload.messageId,
        chatId,
        readBy: userId,
      },
    });
  } catch (err) {
    sendToSocket(ws, {
      event: 'error',
      payload: { message: 'Failed to mark as read' },
    });
  }
}

// ─── Отметить голосовое как прослушанное ──────────────────────────────────────
export async function handleMessageListened(
  ws: WebSocket,
  userId: string,
  payload: WsMessageListenedEvent['payload'],
): Promise<void> {
  try {
    const { chatId, senderId } = await markAsListened(payload.messageId, userId);

    const members = await prisma.chatMember.findMany({
      where: { chatId },
      select: { userId: true },
    });
    const memberIds = members.map((m) => m.userId);

    sendToUsers(memberIds, {
      event: 'message:listened',
      payload: {
        messageId: payload.messageId,
        chatId,
        listenedBy: userId,
      },
    });
  } catch (err) {
    sendToSocket(ws, {
      event: 'error',
      payload: { message: 'Failed to mark as listened' },
    });
  }
}
