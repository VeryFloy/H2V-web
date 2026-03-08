import { createSignal } from 'solid-js';
import { api, setTokens, clearTokens, getToken } from '../api/client';
import type { User } from '../types';

// Lazy import to avoid circular deps
let _resetChatStore: (() => void) | null = null;
export function registerChatReset(fn: () => void) { _resetChatStore = fn; }

const [user, setUser] = createSignal<User | null>(null);
const [loading, setLoading] = createSignal(true);

async function loadMe() {
  // Если токена нет — сразу не авторизован, без лишнего запроса
  if (!localStorage.getItem('accessToken')) {
    setLoading(false);
    return;
  }
  setLoading(true);
  try {
    const res = await api.getMe();
    setUser(res.data);
  } catch {
    setUser(null);
  } finally {
    setLoading(false);
  }
}

function loginWithTokens(accessToken: string, refreshToken: string, userData: User) {
  setTokens(accessToken, refreshToken);
  setUser(userData);
}

async function logout() {
  const refresh = localStorage.getItem('refreshToken');
  if (refresh) {
    try { await api.logout(refresh); } catch { /* ignore */ }
  }
  clearTokens();
  setUser(null);
  _resetChatStore?.();
}

function updateUserLocally(patch: Partial<User>) {
  setUser((u) => (u ? { ...u, ...patch } : u));
}

export const authStore = {
  user,
  loading,
  loadMe,
  loginWithTokens,
  logout,
  updateUserLocally,
  getToken,
};
