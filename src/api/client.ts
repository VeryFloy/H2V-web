import type { User, Chat, Message, ContactInfo, MessageSearchResult, SharedMediaItem } from '../types';
import { i18n } from '../stores/i18n.store';

const BASE = '/api';

// ─── User request cache ───────────────────────────────────────────────────────
const USER_CACHE_TTL = 60_000;
interface UserCacheEntry { data: User; ts: number }
const _userCache = new Map<string, UserCacheEntry>();
const _userInflight = new Map<string, Promise<{ success: true; data: User }>>();

function _getUser(userId: string): Promise<{ success: true; data: User }> {
  const hit = _userCache.get(userId);
  if (hit && Date.now() - hit.ts < USER_CACHE_TTL) {
    return Promise.resolve({ success: true, data: hit.data });
  }
  const inflight = _userInflight.get(userId);
  if (inflight) return inflight;
  const p = request<{ success: true; data: User }>(`/users/${userId}`)
    .then((r) => {
      _userCache.set(userId, { data: r.data, ts: Date.now() });
      _userInflight.delete(userId);
      return r;
    })
    .catch((err) => {
      _userInflight.delete(userId);
      throw err;
    });
  _userInflight.set(userId, p);
  return p;
}

export function invalidateUserCache(userId?: string) {
  if (userId) {
    _userCache.delete(userId);
    _userInflight.delete(userId);
  } else {
    _userCache.clear();
    _userInflight.clear();
  }
}

export interface ApiError extends Error {
  status: number;
  code: string;
}

export function mediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.origin === window.location.origin) return parsed.pathname + parsed.search;
  } catch { /* invalid URL */ }
  return '';
}

export function mediaMediumUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/uploads/') || url.includes('/thumbs/') || url.includes('/medium/') || url.includes('/avatars/')) return mediaUrl(url);
  const filename = url.replace('/uploads/', '');
  return mediaUrl(`/uploads/medium/${filename}`);
}

export function makeApiError(status: number, code: string, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  return err;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('h2v:auth-expired'));
    throw makeApiError(401, 'AUTH_EXPIRED', 'Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = body?.error?.code ?? body?.code ?? body?.message ?? 'UNKNOWN';
    const tKey = `error.${code}`;
    const translated = i18n.t(tKey);
    const msg = translated !== tKey ? translated : (body?.message ?? body?.error?.message ?? code);
    throw makeApiError(res.status, code, msg);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

type ApiResponse<T> = { success: true; data: T };

export interface SessionInfo {
  id: string;
  deviceName: string | null;
  location: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export const api = {
  // Auth
  sendOtp: (email: string) =>
    request<ApiResponse<unknown>>('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyOtp: (email: string, code: string, nickname?: string) =>
    request<ApiResponse<{ user: User; isNewUser?: boolean }>>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code, ...(nickname ? { nickname } : {}) }),
    }),

  logout: () =>
    request('/auth/logout', { method: 'POST' }),

  // Sessions
  getSessions: () =>
    request<ApiResponse<SessionInfo[]>>('/auth/sessions'),

  terminateSession: (id: string) =>
    request<ApiResponse<{ terminated: string }>>(`/auth/sessions/${id}`, { method: 'DELETE' }),

  terminateOtherSessions: () =>
    request<ApiResponse<{ terminated: number }>>('/auth/sessions', { method: 'DELETE' }),

  // User
  getMe: () => request<ApiResponse<User>>('/users/me'),

  getUser: (userId: string) => _getUser(userId),

  updateMe: (data: FormData | Record<string, unknown>) =>
    request<ApiResponse<User>>('/users/me', {
      method: 'PATCH',
      body: data instanceof FormData ? data : JSON.stringify(data),
    }),

  deleteMe: () => request('/users/me', { method: 'DELETE' }),

  searchUsers: (q: string) =>
    request<ApiResponse<User[]>>(`/users/search?q=${encodeURIComponent(q)}`),

  // Chats
  getChats: () =>
    request<ApiResponse<{ chats: Chat[]; nextCursor: string | null }>>('/chats'),

  getArchivedChats: () =>
    request<ApiResponse<{ chats: Chat[]; nextCursor: string | null }>>('/chats?archived=true'),

  getChat: (chatId: string) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}`),

  getSavedMessages: () =>
    request<ApiResponse<Chat>>('/chats/saved', { method: 'POST' }),

  createDirect: (userId: string) =>
    request<ApiResponse<Chat>>('/chats/direct', {
      method: 'POST',
      body: JSON.stringify({ targetUserId: userId }),
    }),

  createGroup: (name: string, memberIds: string[]) =>
    request<ApiResponse<Chat>>('/chats/group', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    }),

  createSecret: (userId: string) =>
    request<ApiResponse<Chat>>('/chats/secret', {
      method: 'POST',
      body: JSON.stringify({ targetUserId: userId }),
    }),

  leaveChat: (chatId: string) =>
    request(`/chats/${chatId}/leave`, { method: 'DELETE' }),

  deleteGroup: (chatId: string) =>
    request(`/chats/${chatId}`, { method: 'DELETE' }),

  muteChat: (chatId: string, muted: boolean) =>
    request<ApiResponse<{ chatId: string; muted: boolean; mutedUntil: string | null }>>(`/chats/${chatId}/mute`, {
      method: 'PATCH',
      body: JSON.stringify({ muted }),
    }),

  pinChat: (chatId: string, pinned: boolean) =>
    request<ApiResponse<{ chatId: string; pinned: boolean; pinnedAt?: string }>>(`/chats/${chatId}/pin-chat`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),

  renameGroup: (chatId: string, name: string) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  updateGroupAvatar: (chatId: string, avatarUrl: string) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ avatar: avatarUrl }),
    }),

  updateGroupDescription: (chatId: string, description: string) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ description }),
    }),

  kickMember: (chatId: string, userId: string) =>
    request(`/chats/${chatId}/members/${userId}`, { method: 'DELETE' }),

  addMembers: (chatId: string, userIds: string[]) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),

  changeMemberRole: (chatId: string, userId: string, role: 'ADMIN' | 'MEMBER') =>
    request<ApiResponse<Chat>>(`/chats/${chatId}/members/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  pinMessage: (chatId: string, messageId: string | null) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ messageId }),
    }),

  createInviteLink: (chatId: string, opts?: { expiresInHours?: number; maxUses?: number }) =>
    request<ApiResponse<{ id: string; code: string; expiresAt: string | null; maxUses: number | null; uses: number }>>(`/chats/${chatId}/invite`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),

  getInviteLinks: (chatId: string) =>
    request<ApiResponse<{ id: string; code: string; expiresAt: string | null; maxUses: number | null; uses: number; createdAt: string }[]>>(`/chats/${chatId}/invite`),

  revokeInviteLink: (linkId: string) =>
    request(`/chats/invite/${linkId}`, { method: 'DELETE' }),

  joinByInvite: (code: string) =>
    request<ApiResponse<Chat>>(`/chats/join/${code}`, { method: 'POST' }),

  getInviteInfo: (code: string) =>
    request<ApiResponse<{ code: string; chat: { id: string; name: string | null; avatar: string | null; description: string | null; _count: { members: number } } }>>(`/chats/join/${code}`),

  blockUser: (userId: string) =>
    request(`/users/${userId}/block`, { method: 'POST' }),

  unblockUser: (userId: string) =>
    request(`/users/${userId}/block`, { method: 'DELETE' }),

  getBlockedUsers: () =>
    request<ApiResponse<string[]>>('/users/me/blocked'),

  getBlockedUsersFull: () =>
    request<ApiResponse<Array<{ id: string; nickname: string; firstName?: string | null; lastName?: string | null; avatar?: string | null }>>>('/users/me/blocked?full=1'),

  getSharedMedia: (chatId: string, tab: 'media' | 'files' | 'links' | 'voice', cursor?: string) =>
    request<ApiResponse<{ items: SharedMediaItem[]; nextCursor: string | null }>>(`/chats/${chatId}/shared?tab=${tab}${cursor ? `&cursor=${cursor}` : ''}`),

  searchGlobal: (q: string, cursor?: string) =>
    request<ApiResponse<{ messages: MessageSearchResult[]; nextCursor: string | null }>>(`/messages/search?q=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),

  // Messages
  getMessages: (chatId: string, cursor?: string, q?: string, filters?: { from?: string; to?: string; senderId?: string; type?: string }) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (q) params.set('q', q);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.senderId) params.set('senderId', filters.senderId);
    if (filters?.type) params.set('type', filters.type);
    const qs = params.toString();
    return request<ApiResponse<{ messages: Message[]; nextCursor: string | null }>>(
      `/chats/${chatId}/messages${qs ? `?${qs}` : ''}`,
    );
  },

  getMessagesAroundDate: (chatId: string, date: string) =>
    request<ApiResponse<{ messages: Message[]; nextCursor: string | null }>>(
      `/chats/${chatId}/messages/around?date=${encodeURIComponent(date)}`,
    ),

  editMessage: (
    messageId: string,
    payload: { text: string } | { ciphertext: string; signalType: number },
  ) =>
    request<ApiResponse<Message>>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteMessage: (messageId: string, forEveryone = true) =>
    request(`/messages/${messageId}?forEveryone=${forEveryone}`, { method: 'DELETE' }),

  hideMessage: (messageId: string) =>
    request(`/messages/${messageId}/hide`, { method: 'POST' }),

  markRead: (messageId: string) =>
    request(`/messages/${messageId}/read`, { method: 'POST' }),

  // Reactions
  addReaction: (messageId: string, emoji: string) =>
    request(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  removeReaction: (messageId: string, emoji: string) =>
    request(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
      method: 'DELETE',
    }),

  // Upload
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ApiResponse<{ url: string; name: string; type: string }>>('/upload', {
      method: 'POST',
      body: form,
    });
  },

  uploadWithProgress: (
    file: File,
    onProgress: (pct: number) => void,
  ): { promise: Promise<ApiResponse<{ url: string; name: string; type: string }>>; abort: () => void } => {
    const form = new FormData();
    form.append('file', file);

    let abortFn: () => void = () => {};

    const promise = new Promise<ApiResponse<{ url: string; name: string; type: string }>>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      abortFn = () => xhr.abort();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('Invalid JSON')); }
        } else if (xhr.status === 401) {
          window.dispatchEvent(new CustomEvent('h2v:auth-expired'));
          reject(makeApiError(401, 'UNAUTHORIZED', 'Session expired'));
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onabort = () => reject(new Error('Upload cancelled'));
      xhr.open('POST', `${BASE}/upload`);
      xhr.withCredentials = true;
      xhr.send(form);
    });
    return { promise, abort: () => abortFn() };
  },

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ApiResponse<{ url: string }>>('/upload/avatar', {
      method: 'POST',
      body: form,
    });
  },

  uploadEncrypted: (blob: Blob, originalName: string) => {
    const form = new FormData();
    form.append('file', blob, originalName);
    return request<ApiResponse<{ url: string; name: string; size: number }>>('/upload/encrypted', {
      method: 'POST',
      body: form,
    });
  },

  getSettings: () =>
    request<ApiResponse<Record<string, unknown>>>('/users/me/settings'),

  updateSettings: (data: Record<string, unknown>) =>
    request<ApiResponse<Record<string, unknown>>>('/users/me/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ── Signal Protocol Keys ──
  uploadKeyBundle: (bundle: {
    registrationId: number;
    identityKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySig: string;
    oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
  }) =>
    request<ApiResponse<{ uploaded: boolean }>>('/keys/bundle', {
      method: 'POST',
      body: JSON.stringify(bundle),
    }),

  getKeyBundle: (userId: string) =>
    request<ApiResponse<{
      registrationId: number;
      identityKey: string;
      signedPreKeyId: number;
      signedPreKey: string;
      signedPreKeySig: string;
      preKey: { keyId: number; publicKey: string } | null;
    }>>(`/keys/bundle/${userId}`),

  hasKeyBundle: (userId: string) =>
    request<ApiResponse<{ hasBundle: boolean }>>(`/keys/has-bundle/${userId}`),

  replenishPreKeys: (preKeys: Array<{ keyId: number; publicKey: string }>) =>
    request<ApiResponse<{ added: number }>>('/keys/replenish', {
      method: 'POST',
      body: JSON.stringify({ preKeys }),
    }),

  getPreKeyCount: () =>
    request<ApiResponse<{ count: number }>>('/keys/count'),

  // ── Push Notifications ──
  getVapidKey: () =>
    request<ApiResponse<{ vapidPublicKey: string }>>('/push/vapid-key'),

  registerDeviceToken: (token: string, platform: 'IOS' | 'ANDROID' | 'WEB') =>
    request<ApiResponse<{ id: string }>>('/users/me/device-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    }),

  removeDeviceToken: (token: string) =>
    request<ApiResponse<{ message: string }>>('/users/me/device-token', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    }),

  // ── Contacts ──
  getContacts: () =>
    request<ApiResponse<ContactInfo[]>>('/contacts'),

  addContact: (userId: string) =>
    request<ApiResponse<{ added: boolean }>>(`/contacts/${userId}`, { method: 'POST' }),

  removeContact: (userId: string) =>
    request<ApiResponse<{ removed: boolean }>>(`/contacts/${userId}`, { method: 'DELETE' }),

  checkContact: (userId: string) =>
    request<ApiResponse<{ isContact: boolean; isMutual: boolean }>>(`/contacts/check/${userId}`),

  // Drafts
  upsertDraft: (chatId: string, text: string, replyToId?: string | null) =>
    request<ApiResponse<{ text: string; replyToId: string | null }>>(`/chats/${chatId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ text, replyToId: replyToId ?? null }),
    }),

  deleteDraft: (chatId: string) =>
    request(`/chats/${chatId}/draft`, { method: 'DELETE' }),

  exportChat: (chatId: string, format: 'json' | 'html' = 'json') => {
    if (chatId === 'all') {
      window.open(`${BASE}/chats/export/all?format=${format}`, '_blank');
    } else {
      window.open(`${BASE}/chats/${chatId}/export?format=${format}`, '_blank');
    }
  },
};
