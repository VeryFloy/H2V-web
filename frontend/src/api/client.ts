import type { User, Chat, Message } from '../types';
import { i18n } from '../stores/i18n.store';

const BASE = '/api';

export interface ApiError extends Error {
  status: number;
  code: string;
}

export function makeApiError(status: number, code: string, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  return err;
}

export function getToken() {
  return localStorage.getItem('accessToken');
}

export function mediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (!url.startsWith('/uploads/')) return url;
  const token = getToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export function mediaMediumUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/uploads/') || url.includes('/thumbs/') || url.includes('/medium/') || url.includes('/avatars/')) return mediaUrl(url);
  const filename = url.replace('/uploads/', '');
  return mediaUrl(`/uploads/medium/${filename}`);
}

export function mediaThumbUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/uploads/') || url.includes('/thumbs/') || url.includes('/medium/') || url.includes('/avatars/')) return mediaUrl(url);
  const filename = url.replace('/uploads/', '');
  return mediaUrl(`/uploads/thumbs/${filename}`);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

export function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

let _refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = _refreshTokensInner().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

async function _refreshTokensInner(): Promise<boolean> {
  const refresh = localStorage.getItem('refreshToken');
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.data.accessToken, data.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401 && retry) {
    const ok = await refreshTokens();
    if (ok) return request(path, options, false);
    clearTokens();
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

  return res.json() as Promise<T>;
}

type ApiResponse<T> = { success: true; data: T };

export const api = {
  // Auth
  sendOtp: (email: string) =>
    request<ApiResponse<unknown>>('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyOtp: (email: string, code: string, nickname?: string) =>
    request<ApiResponse<{ tokens: { accessToken: string; refreshToken: string }; user: User; isNewUser?: boolean }>>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code, ...(nickname ? { nickname } : {}) }),
    }),

  logout: (refreshToken: string) =>
    request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  // User
  getMe: () => request<ApiResponse<User>>('/users/me'),

  getUser: (userId: string) => request<ApiResponse<User>>(`/users/${userId}`),

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

  getChat: (chatId: string) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}`),

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


  kickMember: (chatId: string, userId: string) =>
    request(`/chats/${chatId}/members/${userId}`, { method: 'DELETE' }),

  addMembers: (chatId: string, userIds: string[]) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),

  pinMessage: (chatId: string, messageId: string | null) =>
    request<ApiResponse<Chat>>(`/chats/${chatId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ messageId }),
    }),

  blockUser: (userId: string) =>
    request(`/users/${userId}/block`, { method: 'POST' }),

  unblockUser: (userId: string) =>
    request(`/users/${userId}/block`, { method: 'DELETE' }),

  getBlockedUsers: () =>
    request<ApiResponse<string[]>>('/users/me/blocked'),

  searchGlobal: (q: string) =>
    request<ApiResponse<any[]>>(`/messages/search?q=${encodeURIComponent(q)}`),

  // Messages
  getMessages: (chatId: string, cursor?: string, q?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (q) params.set('q', q);
    const qs = params.toString();
    return request<ApiResponse<{ messages: Message[]; nextCursor: string | null }>>(
      `/chats/${chatId}/messages${qs ? `?${qs}` : ''}`,
    );
  },

  // Fixed URL: /api/messages/:id not /api/chats/:chatId/messages/:id
  // Accepts either plaintext { text } or encrypted { ciphertext, signalType }
  editMessage: (
    messageId: string,
    payload: { text: string } | { ciphertext: string; signalType: number },
  ) =>
    request<ApiResponse<Message>>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Fixed URL: /api/messages/:id not /api/chats/:chatId/messages/:id
  deleteMessage: (messageId: string, forEveryone = true) =>
    request(`/messages/${messageId}?forEveryone=${forEveryone}`, { method: 'DELETE' }),

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

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ApiResponse<{ url: string }>>('/upload/avatar', {
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
};
