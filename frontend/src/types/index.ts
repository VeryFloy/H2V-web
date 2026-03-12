export interface User {
  id: string;
  nickname: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  bio: string | null;
  email?: string | null;
  isOnline: boolean;
  lastOnline: string | null;
  blockedByThem?: boolean;
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  user?: { nickname: string };
}

export interface ReadReceipt {
  userId: string;
  readAt: string;
}

export interface MessageSender {
  id: string;
  nickname: string;
  firstName?: string | null;
  lastName?: string | null;
  avatar: string | null;
}

export interface ReplyTo {
  id: string;
  text: string | null;
  sender: MessageSender;
  isDeleted: boolean;
}

export interface Message {
  id: string;
  chatId: string;
  sender: MessageSender | null;
  text: string | null;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'AUDIO' | 'VIDEO';
  mediaUrl: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  isDeleted: boolean;
  isEdited: boolean;
  replyToId: string | null;
  replyTo: ReplyTo | null;
  forwardedFromId: string | null;
  forwardSenderName: string | null;
  createdAt: string;
  updatedAt: string;
  readReceipts: ReadReceipt[];
  voiceListens?: { userId: string }[];
  reactions: Reaction[];
  ciphertext: string | null;
  signalType: number | null;
  readBy?: string[];
  isDelivered?: boolean;
}

export interface ChatMember {
  id: string;
  userId: string;
  chatId: string;
  role: string;
  joinedAt: string;
  user: User;
}

export interface Chat {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'SECRET';
  name: string | null;
  avatar: string | null;
  pinnedMessageId?: string | null;
  createdAt: string;
  members: ChatMember[];
  lastMessage?: Message | null;
  unread?: number;
}

export interface ContactInfo {
  id: string;
  nickname: string;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  isOnline: boolean;
  lastOnline?: string | null;
  isMutual: boolean;
}

export interface MessageSearchResult {
  id: string;
  text: string | null;
  ciphertext: string | null;
  chatId: string;
  createdAt: string;
  sender: MessageSender | null;
  chat?: { id: string; name: string | null; type: 'DIRECT' | 'GROUP' | 'SECRET' };
}

export interface SharedMediaItem {
  id: string;
  type: 'IMAGE' | 'FILE' | 'AUDIO' | 'VIDEO';
  mediaUrl: string;
  mediaName: string | null;
  mediaSize: number | null;
  createdAt: string;
  sender: MessageSender | null;
}

export type PrivacyLevel = 'all' | 'contacts' | 'nobody';

// Events the CLIENT sends to the server
export type WsSendEvent =
  | { event: 'auth'; payload: { token: string } }
  | { event: 'presence:ping' }
  | { event: 'presence:away' }
  | { event: 'presence:back' }
  | { event: 'typing:start'; payload: { chatId: string } }
  | { event: 'typing:stop'; payload: { chatId: string } }
  | { event: 'message:read'; payload: { messageId: string; chatId: string } }
  | { event: 'message:listened'; payload: { messageId: string } }
  | { event: 'message:send'; payload: Record<string, unknown> };

export type WsEvent =
  | { event: 'chat:new'; payload: Chat }
  | { event: 'chat:updated'; payload: Chat }
  | { event: 'chat:deleted'; payload: { chatId: string } }
  | { event: 'chat:member-left'; payload: { chatId: string; userId: string } }
  | { event: 'message:new'; payload: Message }
  | { event: 'message:delivered'; payload: { messageId: string; chatId: string } }
  | { event: 'message:read'; payload: { messageId: string; readBy: string; chatId: string } }
  | { event: 'message:listened'; payload: { messageId: string; listenedBy: string; chatId: string } }
  | { event: 'message:deleted'; payload: { messageId: string; chatId: string; newLastMessage?: Message | null } }
  | { event: 'message:edited'; payload: Message }
  | { event: 'reaction:added'; payload: { reaction: Reaction; chatId: string; messageId: string } }
  | { event: 'reaction:removed'; payload: { messageId: string; userId: string; emoji: string; chatId: string } }
  | { event: 'typing:started'; payload: { chatId: string; userId: string; nickname: string } }
  | { event: 'typing:stopped'; payload: { chatId: string; userId: string } }
  | { event: 'user:online'; payload: { userId: string } }
  | { event: 'user:offline'; payload: { userId: string; lastOnline: string } }
  | { event: 'user:updated'; payload: Partial<User> & { id: string } }
  | { event: 'presence:snapshot'; payload: { onlineUserIds: string[] } }
  | { event: 'auth:ok'; payload: Record<string, never> }
  | { event: 'error'; payload: { message: string } };
