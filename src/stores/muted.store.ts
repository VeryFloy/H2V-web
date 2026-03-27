import { createSignal } from 'solid-js';
import { api } from '../api/client';

const STORAGE_KEY = 'h2v_muted';

function load(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return new Set<string>();
  }
}

function save(set: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

const [mutedChats, setMutedChats] = createSignal<Set<string>>(load());

function syncFromChats(chats: Array<{ id: string; members: Array<{ userId: string; mutedUntil?: string | null }> }>, myId: string) {
  const muted = new Set<string>();
  for (const chat of chats) {
    const me = chat.members.find((m) => m.userId === myId);
    if (me?.mutedUntil && new Date(me.mutedUntil) > new Date()) {
      muted.add(chat.id);
    }
  }
  setMutedChats(muted);
  save(muted);
}

function toggle(chatId: string) {
  const wasMuted = mutedChats().has(chatId);
  setMutedChats((prev) => {
    const next = new Set(prev);
    if (wasMuted) next.delete(chatId);
    else next.add(chatId);
    save(next);
    return next;
  });
  api.muteChat(chatId, !wasMuted).catch(() => {
    setMutedChats((prev) => {
      const next = new Set(prev);
      if (wasMuted) next.add(chatId);
      else next.delete(chatId);
      save(next);
      return next;
    });
  });
}

function mute(chatId: string) {
  if (mutedChats().has(chatId)) return;
  setMutedChats((prev) => {
    const next = new Set(prev);
    next.add(chatId);
    save(next);
    return next;
  });
  api.muteChat(chatId, true).catch(() => {
    setMutedChats((prev) => {
      const next = new Set(prev);
      next.delete(chatId);
      save(next);
      return next;
    });
  });
}

function unmute(chatId: string) {
  if (!mutedChats().has(chatId)) return;
  setMutedChats((prev) => {
    const next = new Set(prev);
    next.delete(chatId);
    save(next);
    return next;
  });
  api.muteChat(chatId, false).catch(() => {
    setMutedChats((prev) => {
      const next = new Set(prev);
      next.add(chatId);
      save(next);
      return next;
    });
  });
}

function isMuted(chatId: string): boolean {
  return mutedChats().has(chatId);
}

export const mutedStore = { mutedChats, syncFromChats, toggle, mute, unmute, isMuted };
