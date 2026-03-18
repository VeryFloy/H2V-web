import { Request } from 'express';
import { User } from '@prisma/client';
import { SessionPayload } from '../utils/session';

// ─── Расширение Express Request ───────────────────────────────────────────────
export interface AuthRequest extends Request {
  user?: SessionPayload;
}

// ─── WebSocket events (клиент → сервер) ──────────────────────────────────────
export type WsEventType =
  | 'message:send'
  | 'message:read'
  | 'message:listened'
  | 'typing:start'
  | 'typing:stop'
  | 'presence:ping';

export interface WsBaseEvent {
  event: WsEventType;
}

export interface WsMessageSendEvent extends WsBaseEvent {
  event: 'message:send';
  payload: {
    chatId: string;
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
  };
}

export interface WsMessageReadEvent extends WsBaseEvent {
  event: 'message:read';
  payload: { messageId: string; chatId: string };
}

export interface WsMessageListenedEvent extends WsBaseEvent {
  event: 'message:listened';
  payload: { messageId: string };
}

export interface WsTypingEvent extends WsBaseEvent {
  event: 'typing:start' | 'typing:stop';
  payload: { chatId: string };
}

export interface WsPresencePingEvent extends WsBaseEvent {
  event: 'presence:ping';
}

export type WsIncomingEvent =
  | WsMessageSendEvent
  | WsMessageReadEvent
  | WsTypingEvent
  | WsPresencePingEvent;

// ─── WebSocket events (сервер → клиент) ──────────────────────────────────────
export type WsServerEventType =
  | 'message:new'
  | 'message:delivered'
  | 'message:read'
  | 'message:listened'
  | 'message:deleted'
  | 'message:edited'
  | 'reaction:added'
  | 'reaction:removed'
  | 'typing:started'
  | 'typing:stopped'
  | 'user:online'
  | 'user:offline'
  | 'presence:snapshot'
  | 'user:updated'
  | 'chat:new'
  | 'chat:updated'
  | 'chat:deleted'
  | 'chat:member-left'
  | 'draft:updated'
  | 'error';

export interface WsServerEvent<T = unknown> {
  event: WsServerEventType;
  payload: T;
}

// ─── DTO shapes ──────────────────────────────────────────────────────────────
export type PublicUser = Pick<
  User,
  'id' | 'nickname' | 'avatar' | 'bio' | 'lastOnline' | 'isOnline'
>;
