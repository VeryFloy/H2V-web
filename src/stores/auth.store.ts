import { createSignal } from 'solid-js';
import { api, setTokens, clearTokens, getToken } from '../api/client';
import { appCache } from '../utils/appCache';
import type { User } from '../types';

// Lazy import to avoid circular deps
let _resetChatStore: (() => void) | null = null;
export function registerChatReset(fn: () => void) { _resetChatStore = fn; }

// Pre-read from cache synchronously so the spinner never appears on reload
// when the user is already logged in.
const _cachedUser = localStorage.getItem('accessToken')
  ? appCache.get<User>('me')
  : null;

const [user, setUser] = createSignal<User | null>(_cachedUser);
// If we have a cached user we can skip the loading screen entirely
const [loading, setLoading] = createSignal(!_cachedUser && !!localStorage.getItem('accessToken'));

async function loadMe() {
  if (!localStorage.getItem('accessToken')) {
    setLoading(false);
    return;
  }

  // If there's no cached user yet, show a spinner while fetching
  if (!_cachedUser) setLoading(true);

  try {
    const res = await api.getMe();
    setUser(res.data);
    appCache.set('me', res.data);
  } catch {
    // If we had cached data, keep showing it (network may be slow).
    // If nothing was cached, clear user so the login screen appears.
    if (!user()) setUser(null);
  } finally {
    setLoading(false);
  }
}

function loginWithTokens(accessToken: string, refreshToken: string, userData: User) {
  setTokens(accessToken, refreshToken);
  setUser(userData);
  appCache.set('me', userData);
}

async function logout() {
  const refresh = localStorage.getItem('refreshToken');
  if (refresh) {
    try { await api.logout(refresh); } catch { /* ignore */ }
  }
  clearTokens();
  setUser(null);
  appCache.clearAll();
  _resetChatStore?.();
}

function updateUserLocally(patch: Partial<User>) {
  setUser((u) => {
    if (!u) return u;
    const updated = { ...u, ...patch };
    appCache.set('me', updated);
    return updated;
  });
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
