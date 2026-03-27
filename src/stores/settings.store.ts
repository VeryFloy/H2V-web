import { createSignal } from 'solid-js';
import { request } from '../api/client';
import { i18n, type Locale } from './i18n.store';

import type { PrivacyLevel } from '../types';

export type AutoDeleteMonths = '1' | '3' | '6' | '12' | 'never';

export interface AppSettings {
  notifSound: boolean;
  notifDesktop: boolean;
  sendByEnter: boolean;
  fontSize: 'small' | 'medium' | 'large';
  showOnlineStatus: PrivacyLevel;
  showReadReceipts: PrivacyLevel;
  showAvatar: PrivacyLevel;
  allowGroupInvites: PrivacyLevel;
  mediaAutoDownload: boolean;
  chatWallpaper: 'default' | 'dark' | 'dots' | 'gradient';
  theme: 'dark' | 'light';
  locale?: 'ru' | 'en';
  autoDeleteMonths: AutoDeleteMonths;
  voiceSpeed: 0 | 1 | 2;
}

function migratePrivacy(val: unknown): PrivacyLevel {
  if (val === true) return 'all';
  if (val === false) return 'nobody';
  if (val === 'all' || val === 'contacts' || val === 'nobody') return val;
  return 'all';
}

const DEFAULTS: AppSettings = {
  notifSound: true,
  notifDesktop: true,
  sendByEnter: true,
  fontSize: 'medium',
  showOnlineStatus: 'all',
  showReadReceipts: 'all',
  showAvatar: 'all',
  allowGroupInvites: 'all',
  mediaAutoDownload: true,
  chatWallpaper: 'default',
  theme: 'dark',
  autoDeleteMonths: 'never',
  voiceSpeed: 0,
};

const STORAGE_KEY = 'h2v_settings';

function loadLocal(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = { ...DEFAULTS, ...JSON.parse(raw) };
    parsed.showOnlineStatus = migratePrivacy(parsed.showOnlineStatus);
    parsed.showReadReceipts = migratePrivacy(parsed.showReadReceipts);
    parsed.showAvatar = migratePrivacy(parsed.showAvatar);
    parsed.allowGroupInvites = migratePrivacy(parsed.allowGroupInvites);
    return parsed;
  } catch {
    return { ...DEFAULTS };
  }
}

function persistLocal(s: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'light' ? '#f8fafc' : '#0f1117');
  }
}

const initial = loadLocal();
applyTheme(initial.theme);
if (initial.locale) i18n.setLocale(initial.locale);
const [settings, setSettingsRaw] = createSignal<AppSettings>(initial);

async function loadFromServer() {
  try {
    const res = await request<{ success: boolean; data: Partial<AppSettings> }>('/users/me/settings');
    if (res.data && typeof res.data === 'object') {
      const d = res.data as Record<string, unknown>;
      if ('showOnlineStatus' in d) d.showOnlineStatus = migratePrivacy(d.showOnlineStatus);
      if ('showReadReceipts' in d) d.showReadReceipts = migratePrivacy(d.showReadReceipts);
      if ('showAvatar' in d) d.showAvatar = migratePrivacy(d.showAvatar);
      if ('allowGroupInvites' in d) d.allowGroupInvites = migratePrivacy(d.allowGroupInvites);
      setSettingsRaw((prev) => {
        const merged = { ...prev, ...d } as AppSettings;
        persistLocal(merged);
        if (merged.locale) i18n.setLocale(merged.locale);
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
  }).catch(() => {
    Object.assign(pendingPatch, patch);
  });
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
    if (patch.theme) applyTheme(patch.theme);
    if (patch.locale) i18n.setLocale(patch.locale);
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
  }).catch((err) => {
    if (import.meta.env.DEV) console.warn('[Settings] Failed to reset on server:', err);
  });
}

export const settingsStore = {
  settings,
  updateSettings,
  resetSettings,
  loadFromServer,
};
