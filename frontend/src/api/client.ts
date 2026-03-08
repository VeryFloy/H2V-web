import type { User, Chat, Message } from '../types';

const BASE = '/api';

const ERROR_MESSAGES: Record<string, string> = {
  OTP_EXPIRED:        'Код истёк. Запроси новый',
  INVALID_CODE:       'Неверный код',
  OTP_TOO_SOON:       'Подожди немного перед повторной отправкой',
  OTP_MAX_ATTEMPTS:   'Слишком много попыток. Запроси новый код',
  EMAIL_SEND_FAILED:  'Не удалось отправить письмо',
  DISPOSABLE_EMAIL:   'Временные email-адреса не допускаются',
  NICKNAME_REQUIRED:  'Введи никнейм',
  NICKNAME_TAKEN:     'Этот никнейм уже занят',
  EMAIL_INVALID:      'Неверный формат email',
  VALIDATION_ERROR:   'Ошибка валидации',
};

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

export function setTokens(access: string, refresh: string) {
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

export function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

async function refreshTokens(): Promise<boolean> {
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
    window.location.reload();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = body?.error?.code ?? body?.code ?? 'UNKNOWN';
    const msg = ERROR_MESSAGES[code] ?? body?.message ?? body?.error?.message ?? 'Ошибка';
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

  leaveChat: (chatId: string) =>
    request(`/chats/${chatId}/leave`, { method: 'DELETE' }),

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
  editMessage: (messageId: string, text: string) =>
    request<ApiResponse<Message>>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }),

  // Fixed URL: /api/messages/:id not /api/chats/:chatId/messages/:id
  deleteMessage: (messageId: string) =>
    request(`/messages/${messageId}`, { method: 'DELETE' }),

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
};
