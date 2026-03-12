import { createSignal } from 'solid-js';

export type LeftPanel = 'chats' | 'settings' | 'profile';

const [leftPanel, setLeftPanel] = createSignal<LeftPanel>('chats');
const [viewingUserId, setViewingUserId] = createSignal<string | null>(null);

export const uiStore = {
  leftPanel,
  setLeftPanel,

  viewingUserId,
  openUserProfile: (id: string) => setViewingUserId(id),
  closeUserProfile: () => setViewingUserId(null),

  toggleSettings: () => setLeftPanel((p) => (p === 'settings' ? 'chats' : 'settings')),
  openProfile: () => setLeftPanel('profile'),
  backToChats: () => setLeftPanel('chats'),
};
