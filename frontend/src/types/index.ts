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
}

export interface Reaction {
  id: string;
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
  sender: MessageSender;
  text: string | null;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'AUDIO' | 'VIDEO';
  mediaUrl: string | null;
  isDeleted: boolean;
  isEdited: boolean;
  replyToId: string | null;
  replyTo: ReplyTo | null;
  createdAt: string;
  updatedAt: string;
  readReceipts: ReadReceipt[];
  reactions: Reaction[];
  ciphertext: string | null;
  signalType: number | null;
  readBy?: string[];
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
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  avatar: string | null;
  createdAt: string;
  members: ChatMember[];
  lastMessage?: Message | null;
  unread?: number;
}

export type WsEvent =
  | { event: 'chat:new'; payload: Chat }
  | { event: 'message:new'; payload: Message }
  | { event: 'message:delivered'; payload: { messageId: string; chatId: string } }
  | { event: 'message:read'; payload: { messageId: string; readBy: string; chatId: string } }
  | { event: 'message:deleted'; payload: { messageId: string; chatId: string } }
  | { event: 'message:edited'; payload: Message }
  | { event: 'reaction:added'; payload: { reaction: Reaction; chatId: string; messageId: string } }
  | { event: 'reaction:removed'; payload: { messageId: string; userId: string; emoji: string; chatId: string } }
  | { event: 'typing:started'; payload: { chatId: string; userId: string; nickname: string } }
  | { event: 'typing:stopped'; payload: { chatId: string; userId: string } }
  | { event: 'user:online'; payload: { userId: string } }
  | { event: 'user:offline'; payload: { userId: string; lastOnline: string } }
  | { event: 'user:updated'; payload: Partial<User> & { id: string } }
  | { event: 'presence:snapshot'; payload: { onlineUserIds: string[] } }
  | { event: 'chat:deleted'; payload: { chatId: string } }
  | { event: 'error'; payload: { message: string } };
