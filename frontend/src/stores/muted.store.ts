import { createSignal } from 'solid-js';

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

function toggle(chatId: string) {
  setMutedChats((prev) => {
    const next = new Set(prev);
    if (next.has(chatId)) next.delete(chatId);
    else next.add(chatId);
    save(next);
    return next;
  });
}

function isMuted(chatId: string): boolean {
  return mutedChats().has(chatId);
}

export const mutedStore = { mutedChats, toggle, isMuted };
