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

async function saveToServer(patch: Partial<AppSettings>) {
  try {
    await request('/users/me/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  } catch {
    // Silently fail — local cache is already updated
  }
}

function updateSettings(patch: Partial<AppSettings>) {
  setSettingsRaw((prev) => {
    const next = { ...prev, ...patch };
    persistLocal(next);
    return next;
  });
  saveToServer(patch);
}

function resetSettings() {
  setSettingsRaw({ ...DEFAULTS });
  persistLocal(DEFAULTS);
  saveToServer(DEFAULTS);
}

export const settingsStore = {
  settings,
  updateSettings,
  resetSettings,
  loadFromServer,
};
