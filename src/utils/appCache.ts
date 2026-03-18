/**
 * Thin wrapper around localStorage for stale-while-revalidate caching.
 * All methods are silent — quota errors and parse failures are swallowed so
 * caching never breaks the app.
 *
 * Key convention:
 *   h2v_c_me           → User object
 *   h2v_c_chats        → Chat[] array (sorted)
 *   h2v_c_msgs_{id}    → Message[] for a single chat
 *   h2v_c_msgsIndex    → string[] of cached chatIds (LRU order, newest first)
 */

const PREFIX = 'h2v_c_';
const MSGS_INDEX_KEY = 'msgsIndex';
const MAX_CACHED_CHATS = 20; // max number of chats whose messages are cached

export const appCache = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  set<T>(key: string, data: T): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(data));
    } catch {
      // Storage quota exceeded — silently ignore
    }
  },

  delete(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },

  // ── Message cache with LRU eviction ──────────────────────────────────────

  getMsgs(chatId: string) {
    return appCache.get<import('../types').Message[]>(`msgs_${chatId}`);
  },

  setMsgs(chatId: string, msgs: import('../types').Message[]) {
    // Store at most 50 messages per chat (first page is enough for instant render)
    const slice = msgs.slice(-50);
    appCache.set(`msgs_${chatId}`, slice);

    // Update LRU index: move chatId to front, evict oldest if over limit
    const index = appCache.get<string[]>(MSGS_INDEX_KEY) ?? [];
    const next = [chatId, ...index.filter((id) => id !== chatId)];
    if (next.length > MAX_CACHED_CHATS) {
      const evicted = next.splice(MAX_CACHED_CHATS);
      for (const id of evicted) appCache.delete(`msgs_${id}`);
    }
    appCache.set(MSGS_INDEX_KEY, next);
  },

  deleteMsgs(chatId: string) {
    appCache.delete(`msgs_${chatId}`);
    const index = appCache.get<string[]>(MSGS_INDEX_KEY) ?? [];
    appCache.set(MSGS_INDEX_KEY, index.filter((id) => id !== chatId));
  },

  // ── Clear all app cache (on logout) ──────────────────────────────────────

  clearAll() {
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
      for (const k of keys) localStorage.removeItem(k);
    } catch {}
  },
};
