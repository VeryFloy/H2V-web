import { createSignal, createMemo, batch } from 'solid-js';
// Signal updated ONLY when a real-time WebSocket message arrives (addMessage).
// Used by MessageArea to drive scroll-to-bottom / new-message badge reliably
// without triggering on batch loads from the API or cache.
import { createStore, produce } from 'solid-js/store';
import { api, request } from '../api/client';
import { appCache } from '../utils/appCache';
import type { Chat, Message, User, Reaction, ChatDraft } from '../types';
import { e2eStore } from './e2e.store';
import { authStore } from './auth.store';
import { mutedStore } from './muted.store';

type RawChat = Omit<Chat, 'lastMessage'> & { messages?: Message[]; lastMessage?: Message | null };

const MAX_MESSAGES_PER_CHAT = 500;

const ACTIVE_CHAT_KEY = 'h2v_activeChatId';

const [chats, setChats] = createStore<Chat[]>([]);
const [activeChatId, _setActiveChatId] = createSignal<string | null>(null);
const activeChat = createMemo(() => chats.find((c) => c.id === activeChatId()) ?? null);

let _skipUrlPush = false;

function chatSlug(chat: Chat): string {
  const me = authStore.user();
  if (chat.type === 'SELF') return 'saved';
  if (chat.type === 'GROUP') return `-${chat.numericId ?? chat.id}`;
  // DM / SECRET — use partner's @username or numeric ID
  const partner = chat.members.find(m => m.user.id !== me?.id)?.user;
  if (partner?.nickname) return `@${partner.nickname}`;
  if (partner?.numericId) return `+${partner.numericId}`;
  return chat.id;
}

function resolveChatSlug(slug: string): string | null {
  if (slug === 'saved') {
    return chats.find(c => c.type === 'SELF')?.id ?? null;
  }
  if (slug.startsWith('-')) {
    const nid = parseInt(slug.slice(1), 10);
    if (!isNaN(nid)) return chats.find(c => c.numericId === nid && (c.type === 'GROUP'))?.id ?? null;
  }
  if (slug.startsWith('@')) {
    const nick = slug.slice(1).toLowerCase();
    const me = authStore.user();
    // Own username → Saved Messages
    if (me?.nickname?.toLowerCase() === nick) {
      return chats.find(c => c.type === 'SELF')?.id ?? null;
    }
    return chats.find(c => {
      if (c.type === 'GROUP') return false;
      const p = c.members.find(m => m.user.id !== me?.id)?.user;
      return p?.nickname?.toLowerCase() === nick;
    })?.id ?? null;
  }
  if (slug.startsWith('+')) {
    const nid = parseInt(slug.slice(1), 10);
    if (isNaN(nid)) return null;
    const me = authStore.user();
    if (me?.numericId === nid) {
      return chats.find(c => c.type === 'SELF')?.id ?? null;
    }
    return chats.find(c => {
      const p = c.members.find(m => m.user.id !== me?.id)?.user;
      return p?.numericId === nid;
    })?.id ?? null;
  }
  // Fallback: raw chatId (backward compat)
  return chats.find(c => c.id === slug)?.id ?? null;
}

function setActiveChatId(id: string | null) {
  const prev = activeChatId();
  _setActiveChatId(id);
  if (id) localStorage.setItem(ACTIVE_CHAT_KEY, id);
  else localStorage.removeItem(ACTIVE_CHAT_KEY);

  if (!_skipUrlPush) {
    const chat = id ? chats.find(c => c.id === id) : null;
    const target = chat ? `/chat/${chatSlug(chat)}` : '/';
    if (window.location.pathname !== target) {
      // push when going from list→chat, replace when switching chats or closing
      if (id && !prev) {
        history.pushState({ chatSlug: target }, '', target);
      } else {
        history.replaceState(null, '', target);
      }
    }
  }
}

function setActiveChatIdFromUrl(slug: string | null) {
  _skipUrlPush = true;
  if (slug) {
    const chatId = resolveChatSlug(slug);
    _setActiveChatId(chatId);
    if (chatId) localStorage.setItem(ACTIVE_CHAT_KEY, chatId);
  } else {
    _setActiveChatId(null);
    localStorage.removeItem(ACTIVE_CHAT_KEY);
  }
  _skipUrlPush = false;
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
const [mentionCounts, setMentionCounts] = createStore<Record<string, number>>({});
// Snapshot of unread count taken at the moment a chat is opened (before clearUnread).
// Used by MessageArea to place the "unread messages" divider and scroll to first unread.
const [openUnreadMap, setOpenUnreadMap] = createStore<Record<string, number>>({});

// Track which chats have been loaded to avoid duplicate fetches
const loadedChats = new Set<string>();

const [latestRealtimeMsg, setLatestRealtimeMsg] = createSignal<Message | null>(null);

function getPinnedAt(chat: Chat): string | null {
  const me = authStore.user();
  if (!me) return null;
  return chat.members.find((m) => m.user.id === me.id)?.pinnedAt ?? null;
}

function sortedChats(list: Chat[]): Chat[] {
  return [...list].sort((a, b) => {
    const pa = getPinnedAt(a);
    const pb = getPinnedAt(b);
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    if (pa && pb) return new Date(pa).getTime() - new Date(pb).getTime();
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
}

function _applyChats(mapped: Chat[]) {
  setChats(sortedChats(mapped));
  const currentActive = activeChatId();
  for (const c of mapped) {
    if (typeof c.unread === 'number' && c.unread > 0 && c.id !== currentActive) {
      setUnreadCounts(c.id, c.unread);
    }
  }
}

function _restoreSavedChat(available: Chat[]) {
  const savedId = getSavedChatId();
  if (!savedId) return;
  if (available.find((c) => c.id === savedId)) {
    if (!activeChatId()) openChat(savedId);
  } else {
    localStorage.removeItem(ACTIVE_CHAT_KEY);
  }
}

async function loadChats() {
  // ── 1. Show cached chats immediately (stale-while-revalidate) ─────────────
  const cached = appCache.get<Chat[]>('chats');
  if (cached && cached.length > 0) {
    _applyChats(cached);
    _restoreSavedChat(cached);
  }

  // ── 2. Fetch fresh data in the background ─────────────────────────────────
  try {
    const res = await api.getChats();
    const rawChats = (res.data.chats ?? []) as unknown as RawChat[];
    const mapped: Chat[] = rawChats.map((c) => ({
      ...c,
      lastMessage: Array.isArray(c.messages) ? (c.messages[0] ?? null) : (c.lastMessage ?? null),
    }));

    _applyChats(mapped);
    appCache.set('chats', mapped);

    const myId = authStore.user()?.id;
    if (myId) mutedStore.syncFromChats(mapped, myId);

    if (!activeChatId()) {
      _restoreSavedChat(mapped);
      // Resolve URL slug after chats loaded (e.g. /chat/@username on direct navigation)
      if (!activeChatId()) {
        const urlMatch = window.location.pathname.match(/^\/chat\/(.+)$/);
        if (urlMatch) {
          const resolved = resolveChatSlug(decodeURIComponent(urlMatch[1]));
          if (resolved) openChat(resolved);
        }
      }
    }
    const savedId = getSavedChatId();
    if (savedId && !mapped.find((c) => c.id === savedId)) {
      localStorage.removeItem(ACTIVE_CHAT_KEY);
    }

    cleanupExpiredSecretChats();
  } catch (e) {
    console.error('[chatStore] loadChats error:', e);
  }
}

const SECRET_TTL_KEY = 'h2v_secret_ttl';
const SECRET_TTL_MS = 24 * 60 * 60 * 1000;

function _getSecretTimestamps(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SECRET_TTL_KEY) || '{}'); } catch { return {}; }
}

function _saveSecretTimestamps(map: Record<string, number>) {
  localStorage.setItem(SECRET_TTL_KEY, JSON.stringify(map));
}

function touchSecretChat(chatId: string) {
  const map = _getSecretTimestamps();
  map[chatId] = Date.now();
  _saveSecretTimestamps(map);
}

function cleanupExpiredSecretChats() {
  const map = _getSecretTimestamps();
  const now = Date.now();
  const expired: string[] = [];
  for (const [id, ts] of Object.entries(map)) {
    if (now - ts > SECRET_TTL_MS) expired.push(id);
  }
  if (expired.length === 0) return;
  for (const id of expired) {
    const c = chats.find((ch) => ch.id === id && ch.type === 'SECRET');
    if (c) removeChat(id);
    delete map[id];
  }
  _saveSecretTimestamps(map);
}

async function openChat(chatId: string) {
  const prevUnread = unreadCounts[chatId] ?? 0;
  batch(() => {
    setOpenUnreadMap(chatId, prevUnread);
    setActiveChatId(chatId);
    clearUnread(chatId);
  });
  const c = chats.find((ch) => ch.id === chatId);
  if (c?.type === 'SECRET') touchSecretChat(chatId);
  if (loadedChats.has(chatId)) return;
  loadedChats.add(chatId);
  await loadMessages(chatId);
}

async function loadMessages(chatId: string, prepend = false) {
  if (prepend && cursors[chatId] === null) return;

  // ── For initial (non-paginated) load: show cached messages instantly ───────
  if (!prepend && !messagesMap[chatId]?.length) {
    const cached = appCache.getMsgs(chatId);
    if (cached && cached.length > 0) {
      setMessagesMap(chatId, cached);
      e2eStore.preloadDecryptedTexts(cached.map((m) => m.id));
      // Don't show spinner if we have cached content
      setLoadingMap(chatId, false);
    }
  }

  // Only show the loading indicator when there's truly nothing to show yet
  if (!messagesMap[chatId]?.length) setLoadingMap(chatId, true);

  try {
    const cursor = prepend ? cursors[chatId] : undefined;

    const res = await api.getMessages(chatId, cursor ?? undefined);
    const meId = authStore.user()?.id;
    const msgs = [...(res.data?.messages ?? [])].reverse().map((m) => {
      if (meId && m.sender?.id === meId) return { ...m, isDelivered: true };
      return m;
    }) as Message[];
    setCursors(chatId, res.data?.nextCursor ?? null);

    if (prepend) {
      setMessagesMap(chatId, (prev) => {
        const combined = [...msgs, ...(prev ?? [])];
        if (combined.length > MAX_MESSAGES_PER_CHAT) {
          return combined.slice(0, MAX_MESSAGES_PER_CHAT);
        }
        return combined;
      });
    } else {
      setMessagesMap(chatId, msgs);
      // Persist to cache for the next page load (initial load only)
      appCache.setMsgs(chatId, msgs);
    }

    e2eStore.preloadDecryptedTexts(msgs.map((m) => m.id));

    for (const m of msgs) {
      if (m.ciphertext && m.signalType && m.sender?.id && m.sender.id !== meId) {
        if (!e2eStore.getDecryptedText(m.id)) {
          e2eStore.decrypt(m.id, m.sender.id, m.ciphertext, m.signalType).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error('[chatStore] loadMessages error:', e);
    if (!messagesMap[chatId]) setMessagesMap(chatId, []);
    loadedChats.delete(chatId);
  } finally {
    setLoadingMap(chatId, false);
  }
}

const pendingDeliveries = new Set<string>();

let _pendingCounter = 0;
const _pendingQueues = new Map<string, string[]>();

function addPendingMessage(chatId: string, payload: Partial<Message>): string {
  const tempId = `pending_${++_pendingCounter}_${Date.now()}`;
  const user = authStore.user();
  const sender = user
    ? { id: user.id, nickname: user.nickname, firstName: user.firstName, lastName: user.lastName, avatar: user.avatar }
    : null;
  const now = new Date().toISOString();
  const msg: Message = {
    id: tempId,
    chatId,
    sender,
    text: payload.text ?? null,
    type: payload.type ?? 'TEXT',
    mediaUrl: payload.mediaUrl ?? null,
    mediaName: payload.mediaName ?? null,
    mediaSize: payload.mediaSize ?? null,
    isDeleted: false,
    isEdited: false,
    replyToId: payload.replyToId ?? null,
    replyTo: payload.replyTo ?? null,
    forwardedFromId: payload.forwardedFromId ?? null,
    forwardSenderName: payload.forwardSenderName ?? null,
    createdAt: now,
    updatedAt: now,
    readReceipts: [],
    reactions: [],
    ciphertext: payload.ciphertext ?? null,
    signalType: payload.signalType ?? null,
    pending: true,
  };

  setMessagesMap(chatId, (prev) => {
    const arr = prev ?? [];
    let next = [...arr, msg];
    if (next.length > MAX_MESSAGES_PER_CHAT) {
      next = next.slice(next.length - MAX_MESSAGES_PER_CHAT);
    }
    return next;
  });

  const queue = _pendingQueues.get(chatId) ?? [];
  queue.push(tempId);
  _pendingQueues.set(chatId, queue);

  setChats(
    (c) => c.id === chatId,
    produce((c) => { c.lastMessage = msg; }),
  );
  setLatestRealtimeMsg(msg);
  setChats((prev) => sortedChats([...prev]));

  return tempId;
}

function confirmPendingMessage(chatId: string, realMsg: Message): boolean {
  const queue = _pendingQueues.get(chatId);
  if (!queue || queue.length === 0) return false;

  const tempId = queue.shift()!;
  if (queue.length === 0) _pendingQueues.delete(chatId);

  setMessagesMap(chatId, (prev) => {
    const arr = prev ?? [];
    const idx = arr.findIndex((m) => m.id === tempId);
    if (idx === -1) return arr;
    const next = [...arr];
    next[idx] = realMsg;
    appCache.setMsgs(chatId, next);
    return next;
  });

  setChats(
    (c) => c.id === chatId,
    produce((c) => { c.lastMessage = realMsg; }),
  );

  return true;
}

function failPendingMessage(chatId: string, tempId?: string) {
  if (tempId) {
    setMessagesMap(chatId, (prev) =>
      (prev ?? []).map((m) => m.id === tempId ? { ...m, pending: false, failed: true } : m),
    );
    return;
  }
  const queue = _pendingQueues.get(chatId);
  if (!queue || queue.length === 0) return;
  const id = queue.shift()!;
  if (queue.length === 0) _pendingQueues.delete(chatId);
  setMessagesMap(chatId, (prev) =>
    (prev ?? []).map((m) => m.id === id ? { ...m, pending: false, failed: true } : m),
  );
}

function removeMessage(chatId: string, msgId: string) {
  setMessagesMap(chatId, (prev) => (prev ?? []).filter((m) => m.id !== msgId));
}

function addMessage(msg: Message) {
  const chatId = msg.chatId;
  if (pendingDeliveries.has(msg.id)) {
    msg = { ...msg, isDelivered: true };
    pendingDeliveries.delete(msg.id);
  }
  setMessagesMap(chatId, (prev) => {
    const arr = prev ?? [];
    if (arr.some((m) => m.id === msg.id)) return arr;
    let next = [...arr, msg];
    if (next.length > MAX_MESSAGES_PER_CHAT) {
      next = next.slice(next.length - MAX_MESSAGES_PER_CHAT);
    }
    appCache.setMsgs(chatId, next);
    return next;
  });
  setChats(
    (c) => c.id === chatId,
    produce((c) => { c.lastMessage = msg; }),
  );
  setLatestRealtimeMsg(msg);
  setChats((prev) => sortedChats([...prev]));
  const c = chats.find((ch) => ch.id === chatId);
  if (c?.type === 'SECRET') touchSecretChat(chatId);
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

type DeleteAnimHook = (chatId: string, messageId: string, doRemove: () => void) => void;
let _deleteAnimHook: DeleteAnimHook | null = null;

function setDeleteAnimHook(hook: DeleteAnimHook | null) {
  _deleteAnimHook = hook;
}

function _removeMessage(chatId: string, messageId: string, newLastMessage?: Message | null) {
  setMessagesMap(produce((draft) => {
    const list = draft[chatId];
    if (!list) return;
    const idx = list.findIndex((m: Message) => m.id === messageId);
    if (idx >= 0) list.splice(idx, 1);
  }));
  setChats(
    (c) => c.id === chatId && c.lastMessage?.id === messageId,
    produce((c) => {
      if (newLastMessage !== undefined) {
        c.lastMessage = newLastMessage ?? null;
      } else {
        const msgs = messagesMap[chatId];
        c.lastMessage = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : null;
      }
    }),
  );
}

function deleteMessage(chatId: string, messageId: string, newLastMessage?: Message | null) {
  if (_deleteAnimHook && chatId === activeChatId()) {
    _deleteAnimHook(chatId, messageId, () => _removeMessage(chatId, messageId, newLastMessage));
  } else {
    _removeMessage(chatId, messageId, newLastMessage);
  }
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

function markListened(chatId: string, messageId: string, listenedBy: string) {
  setMessagesMap(
    chatId,
    (m) => m.id === messageId && !(m.voiceListens ?? []).some((v) => v.userId === listenedBy),
    produce((m) => {
      if (!m.voiceListens) m.voiceListens = [];
      m.voiceListens.push({ userId: listenedBy });
    }),
  );
}

function markDelivered(chatId: string, messageId: string) {
  const msgs = messagesMap[chatId] ?? [];
  const target = msgs.find((m) => m.id === messageId);
  if (!target) {
    pendingDeliveries.add(messageId);
    return;
  }

  const deliveredTime = new Date(target.createdAt).getTime();

  setMessagesMap(
    chatId,
    (m) => new Date(m.createdAt).getTime() <= deliveredTime && !m.isDelivered,
    produce((m) => { m.isDelivered = true; }),
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

function updateChat(chatId: string, patch: Partial<Pick<Chat, 'name' | 'avatar' | 'members' | 'pinnedMessageId' | 'description'>>) {
  setChats(
    (c) => c.id === chatId,
    produce((c) => { Object.assign(c, patch); }),
  );
}

function removeMember(chatId: string, userId: string) {
  setChats(
    (c) => c.id === chatId,
    produce((c) => {
      c.members = c.members.filter((m) => m.userId !== userId);
    }),
  );
}

function addChat(chat: Chat) {
  setChats((prev) => {
    const exists = prev.find((c) => c.id === chat.id);
    if (exists) return prev;
    const next = sortedChats([chat, ...prev]);
    appCache.set('chats', next);
    return next;
  });
}

function removeChat(chatId: string) {
  setChats((prev) => {
    const next = prev.filter((c) => c.id !== chatId);
    appCache.set('chats', next);
    return next;
  });
  if (activeChatId() === chatId) setActiveChatId(null);
  setMessagesMap(produce((draft) => { delete draft[chatId]; }));
  setCursors(produce((draft) => { delete draft[chatId]; }));
  setLoadingMap(produce((draft) => { delete draft[chatId]; }));
  setUnreadCounts(chatId, 0);
  loadedChats.delete(chatId);
  appCache.deleteMsgs(chatId);
}

function incrementUnread(chatId: string) {
  setUnreadCounts(chatId, (prev) => (prev ?? 0) + 1);
}

function incrementMention(chatId: string) {
  setMentionCounts(chatId, (prev) => (prev ?? 0) + 1);
}

function clearUnread(chatId: string) {
  setUnreadCounts(chatId, 0);
  setMentionCounts(chatId, 0);
}

function clearOpenUnread(chatId: string) {
  setOpenUnreadMap(chatId, 0);
}

const totalUnread = createMemo(() =>
  Object.values(unreadCounts).reduce((sum: number, n) => sum + (n ?? 0), 0)
);

function hideMessage(chatId: string, msgId: string) {
  setMessagesMap(produce((draft) => {
    const list = draft[chatId];
    if (!list) return;
    const idx = list.findIndex((m: Message) => m.id === msgId);
    if (idx >= 0) list.splice(idx, 1);
  }));
}

async function loadMessagesAroundDate(chatId: string, date: string) {
  setLoadingMap(chatId, true);
  try {
    const res = await api.getMessagesAroundDate(chatId, date);
    const meId = authStore.user()?.id;
    const msgs = [...(res.data?.messages ?? [])].reverse().map((m) => {
      if (meId && m.sender?.id === meId) return { ...m, isDelivered: true };
      return m;
    }) as Message[];
    setCursors(chatId, res.data?.nextCursor ?? null);
    setMessagesMap(chatId, (prev) => {
      const existing = new Map((prev ?? []).map(m => [m.id, m]));
      for (const m of msgs) existing.set(m.id, m);
      return [...existing.values()].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
    loadedChats.add(chatId);
    e2eStore.preloadDecryptedTexts(msgs.map((m) => m.id));

    for (const m of msgs) {
      if (m.ciphertext && m.signalType && m.sender?.id && m.sender.id !== meId) {
        if (!e2eStore.getDecryptedText(m.id)) {
          e2eStore.decrypt(m.id, m.sender.id, m.ciphertext, m.signalType).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error('[chatStore] loadMessagesAroundDate error:', e);
  } finally {
    setLoadingMap(chatId, false);
  }
}

function updateDraft(chatId: string, draft: ChatDraft | null) {
  setChats(
    (c) => c.id === chatId,
    produce((c) => { c.draft = draft; }),
  );
}

async function loadSingleChat(chatId: string) {
  try {
    const res = await api.getChat(chatId);
    addChat(res.data as Chat);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status;
    if (status === 404) {
      // Chat was deleted or not yet propagated — refresh the full list
      await loadChats();
    }
    // For network errors or 5xx, silently skip: addMessage still works,
    // the chat will appear after the next loadChats() call.
  }
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

async function openSavedMessages(): Promise<string> {
  const existing = chats.find((c) => c.type === 'SELF');
  if (existing) {
    await openChat(existing.id);
    return existing.id;
  }
  const res = await api.getSavedMessages();
  const chat = res.data as Chat;
  if (!chats.find((c) => c.id === chat.id)) {
    setChats((prev) => sortedChats([chat, ...prev]));
  }
  await openChat(chat.id);
  return chat.id;
}

async function startSecretChat(userId: string): Promise<string> {
  const res = await api.createSecret(userId);
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
  pendingDeliveries.clear();
  localStorage.removeItem(ACTIVE_CHAT_KEY);
}

const [archivedChats, setArchivedChats] = createStore<Chat[]>([]);

async function archiveChat(chatId: string, archived: boolean) {
  await request(`/chats/${chatId}/archive`, { method: 'PATCH', body: JSON.stringify({ archived }) });
  if (archived) {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) setArchivedChats((prev) => [chat, ...prev]);
    mutedStore.mute(chatId);
  } else {
    setArchivedChats(produce((list) => {
      const idx = list.findIndex((c) => c.id === chatId);
      if (idx !== -1) list.splice(idx, 1);
    }));
  }
  setChats(produce((list) => {
    const idx = list.findIndex((c) => c.id === chatId);
    if (idx !== -1) list.splice(idx, 1);
  }));
  if (activeChatId() === chatId) setActiveChatId(null);
}

async function unarchiveChat(chatId: string) {
  await request(`/chats/${chatId}/archive`, { method: 'PATCH', body: JSON.stringify({ archived: false }) });
  const chat = archivedChats.find((c) => c.id === chatId);
  if (chat) {
    setChats((prev) => sortedChats([chat, ...prev]));
  }
  setArchivedChats(produce((list) => {
    const idx = list.findIndex((c) => c.id === chatId);
    if (idx !== -1) list.splice(idx, 1);
  }));
}

async function loadArchivedChats() {
  try {
    const res = await api.getArchivedChats();
    const rawChats = (res.data.chats ?? []) as unknown as RawChat[];
    const mapped: Chat[] = rawChats.map((c) => ({
      ...c,
      lastMessage: Array.isArray(c.messages) ? (c.messages[0] ?? null) : (c.lastMessage ?? null),
    }));
    setArchivedChats(mapped);
  } catch (e) {
    console.error('[chatStore] loadArchivedChats error:', e);
  }
}

function isChatPinned(chatId: string): boolean {
  const c = chats.find((ch) => ch.id === chatId);
  if (!c) return false;
  return !!getPinnedAt(c);
}

async function togglePinChat(chatId: string, pinned: boolean) {
  const res = await api.pinChat(chatId, pinned);
  const pinnedAt = pinned ? (res.data.pinnedAt ?? new Date().toISOString()) : null;
  setChats((prev) => {
    const updated = prev.map((c) => {
      if (c.id !== chatId) return c;
      const me = authStore.user();
      if (!me) return c;
      return {
        ...c,
        members: c.members.map((m) =>
          m.user.id === me.id ? { ...m, pinnedAt } : m,
        ),
      };
    });
    return sortedChats(updated);
  });
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
  mentionCounts,
  loadChats,
  openChat,
  loadMessages,
  addMessage,
  addPendingMessage,
  confirmPendingMessage,
  failPendingMessage,
  removeMessage,
  addChat,
  removeChat,
  updateMessage,
  deleteMessage: (chatId: string, messageId: string, newLastMessage?: Message | null) => deleteMessage(chatId, messageId, newLastMessage),
  markRead,
  markListened,
  markDelivered,
  addReaction,
  removeReaction,
  setTypingUser,
  setOnline,
  applyPresenceSnapshot,
  updateChatUser,
  updateChat,
  removeMember,
  loadSingleChat,
  startDirectChat,
  startSecretChat,
  openSavedMessages,
  setActiveChatId,
  setActiveChatIdFromUrl,
  incrementUnread,
  incrementMention,
  clearUnread,
  openUnreadMap,
  clearOpenUnread,
  latestRealtimeMsg,
  totalUnread,
  hideMessage,
  setDeleteAnimHook,
  setUserLastOnline,
  loadMessagesAroundDate,
  updateDraft,
  archiveChat,
  unarchiveChat,
  archivedChats,
  loadArchivedChats,
  isChatPinned,
  togglePinChat,
  resetStore,
};
