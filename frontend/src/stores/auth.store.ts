import { createSignal } from 'solid-js';
import { api } from '../api/client';
import { appCache } from '../utils/appCache';
import { wsStore } from './ws.store';
import type { User } from '../types';

let _resetChatStore: (() => void) | null = null;
export function registerChatReset(fn: () => void) { _resetChatStore = fn; }

const _cachedUser = appCache.get<User>('me');

const [user, setUser] = createSignal<User | null>(_cachedUser);
const [loading, setLoading] = createSignal(!_cachedUser);

async function loadMe() {
  if (!_cachedUser) setLoading(true);

  try {
    const res = await api.getMe();
    setUser(res.data);
    appCache.set('me', res.data);
  } catch {
    if (!user()) setUser(null);
  } finally {
    setLoading(false);
  }
}

function loginWithUser(userData: User) {
  setUser(userData);
  appCache.set('me', userData);
  wsStore.setReconnectEnabled(true);
}

async function logout() {
  wsStore.setReconnectEnabled(false);
  wsStore.disconnect();
  try { await api.logout(); } catch { /* ignore */ }
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
  loginWithUser,
  logout,
  updateUserLocally,
};
