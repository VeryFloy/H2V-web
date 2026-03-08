import { createSignal, createMemo } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { api } from '../api/client';
import type { Chat, Message, User, Reaction } from '../types';

type RawChat = Omit<Chat, 'lastMessage'> & { messages?: Message[]; lastMessage?: Message | null };

const ACTIVE_CHAT_KEY = 'h2v_activeChatId';

const [chats, setChats] = createStore<Chat[]>([]);
const [activeChatId, _setActiveChatId] = createSignal<string | null>(null);
const activeChat = createMemo(() => chats.find((c) => c.id === activeChatId()) ?? null);

function setActiveChatId(id: string | null) {
  _setActiveChatId(id);
  if (id) localStorage.setItem(ACTIVE_CHAT_KEY, id);
  else localStorage.removeItem(ACTIVE_CHAT_KEY);
}

function getSavedChatId(): string | null {
  return localStorage.getItem(ACTIVE_CHAT_KEY);
}

const [messagesMap, setMessagesMap] = createStore<Record<string, Message[]>>({});
const [cursors, setCursors] = createStore<Record<string, string | null>>({});

// Bug 4 fix: per-chat loading state prevents race conditions on fast chat switching
const [loadingMap, setLoadingMap] = createStore<Record<string, boolean>>({});
function isLoadingMsgs(chatId: string): boolean {
  return loadingMap[chatId] ?? false;
}

const [typing, setTyping] = createStore<Record<string, string[]>>({});
const [onlineIds, setOnlineIds] = createSignal<Set<string>>(new Set());
const [unreadCounts, setUnreadCounts] = createStore<Record<string, number>>({});

// Track which chats have been loaded to avoid duplicate fetches
const loadedChats = new Set<string>();

function sortedChats(list: Chat[]): Chat[] {
  return [...list].sort((a, b) => {
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
}

async function loadChats() {
  try {
    const res = await api.getChats();
    // Bug 13 fix: single cast instead of fragile double-cast
    const rawChats = (res.data.chats ?? []) as unknown as RawChat[];
    const mapped: Chat[] = rawChats.map((c) => ({
      ...c,
      lastMessage: Array.isArray(c.messages) ? (c.messages[0] ?? null) : (c.lastMessage ?? null),
    }));
    setChats(sortedChats(mapped));

    // Populate unread counts from server (skip the currently-open chat
    // because openChat() already called clearUnread for it).
    const currentActive = activeChatId();
    for (const c of mapped) {
      if (typeof c.unread === 'number' && c.unread > 0 && c.id !== currentActive) {
        setUnreadCounts(c.id, c.unread);
      }
    }

    // Restore last open chat after chats are loaded
    const savedId = getSavedChatId();
    if (savedId) {
      if (mapped.find((c) => c.id === savedId) && !activeChatId()) {
        openChat(savedId);
      } else if (!mapped.find((c) => c.id === savedId)) {
        // Bug 16 fix: clear stale saved chat ID if the chat no longer exists
        localStorage.removeItem(ACTIVE_CHAT_KEY);
      }
    }
  } catch (e) {
    console.error('[chatStore] loadChats error:', e);
  }
}

async function openChat(chatId: string) {
  setActiveChatId(chatId);
  clearUnread(chatId);
  if (loadedChats.has(chatId)) return;
  loadedChats.add(chatId);

  // Show last message instantly so the chat opens at the bottom with no jump,
  // then silently load the full history above it.
  const preview = chats.find((c) => c.id === chatId)?.lastMessage;
  if (preview && !messagesMap[chatId]?.length) {
    setMessagesMap(chatId, [preview]);
  }

  await loadMessages(chatId);
}

async function loadMessages(chatId: string, prepend = false) {
  // Bug 4 fix: early exit before setting loading to avoid a flash for already-finished case
  if (prepend && cursors[chatId] === null) return;

  setLoadingMap(chatId, true);
  try {
    const cursor = prepend ? cursors[chatId] : undefined;

    const res = await api.getMessages(chatId, cursor ?? undefined);
    const msgs = [...(res.data?.messages ?? [])].reverse() as Message[];
    setCursors(chatId, res.data?.nextCursor ?? null);

    if (prepend) {
      setMessagesMap(chatId, (prev) => [...msgs, ...(prev ?? [])]);
    } else {
      setMessagesMap(chatId, msgs);
    }
  } catch (e) {
    console.error('[chatStore] loadMessages error:', e);
    if (!messagesMap[chatId]) setMessagesMap(chatId, []);
    // Bug 5 fix: remove from loadedChats on error so user can retry by reopening the chat
    loadedChats.delete(chatId);
  } finally {
    setLoadingMap(chatId, false);
  }
}

function addMessage(msg: Message) {
  const chatId = msg.chatId;
  setMessagesMap(chatId, (prev) => [...(prev ?? []), msg]);
  setChats(
    (c) => c.id === chatId,
    produce((c) => { c.lastMessage = msg; }),
  );
  // Re-sort chats so this chat bubbles to top
  setChats((prev) => sortedChats(prev));
}

function updateMessage(updated: Message) {
  setMessagesMap(
    updated.chatId,
    (m) => m.id === updated.id,
    produce((m) => { Object.assign(m, updated); }),
  );
  // Update lastMessage in chat list if it was the last one
  setChats(
    (c) => c.id === updated.chatId && c.lastMessage?.id === updated.id,
    produce((c) => { c.lastMessage = updated; }),
  );
}

function deleteMessage(chatId: string, messageId: string) {
  setMessagesMap(
    chatId,
    (m) => m.id === messageId,
    produce((m) => { m.isDeleted = true; m.text = null; }),
  );
}

function markRead(chatId: string, messageId: string, readBy: string) {
  const msgs = messagesMap[chatId] ?? [];
  const target = msgs.find((m) => m.id === messageId);
  if (!target) return;

  const readTime = new Date(target.createdAt).getTime();
  const now = new Date().toISOString();

  // Cascade: mark ALL messages up to and including the read one.
  // Skip items already marked by this user to avoid unnecessary reactive updates.
  setMessagesMap(
    chatId,
    (m) =>
      new Date(m.createdAt).getTime() <= readTime &&
      !(m.readBy ?? []).includes(readBy) &&
      !(m.readReceipts ?? []).some((r) => r.userId === readBy),
    produce((m) => {
      if (!m.readBy) m.readBy = [];
      m.readBy.push(readBy);
      if (!m.readReceipts) m.readReceipts = [];
      m.readReceipts.push({ userId: readBy, readAt: now });
    }),
  );
}

function markDelivered(chatId: string, messageId: string) {
  const msgs = messagesMap[chatId] ?? [];
  const target = msgs.find((m) => m.id === messageId);
  if (!target) return;

  const deliveredTime = new Date(target.createdAt).getTime();
  const DELIVERED = '__delivered__';

  // Cascade: all messages up to this one are also delivered
  setMessagesMap(
    chatId,
    (m) =>
      new Date(m.createdAt).getTime() <= deliveredTime &&
      !(m.readBy ?? []).includes(DELIVERED),
    produce((m) => {
      if (!m.readBy) m.readBy = [];
      m.readBy.push(DELIVERED);
    }),
  );
}

function addReaction(chatId: string, messageId: string, reaction: Reaction) {
  setMessagesMap(
    chatId,
    (m) => m.id === messageId,
    produce((m) => {
      if (!m.reactions) m.reactions = [];
      const idx = m.reactions.findIndex((r) => r.id === reaction.id);
      if (idx === -1) m.reactions.push(reaction);
    }),
  );
}

function removeReaction(chatId: string, messageId: string, userId: string, emoji: string) {
  setMessagesMap(
    chatId,
    (m) => m.id === messageId,
    produce((m) => {
      if (!m.reactions) return;
      m.reactions = m.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji));
    }),
  );
}

function setTypingUser(chatId: string, userId: string, isTyping: boolean) {
  setTyping(chatId, (prev) => {
    const arr = prev ?? [];
    if (isTyping) return arr.includes(userId) ? arr : [...arr, userId];
    return arr.filter((id) => id !== userId);
  });
}

function setOnline(userId: string, online: boolean) {
  setOnlineIds((prev) => {
    const next = new Set(prev);
    if (online) next.add(userId); else next.delete(userId);
    return next;
  });
}

function applyPresenceSnapshot(ids: string[]) {
  setOnlineIds(new Set<string>(ids));
}

function updateChatUser(patch: Partial<User> & { id: string }) {
  setChats(
    (c) => c.members.some((m) => m.user.id === patch.id),
    produce((c) => {
      c.members = c.members.map((m) =>
        m.user.id === patch.id
          ? { ...m, user: { ...m.user, ...patch } }
          : m,
      );
    }),
  );
}

// Update lastOnline timestamp when a user goes offline.
// This is separate from updateChatUser so we can call it cheaply from events.store.
function setUserLastOnline(userId: string, lastOnline: string) {
  setChats(
    (c) => c.members.some((m) => m.user.id === userId),
    produce((c) => {
      c.members = c.members.map((m) =>
        m.user.id === userId
          ? { ...m, user: { ...m.user, lastOnline, isOnline: false } }
          : m,
      );
    }),
  );
}

function addChat(chat: Chat) {
  setChats((prev) => {
    const exists = prev.find((c) => c.id === chat.id);
    if (exists) return prev;
    return sortedChats([chat, ...prev]);
  });
}

function removeChat(chatId: string) {
  setChats((prev) => prev.filter((c) => c.id !== chatId));
  // If this was the active chat, close it
  if (activeChatId() === chatId) setActiveChatId(null);
  // Clean up associated state
  setMessagesMap(produce((draft) => { delete draft[chatId]; }));
  setCursors(produce((draft) => { delete draft[chatId]; }));
  setLoadingMap(produce((draft) => { delete draft[chatId]; }));
  setUnreadCounts(chatId, 0);
  loadedChats.delete(chatId);
}

function incrementUnread(chatId: string) {
  setUnreadCounts(chatId, (prev) => (prev ?? 0) + 1);
}

function clearUnread(chatId: string) {
  setUnreadCounts(chatId, 0);
}

async function startDirectChat(userId: string): Promise<string> {
  const res = await api.createDirect(userId);
  const chat = res.data as Chat;
  if (!chats.find((c) => c.id === chat.id)) {
    setChats((prev) => sortedChats([chat, ...prev]));
  }
  await openChat(chat.id);
  return chat.id;
}

function resetStore() {
  setChats([]);
  setActiveChatId(null);
  setMessagesMap({});
  setCursors({});
  setLoadingMap({});
  setTyping({});
  setOnlineIds(new Set<string>());
  setUnreadCounts({});
  loadedChats.clear();
  localStorage.removeItem(ACTIVE_CHAT_KEY);
}

export const chatStore = {
  getSavedChatId,
  chats,
  activeChatId,
  activeChat,
  messages: messagesMap,
  cursors,
  loadingMsgs: isLoadingMsgs,
  typing,
  onlineIds,
  unreadCounts,
  loadChats,
  openChat,
  loadMessages,
  addMessage,
  addChat,
  removeChat,
  updateMessage,
  deleteMessage,
  markRead,
  markDelivered,
  addReaction,
  removeReaction,
  setTypingUser,
  setOnline,
  applyPresenceSnapshot,
  updateChatUser,
  startDirectChat,
  setActiveChatId,
  incrementUnread,
  clearUnread,
  setUserLastOnline,
  resetStore,
};
