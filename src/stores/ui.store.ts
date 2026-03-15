import { createSignal } from 'solid-js';
import type { Message } from '../types';

export type LeftPanel = 'chats' | 'settings' | 'profile' | 'archive';

const ARCHIVE_VISIBLE_KEY = 'h2v_archive_in_list';
const [archiveVisibleInList, setArchiveVisibleInList] = createSignal(
  localStorage.getItem(ARCHIVE_VISIBLE_KEY) !== 'false',
);

const [leftPanel, setLeftPanel] = createSignal<LeftPanel>('chats');
const [viewingUserId, setViewingUserId] = createSignal<string | null>(null);
const [viewingGroupId, setViewingGroupId] = createSignal<string | null>(null);

const [chatSearchOpen, setChatSearchOpen] = createSignal(false);
const [chatSearchResults, setChatSearchResults] = createSignal<Message[]>([]);
const [chatSearchIdx, setChatSearchIdx] = createSignal(-1);
const [chatSearchLoading, setChatSearchLoading] = createSignal(false);
const [chatSearchQ, setChatSearchQ] = createSignal('');

let _onSelectResult: ((idx: number) => void) | null = null;

export const uiStore = {
  leftPanel,
  setLeftPanel,

  viewingUserId,
  openUserProfile: (id: string) => {
    setViewingGroupId(null);
    setViewingUserId(id);
  },
  closeUserProfile: () => setViewingUserId(null),

  viewingGroupId,
  openGroupProfile: (chatId: string) => {
    setViewingUserId(null);
    setViewingGroupId(chatId);
  },
  closeGroupProfile: () => setViewingGroupId(null),

  toggleSettings: () => setLeftPanel((p) => (p === 'settings' ? 'chats' : 'settings')),
  openProfile: () => setLeftPanel('profile'),
  backToChats: () => setLeftPanel('chats'),

  chatSearchOpen,
  setChatSearchOpen,
  chatSearchResults,
  setChatSearchResults,
  chatSearchIdx,
  setChatSearchIdx,
  chatSearchLoading,
  setChatSearchLoading,
  chatSearchQ,
  setChatSearchQ,

  archiveVisibleInList,
  setArchiveVisibleInList: (v: boolean) => {
    localStorage.setItem(ARCHIVE_VISIBLE_KEY, String(v));
    setArchiveVisibleInList(v);
  },
  openArchive: () => setLeftPanel('archive'),

  registerSearchResultHandler(fn: (idx: number) => void) { _onSelectResult = fn; },
  selectSearchResult(idx: number) { _onSelectResult?.(idx); },
};
