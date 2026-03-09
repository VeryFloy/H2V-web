import { createSignal } from 'solid-js';
import { request } from '../api/client';

export interface AppSettings {
  notifSound: boolean;
  notifDesktop: boolean;
  sendByEnter: boolean;
  fontSize: 'small' | 'medium' | 'large';
  showOnlineStatus: boolean;
  showReadReceipts: boolean;
  mediaAutoDownload: boolean;
  chatWallpaper: 'default' | 'dark' | 'dots' | 'gradient';
  locale?: 'ru' | 'en';
}

const DEFAULTS: AppSettings = {
  notifSound: true,
  notifDesktop: true,
  sendByEnter: true,
  fontSize: 'medium',
  showOnlineStatus: true,
  showReadReceipts: true,
  mediaAutoDownload: true,
  chatWallpaper: 'default',
};

const STORAGE_KEY = 'h2v_settings';

function loadLocal(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistLocal(s: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const [settings, setSettingsRaw] = createSignal<AppSettings>(loadLocal());

async function loadFromServer() {
  try {
    const res = await request<{ success: boolean; data: Partial<AppSettings> }>('/users/me/settings');
    if (res.data && typeof res.data === 'object') {
      setSettingsRaw((prev) => {
        const merged = { ...prev, ...res.data };
        persistLocal(merged);
        return merged;
      });
    }
  } catch {
    // Use local fallback
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPatch: Partial<AppSettings> = {};

function flushToServer() {
  if (Object.keys(pendingPatch).length === 0) return;
  const patch = { ...pendingPatch };
  pendingPatch = {};
  request('/users/me/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  }).catch(() => {});
}

function debouncedSaveToServer(patch: Partial<AppSettings>) {
  Object.assign(pendingPatch, patch);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushToServer, 1500);
}

function updateSettings(patch: Partial<AppSettings>) {
  setSettingsRaw((prev) => {
    const next = { ...prev, ...patch };
    persistLocal(next);
    return next;
  });
  debouncedSaveToServer(patch);
}

function resetSettings() {
  setSettingsRaw({ ...DEFAULTS });
  persistLocal(DEFAULTS);
  if (saveTimer) clearTimeout(saveTimer);
  pendingPatch = {};
  request('/users/me/settings', {
    method: 'PUT',
    body: JSON.stringify(DEFAULTS),
  }).catch(() => {});
}

export const settingsStore = {
  settings,
  updateSettings,
  resetSettings,
  loadFromServer,
};
