import { WebSocket } from 'ws';
import { handleMessageSend, handleMessageRead, handleMessageListened } from './events/message.event';
import { handleTypingStart, handleTypingStop } from './events/typing.event';
import { presenceService } from '../config/redis';
import { sendToSocket, handlePresenceAway, handlePresenceBack } from './ws.server';

export async function handleWsEvent(
  ws: WebSocket,
  userId: string,
  data: unknown,
): Promise<void> {
  if (!data || typeof data !== 'object' || !('event' in data)) {
    sendToSocket(ws, { event: 'error', payload: { message: 'Missing event field' } });
    return;
  }

  const { event, payload } = data as { event: string; payload?: unknown };

  switch (event) {
    case 'message:send': {
      const p = payload as Record<string, unknown> | undefined;
      if (!p || typeof p.chatId !== 'string') {
        sendToSocket(ws, { event: 'error', payload: { message: 'message:send requires chatId' } });
        return;
      }
      await handleMessageSend(ws, userId, p as any);
      break;
    }

    case 'message:read': {
      const p = payload as Record<string, unknown> | undefined;
      if (!p || typeof p.messageId !== 'string') {
        sendToSocket(ws, { event: 'error', payload: { message: 'message:read requires messageId' } });
        return;
      }
      await handleMessageRead(ws, userId, p as any);
      break;
    }

    case 'message:listened': {
      const p = payload as Record<string, unknown> | undefined;
      if (!p || typeof p.messageId !== 'string') {
        sendToSocket(ws, { event: 'error', payload: { message: 'message:listened requires messageId' } });
        return;
      }
      await handleMessageListened(ws, userId, p as any);
      break;
    }

    case 'typing:start': {
      const p = payload as Record<string, unknown> | undefined;
      if (!p || typeof p.chatId !== 'string') return;
      await handleTypingStart(userId, p.chatId as string);
      break;
    }

    case 'typing:stop': {
      const p = payload as Record<string, unknown> | undefined;
      if (!p || typeof p.chatId !== 'string') return;
      await handleTypingStop(userId, p.chatId as string);
      break;
    }

    case 'presence:ping':
      await presenceService.heartbeat(userId);
      break;

    case 'presence:away':
      await handlePresenceAway(ws, userId);
      break;

    case 'presence:back':
      await handlePresenceBack(ws, userId);
      break;

    default:
      sendToSocket(ws, {
        event: 'error',
        payload: { message: `Unknown event: ${String(event)}` },
      });
  }
}
