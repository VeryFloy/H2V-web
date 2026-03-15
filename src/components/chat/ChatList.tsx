import { type Component, createSignal, For, Show, onMount, onCleanup, createEffect } from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { wsStore } from '../../stores/ws.store';
import { mutedStore } from '../../stores/muted.store';
import { e2eStore } from '../../stores/e2e.store';
import { uiStore } from '../../stores/ui.store';
import { api, mediaUrl } from '../../api/client';
import type { Chat, User, MessageSearchResult } from '../../types';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import CreateGroupModal from './CreateGroupModal';
import { avatarColor } from '../../utils/avatar';
import styles from './ChatList.module.css';

interface Props { onProfileClick?: () => void; onSettingsClick?: () => void; }

const ChatList: Component<Props> = (props) => {
  const t = i18n.t;

  const networkTitle = () => {
    if (wsStore.connected()) return t('chats.title');
    if (wsStore.connecting()) return t('chats.connecting');
    return t('chats.waiting_network');
  };

  const titleClass = () => {
    if (wsStore.connecting()) return `${styles.title} ${styles.titleConnecting}`;
    if (!wsStore.connected()) return `${styles.title} ${styles.titleOffline}`;
    return styles.title;
  };

  const [search, setSearch] = createSignal('');
  const [archiveMode, setArchiveMode] = createSignal(false);
  const [showGroupModal, setShowGroupModal] = createSignal(false);
  const [showNewMenu, setShowNewMenu] = createSignal(false);
  const [showSecretModal, setShowSecretModal] = createSignal(false);
  const [secretSearch, setSecretSearch] = createSignal('');
  const [secretResults, setSecretResults] = createSignal<User[]>([]);
  const [secretBusy, setSecretBusy] = createSignal(false);
  const [showMobileMenu, setShowMobileMenu] = createSignal(false);
  let desktopMenuRef: HTMLDivElement | undefined;
  let fabMenuRef: HTMLDivElement | undefined;
  let mobileMenuRef: HTMLDivElement | undefined;
  let secretSearchTimer = 0;


  function closeNewMenu() { setShowNewMenu(false); }

  createEffect(() => {
    if (!showNewMenu()) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (desktopMenuRef?.contains(t) || fabMenuRef?.contains(t)) return;
      closeNewMenu();
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  createEffect(() => {
    if (!showMobileMenu()) return;
    const handler = (e: MouseEvent) => {
      if (mobileMenuRef?.contains(e.target as Node)) return;
      setShowMobileMenu(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  function handleSecretSearch(q: string) {
    setSecretSearch(q);
    clearTimeout(secretSearchTimer);
    if (!q.trim()) { setSecretResults([]); return; }
    secretSearchTimer = window.setTimeout(async () => {
      try {
        const res = await api.searchUsers(q.trim());
        setSecretResults((res.data as User[]) ?? []);
      } catch { setSecretResults([]); }
    }, 300);
  }

  const [secretError, setSecretError] = createSignal('');

  async function startSecret(userId: string) {
    setSecretBusy(true);
    setSecretError('');
    try {
      await chatStore.startSecretChat(userId);
      setShowSecretModal(false);
      setSecretSearch('');
      setSecretResults([]);
    } catch (err: any) {
      console.error('[ChatList] startSecret failed:', err);
      setSecretError(err?.message || t('error.generic') || 'Error');
    } finally { setSecretBusy(false); }
  }

  function openSecretModal() {
    closeNewMenu();
    setSecretSearch('');
    setSecretResults([]);
    setSecretError('');
    setShowSecretModal(true);
  }

  const [ctxMenu, setCtxMenu] = createSignal<{ chatId: string; x: number; y: number } | null>(null);
  const [archiveRowCtx, setArchiveRowCtx] = createSignal<{ x: number; y: number } | null>(null);

  function closeCtxMenu() { setCtxMenu(null); }

  function openCtxMenu(e: MouseEvent, chatId: string) {
    e.preventDefault();
    e.stopPropagation();
    try { navigator.vibrate?.(10); } catch {}
    const menuW = 210;
    const menuH = 180;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ chatId, x, y });
  }

  onMount(() => {
    chatStore.loadArchivedChats();
    function onDocClick() { closeCtxMenu(); setArchiveRowCtx(null); }
    document.addEventListener('click', onDocClick);
    onCleanup(() => {
      document.removeEventListener('click', onDocClick);
      clearTimeout(debounceTimer);
      clearTimeout(secretSearchTimer);
    });
  });

  function toggleMute(chatId: string) {
    mutedStore.toggle(chatId);
    closeCtxMenu();
  }

  function markUnread(chatId: string) {
    chatStore.incrementUnread(chatId);
    closeCtxMenu();
  }

  function markRead(chatId: string) {
    chatStore.clearUnread(chatId);
    closeCtxMenu();
  }

  const [pendingDeleteChatId, setPendingDeleteChatId] = createSignal<string | null>(null);

  async function deleteChat(chatId: string) {
    closeCtxMenu();
    setPendingDeleteChatId(chatId);
  }

  async function confirmDeleteChat() {
    const chatId = pendingDeleteChatId();
    if (!chatId) return;
    setPendingDeleteChatId(null);
    try {
      await api.leaveChat(chatId);
      chatStore.removeChat(chatId);
      if (uiStore.viewingGroupId() === chatId) uiStore.closeGroupProfile();
    } catch (e) {
      console.error('[ChatList] deleteChat:', e);
    }
  }

  const [searchResults, setSearchResults] = createSignal<User[]>([]);
  const [globalResults, setGlobalResults] = createSignal<MessageSearchResult[]>([]);
  const [searching, setSearching] = createSignal(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

  async function handleSearch(q: string) {
    setSearch(q);
    clearTimeout(debounceTimer);
    if (!q.trim()) { setSearchResults([]); setGlobalResults([]); return; }
    debounceTimer = setTimeout(async () => {
      setSearching(true);
      try {
        const [usersRes, msgsRes] = await Promise.all([
          api.searchUsers(q.trim()),
          api.searchGlobal(q.trim()),
        ]);
        const me = authStore.user();
        setSearchResults((usersRes.data ?? []).filter((u) => u.id !== me?.id));
        setGlobalResults(msgsRes.data ?? []);
      } catch {
        setSearchResults([]);
        setGlobalResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function openDirect(userId: string) {
    try {
      await chatStore.startDirectChat(userId);
      setSearch('');
      setSearchResults([]);
    } catch (e) {
      console.error('[ChatList] openDirect:', e);
    }
  }

  function getChatPartner(chat: Chat): User | null {
    const me = authStore.user();
    return chat.members.find((m) => m.user.id !== me?.id)?.user ?? null;
  }

  function getChatName(chat: Chat): string {
    if (chat.type === 'SELF') return i18n.t('sidebar.saved_messages');
    if (chat.type === 'DIRECT' || chat.type === 'SECRET') return displayName(getChatPartner(chat));
    return chat.name ?? i18n.t('common.group');
  }

  function getChatAvatar(chat: Chat): string | null {
    if (chat.type === 'SELF') return null;
    if (chat.type === 'DIRECT' || chat.type === 'SECRET') return getChatPartner(chat)?.avatar ?? null;
    return chat.avatar;
  }

  function getChatColorId(chat: Chat): string {
    if (chat.type === 'DIRECT' || chat.type === 'SECRET') return getChatPartner(chat)?.id ?? chat.id;
    return chat.id;
  }

  function isOnline(chat: Chat): boolean {
    const partner = getChatPartner(chat);
    return partner ? chatStore.onlineIds().has(partner.id) : false;
  }

  function getPreview(chat: Chat): { text: string; mine: boolean; isDraft: boolean } {
    const me = authStore.user();

    const typingUsers = chatStore.typing[chat.id] ?? [];
    const othersTyping = typingUsers.filter((uid) => uid !== me?.id);
    if (othersTyping.length > 0) {
      return { text: t('chats.typing'), mine: false, isDraft: false };
    }

    if (chat.draft?.text && chatStore.activeChatId() !== chat.id) {
      return { text: chat.draft.text, mine: false, isDraft: true };
    }

    const msg = chat.lastMessage;
    if (!msg) return { text: t('chats.no_messages'), mine: false, isDraft: false };
    if (msg.isDeleted) return { text: t('chats.deleted'), mine: false, isDraft: false };

    const mine = msg.sender?.id === me?.id;

    let prefix = '';
    if (mine) {
      prefix = t('chats.you');
    } else if (chat.type === 'GROUP' && msg.sender) {
      const senderName = msg.sender.firstName ?? msg.sender.nickname;
      prefix = `${senderName}: `;
    }

    if (msg.type === 'SYSTEM') return { text: t('grp.system_event') ?? '•', mine: false, isDraft: false };
    if (!msg.text && msg.type && msg.type !== 'TEXT') {
      const mediaLabels: Record<string, string> = {
        IMAGE: i18n.t('chats.media_photo'), VIDEO: i18n.t('chats.media_video'), AUDIO: i18n.t('chats.media_audio'), FILE: i18n.t('chats.media_file'),
      };
      return { text: prefix + (mediaLabels[msg.type] ?? i18n.t('common.media')), mine, isDraft: false };
    }
    if (!msg.text && msg.ciphertext) {
      const decrypted = e2eStore.getDecryptedText(msg.id);
      return { text: prefix + (decrypted ?? t('chats.encrypted')), mine, isDraft: false };
    }

    return { text: prefix + (msg.text ?? ''), mine, isDraft: false };
  }

  function formatTime(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const loc = i18n.locale();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return t('chats.yesterday');
    return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  }

  function initials(name: string): string {
    return name[0]?.toUpperCase() ?? '?';
  }

  function getUnread(chatId: string): number {
    return chatStore.unreadCounts[chatId] ?? 0;
  }

  const ctxChat = () => {
    const m = ctxMenu();
    if (!m) return null;
    return chatStore.chats.find((c) => c.id === m.chatId)
      ?? chatStore.archivedChats.find((c) => c.id === m.chatId)
      ?? null;
  };

  // ── Swipe gesture state ──
  const [swipedChatId, setSwipedChatId] = createSignal<string | null>(null);
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeDx = 0;
  let swipeLocked = false;
  let swipeEl: HTMLElement | null = null;
  const SWIPE_THRESHOLD = 60;
  const SWIPE_MAX = 150;

  function onSwipeTouchStart(e: TouchEvent, chatId: string) {
    if (swipedChatId() && swipedChatId() !== chatId) {
      resetSwipe();
    }
    const t = e.touches[0];
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    swipeDx = 0;
    swipeLocked = false;
    swipeEl = e.currentTarget as HTMLElement;
    const inner = swipeEl.querySelector('[data-swipe-inner]') as HTMLElement;
    if (inner) inner.style.transition = 'none';
  }

  function onSwipeTouchMove(e: TouchEvent) {
    if (!swipeEl) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    if (!swipeLocked && Math.abs(dy) > Math.abs(dx)) {
      swipeEl = null;
      return;
    }
    swipeLocked = true;
    swipeDx = Math.max(-SWIPE_MAX, Math.min(0, dx));
    const inner = swipeEl.querySelector('[data-swipe-inner]') as HTMLElement;
    if (inner) inner.style.transform = `translateX(${swipeDx}px)`;
  }

  function onSwipeTouchEnd(_e: TouchEvent, chatId: string) {
    if (!swipeEl) return;
    const inner = swipeEl.querySelector('[data-swipe-inner]') as HTMLElement;
    if (inner) inner.style.transition = 'transform 0.25s cubic-bezier(0.25,1,0.5,1)';
    if (swipeDx < -SWIPE_THRESHOLD) {
      if (inner) inner.style.transform = `translateX(-${SWIPE_MAX}px)`;
      try { navigator.vibrate?.(10); } catch {}
      setSwipedChatId(chatId);
    } else {
      if (inner) inner.style.transform = 'translateX(0)';
      setSwipedChatId(null);
    }
    swipeEl = null;
  }

  function resetSwipe() {
    const prev = swipedChatId();
    if (!prev) return;
    const el = document.querySelector(`[data-chat-swipe="${prev}"]`);
    if (el) {
      const inner = el.querySelector('[data-swipe-inner]') as HTMLElement;
      if (inner) {
        inner.style.transition = 'transform 0.25s cubic-bezier(0.25,1,0.5,1)';
        inner.style.transform = 'translateX(0)';
      }
    }
    setSwipedChatId(null);
  }

  function swipeAction(chatId: string, action: 'mute' | 'read' | 'delete' | 'archive') {
    resetSwipe();
    if (action === 'mute') mutedStore.toggle(chatId);
    else if (action === 'read') {
      if ((chatStore.unreadCounts[chatId] ?? 0) > 0) chatStore.clearUnread(chatId);
      else chatStore.incrementUnread(chatId);
    }
    else if (action === 'archive') chatStore.archiveChat(chatId, true).catch(() => {});
    else if (action === 'delete') deleteChat(chatId);
  }

  return (
    <div class={styles.wrap}>
      <div class={styles.mobileBar}>
        <button class={styles.mobileProfileBtn} onClick={() => props.onProfileClick?.()} title={t('sidebar.profile')}>
          <Show when={authStore.user()?.avatar} fallback={
            <span class={styles.mobileAvatarLetter}>{displayName(authStore.user())[0]?.toUpperCase()}</span>
          }>
            <img src={mediaUrl(authStore.user()!.avatar)} alt="" />
          </Show>
        </button>
        <div class={styles.mobileSearchWrap}>
          <svg class={styles.mobileSearchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input
            class={styles.mobileSearchInput}
            type="text"
            placeholder={t('chats.search')}
            value={search()}
            onInput={(e) => handleSearch(e.currentTarget.value)}
          />
          <Show when={search()}>
            <button class={styles.mobileSearchClear} onClick={() => { setSearch(''); setSearchResults([]); setGlobalResults([]); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            </button>
          </Show>
        </div>
        <div class={styles.mobileActions} ref={mobileMenuRef!}>
          <button class={styles.mobileMenuBtn} onClick={() => setShowMobileMenu((v) => !v)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
          <Show when={showMobileMenu()}>
            <div class={styles.mobileMenuDrop}>
              <button onClick={() => {
                setShowMobileMenu(false);
                chatStore.openSavedMessages().catch(() => {});
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {t('sidebar.saved_messages')}
              </button>
              <button onClick={() => {
                setShowMobileMenu(false);
                chatStore.loadArchivedChats();
                uiStore.openArchive();
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="3" width="20" height="5" rx="1" stroke="currentColor" stroke-width="2"/>
                  <path d="M4 8v10a2 2 0 002 2h12a2 2 0 002-2V8" stroke="currentColor" stroke-width="2"/>
                  <path d="M10 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                {t('sidebar.archive')}
              </button>
              <div class={styles.mobileMenuDivider} />
              <button onClick={() => {
                setShowMobileMenu(false);
                props.onSettingsClick?.();
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {t('sidebar.settings')}
              </button>
            </div>
          </Show>
        </div>
      </div>

      <Show when={!uiStore.chatSearchOpen() && !archiveMode()}>
        <div class={styles.header}>
          <div class={styles.headerRow}>
            <span class={titleClass()}>{networkTitle()}</span>
            <div class={styles.newMenuWrap} ref={desktopMenuRef!}>
              <button
                class={styles.newGroupBtn}
                onClick={() => setShowNewMenu((v) => !v)}
                title={t('chats.new_chat')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <Show when={showNewMenu()}>
                <div class={styles.newMenu}>
                  <button class={styles.newMenuItem} onClick={() => { closeNewMenu(); setShowGroupModal(true); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                      <line x1="19" y1="8" x2="19" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      <line x1="22" y1="11" x2="16" y2="11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    {t('chats.new_group')}
                  </button>
                  <button class={styles.newMenuItem} onClick={openSecretModal}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/>
                      <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    {t('chat.create_secret')}
                  </button>
                </div>
              </Show>
            </div>
          </div>
          <input
            class={styles.search}
            type="text"
            placeholder={t('chats.search')}
            value={search()}
            onInput={(e) => handleSearch(e.currentTarget.value)}
          />
        </div>
      </Show>
      <Show when={uiStore.chatSearchOpen()}>
        <div class={styles.searchResultsHeader}>
          <button class={styles.searchResultsBack} onClick={() => {
            uiStore.setChatSearchOpen(false);
            uiStore.setChatSearchQ('');
            uiStore.setChatSearchResults([]);
            uiStore.setChatSearchIdx(-1);
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class={styles.searchResultsTitle}>{t('msg.search_results')}</span>
          <span class={styles.searchResultsCount}>
            <Show when={uiStore.chatSearchResults().length > 0}>
              {uiStore.chatSearchIdx() >= 0 ? uiStore.chatSearchIdx() + 1 : '—'} / {uiStore.chatSearchResults().length}
            </Show>
          </span>
        </div>
      </Show>

      <Show when={search().trim()}>
        <div class={styles.list}>
          <Show when={searching()}>
            <div class={styles.hint}>{t('chats.searching')}</div>
          </Show>
          <Show when={!searching() && searchResults().length === 0}>
            <div class={styles.hint}>{t('chats.no_results')}</div>
          </Show>
          <For each={searchResults()}>
            {(u) => (
              <div class={styles.searchItem} onClick={() => openDirect(u.id)}>
                <div class={styles.avatarWrap}>
                  <div class={styles.avatar}>
                    <Show when={u.avatar} fallback={<span>{initials(displayName(u))}</span>}>
                      <img src={mediaUrl(u.avatar)} alt="" />
                    </Show>
                  </div>
                  <Show when={chatStore.onlineIds().has(u.id)}>
                    <div class={styles.onlineDot} />
                  </Show>
                </div>
                <div>
                  <div class={styles.searchName}>{displayName(u)}</div>
                  <div class={styles.searchUsername}>@{u.nickname}</div>
                  <div class={styles.startChat}>{t('chats.start')}</div>
                </div>
              </div>
            )}
          </For>
          <Show when={globalResults().length > 0}>
            <div class={styles.globalSearchLabel}>{t('msg.search')} — {t('chats.title')}</div>
            <For each={globalResults()}>
              {(msg) => (
                <div
                  class={styles.searchItem}
                  onClick={() => {
                    chatStore.openChat(msg.chatId);
                    setSearch('');
                    setSearchResults([]);
                    setGlobalResults([]);
                  }}
                >
                  <div class={styles.avatarWrap}>
                    <div class={styles.avatar}>
                      <span style="font-size:11px">💬</span>
                    </div>
                  </div>
                  <div style="min-width:0;flex:1">
                    <div class={styles.searchName}>{msg.chat?.name ?? msg.sender?.nickname ?? ''}</div>
                    <div class={styles.searchUsername} style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                      {msg.sender?.nickname}: {msg.text}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      {/* Chat search results (replaces chat list when active) */}
      <Show when={uiStore.chatSearchOpen() && (uiStore.chatSearchResults().length > 0 || uiStore.chatSearchLoading() || uiStore.chatSearchQ().trim())}>
        <div class={styles.list}>
          <Show when={uiStore.chatSearchLoading()}>
            <div class={styles.hint} style="display:flex;align-items:center;justify-content:center;gap:8px">
              <div class={styles.searchSpinner} />
              {t('chats.searching')}
            </div>
          </Show>
          <Show when={!uiStore.chatSearchLoading() && uiStore.chatSearchResults().length === 0 && uiStore.chatSearchQ().trim()}>
            <div class={styles.hint}>{t('msg.not_found')}</div>
          </Show>
          <For each={uiStore.chatSearchResults()}>
            {(msg, idx) => {
              const msgText = () => msg.text ?? e2eStore.getDecryptedText(msg.id) ?? t('common.media');
              const d = new Date(msg.createdAt);
              const dateStr = d.toLocaleDateString(i18n.locale(), { day: 'numeric', month: 'short' });
              const timeStr = d.toLocaleTimeString(i18n.locale(), { hour: '2-digit', minute: '2-digit' });
              return (
                <div
                  class={`${styles.searchResultItem} ${idx() === uiStore.chatSearchIdx() ? styles.searchResultActive : ''}`}
                  onClick={() => uiStore.selectSearchResult(idx())}
                >
                  <div class={styles.searchResultAvatar} style={{ background: avatarColor(msg.sender?.id ?? '') }}>
                    <Show when={msg.sender?.avatar} fallback={
                      <span>{(displayName(msg.sender) || '?')[0]?.toUpperCase()}</span>
                    }>
                      <img src={mediaUrl(msg.sender!.avatar)} alt="" />
                    </Show>
                  </div>
                  <div class={styles.searchResultInfo}>
                    <div class={styles.searchResultRow1}>
                      <span class={styles.searchResultName}>{displayName(msg.sender) || msg.sender?.nickname}</span>
                      <span class={styles.searchResultTime}>{dateStr}, {timeStr}</span>
                    </div>
                    <div class={styles.searchResultText}>{msgText()}</div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={!search().trim() && !uiStore.chatSearchOpen()}>
        <div class={styles.list}>
          {/* Archive entry row (Telegram-style) */}
          <Show when={!archiveMode() && uiStore.archiveVisibleInList() && chatStore.archivedChats.length > 0}>
            <div
              class={styles.archiveRow}
              onClick={() => setArchiveMode(true)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setArchiveRowCtx({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 120) });
              }}
            >
              <div class={styles.archiveRowIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="3" width="20" height="5" rx="1" stroke="currentColor" stroke-width="2"/>
                  <path d="M4 8v10a2 2 0 002 2h12a2 2 0 002-2V8" stroke="currentColor" stroke-width="2"/>
                  <path d="M10 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <div class={styles.archiveRowInfo}>
                <span class={styles.archiveRowTitle}>{t('sidebar.archive')}</span>
                <span class={styles.archiveRowPreview}>
                  {chatStore.archivedChats.slice(0, 3).map((c) => getChatName(c)).join(', ')}
                  {chatStore.archivedChats.length > 3 ? '...' : ''}
                </span>
              </div>
              <span class={styles.archiveRowBadge}>{chatStore.archivedChats.length}</span>
            </div>
          </Show>

          {/* Archive mode: back header */}
          <Show when={archiveMode()}>
            <div class={styles.archiveHeader}>
              <button class={styles.archiveBack} onClick={() => setArchiveMode(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <span class={styles.archiveHeaderTitle}>{t('sidebar.archive')}</span>
              <span class={styles.archiveHeaderCount}>{chatStore.archivedChats.length}</span>
            </div>
          </Show>

          <For
            each={archiveMode() ? chatStore.archivedChats : chatStore.chats}
            fallback={<div class={styles.hint}>{archiveMode() ? t('chats.archive_empty') : t('chats.empty')}</div>}
          >
            {(chat) => {
              const preview = () => getPreview(chat);
              const unread = () => getUnread(chat.id);
              const isMuted = () => mutedStore.isMuted(chat.id);
              const isTypingNow = () => {
                const me = authStore.user();
                return (chatStore.typing[chat.id] ?? []).some((uid) => uid !== me?.id);
              };
              const showOnlineChip = () =>
                (chat.type === 'DIRECT' || chat.type === 'SECRET') && isOnline(chat) && !isTypingNow();

              return (
                <div
                  class={`${styles.swipeWrap} ${swipedChatId() === chat.id ? styles.swipedVisible : ''}`}
                  data-chat-swipe={chat.id}
                  onTouchStart={(e) => onSwipeTouchStart(e, chat.id)}
                  onTouchMove={onSwipeTouchMove}
                  onTouchEnd={(e) => onSwipeTouchEnd(e, chat.id)}
                >
                  <div
                    class={`${styles.item} ${chatStore.activeChatId() === chat.id ? styles.active : ''} ${isMuted() ? styles.muted : ''}`}
                    data-swipe-inner
                    onClick={() => { if (!swipedChatId()) chatStore.openChat(chat.id); else resetSwipe(); }}
                    onContextMenu={(e) => openCtxMenu(e, chat.id)}
                  >
                    <div class={styles.avatarWrap}>
                      <div class={`${styles.avatar} ${chat.type === 'GROUP' ? styles.groupAvatar : ''} ${chat.type === 'SELF' ? styles.selfAvatar : ''}`} style={!getChatAvatar(chat) ? { background: chat.type === 'SELF' ? 'linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%)' : avatarColor(getChatColorId(chat)) } : undefined}>
                        <Show when={getChatAvatar(chat)} fallback={
                          <Show when={chat.type === 'SELF'} fallback={
                            <Show when={chat.type === 'GROUP'} fallback={
                              <span>{initials(getChatName(chat))}</span>
                            }>
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                              </svg>
                            </Show>
                          }>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                          </Show>
                        }>
                          <img src={mediaUrl(getChatAvatar(chat))} alt="" />
                        </Show>
                      </div>
                      <Show when={(chat.type === 'DIRECT' || chat.type === 'SECRET') && isOnline(chat)}>
                        <div class={styles.onlineDot} />
                      </Show>
                      <Show when={chat.type === 'GROUP'}>
                        <div class={styles.groupBadge} title={`${chat.members.length} ${i18n.t('msg.members')}`}>
                          {chat.members.length}
                        </div>
                      </Show>
                    </div>
                    <div class={styles.info}>
                      <div class={styles.row1}>
                        <span class={styles.name}>
                          <Show when={chat.type === 'SECRET'}>
                            <svg style="display:inline;vertical-align:-2px;margin-right:4px;color:#a78bfa" width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2.5"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                          </Show>
                          {getChatName(chat)}
                        </span>
                        <div class={styles.metaIcons}>
                          <Show when={isMuted()}>
                            <svg class={styles.muteIcon} width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                              <path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                              <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                          </Show>
                          <span class={styles.time}>{formatTime(chat.lastMessage?.createdAt)}</span>
                        </div>
                      </div>
                      <div class={styles.row2}>
                        <span class={styles.previewLine}>
                          <span class={`${styles.onlineChip} ${showOnlineChip() ? styles.onlineChipVisible : ''}`}>
                            {t('chats.online')}<span class={styles.chipSep}>·</span>
                          </span>
                          <Show when={preview().isDraft}>
                            <span class={styles.previewDraft}>{t('chats.draft')}: </span>
                          </Show>
                          <span class={`${styles.previewText} ${
                            isTypingNow() ? styles.previewTyping
                            : preview().isDraft ? styles.previewDraftText
                            : preview().mine ? styles.previewMine
                            : ''
                          }`}>
                            {preview().text}
                          </span>
                        </span>
                        <Show when={unread() > 0}>
                          <span class={`${styles.badge} ${isMuted() ? styles.badgeMuted : ''}`}>
                            {unread() > 99 ? '99+' : unread()}
                          </span>
                        </Show>
                        <Show when={chatStore.isChatPinned(chat.id)}>
                          <svg class={styles.pinBadge} width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M15 4.5l-4 4L7 10l-1.5 1.5 3 3-4.5 5 5-4.5 3 3L13.5 17l1.5-4 4-4" fill="var(--text-tertiary)" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                        </Show>
                      </div>
                    </div>
                  </div>
                  <div class={styles.swipeActions}>
                    <button
                      class={styles.swipeActionRead}
                      onClick={() => swipeAction(chat.id, 'read')}
                    >
                      <Show when={(chatStore.unreadCounts[chat.id] ?? 0) > 0} fallback={
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>
                      }>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      </Show>
                    </button>
                    <button
                      class={styles.swipeActionMute}
                      onClick={() => swipeAction(chat.id, 'mute')}
                    >
                      <Show when={isMuted()} fallback={
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      }>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      </Show>
                    </button>
                    <button
                      class={styles.swipeActionDelete}
                      onClick={() => swipeAction(chat.id, 'delete')}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={showGroupModal()}>
        <CreateGroupModal onClose={() => setShowGroupModal(false)} />
      </Show>

      {/* ── Secret Chat User Picker — style ── */}
      <Show when={showSecretModal()}>
        <div class={styles.secretModalOverlay} onClick={() => setShowSecretModal(false)}>
          <div class={styles.secretModal} onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div class={styles.secretModalHeader}>
              <button class={styles.secretModalBack} onClick={() => setShowSecretModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <div class={styles.secretModalTitleBlock}>
                <span class={styles.secretModalTitle}>{t('chat.create_secret')}</span>
              </div>
            </div>

            {/* Search */}
            <div class={styles.secretModalSearchWrap}>
              <svg class={styles.secretModalSearchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <input
                class={styles.secretModalSearchInput}
                placeholder={t('chats.search_user')}
                value={secretSearch()}
                onInput={(e) => handleSecretSearch(e.currentTarget.value)}
                autofocus
              />
              <Show when={secretSearch()}>
                <button class={styles.secretModalClear} onClick={() => { setSecretSearch(''); setSecretResults([]); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                </button>
              </Show>
            </div>

            {/* Error display */}
            <Show when={secretError()}>
              <div style={{ padding: '8px 14px', color: '#ef4444', 'font-size': '13px', background: 'rgba(239,68,68,0.08)', 'border-radius': '8px', margin: '6px 12px 0' }}>
                {secretError()}
              </div>
            </Show>

            {/* User list */}
            <div class={styles.secretModalList}>
              <Show when={!secretSearch().trim()}>
                <div class={styles.secretModalHint}>
                  <div class={styles.secretModalHintIcon}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.8"/><path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                  </div>
                  <span>{t('chats.search_user')}</span>
                </div>
              </Show>
              <Show when={secretSearch().trim() && secretResults().length === 0}>
                <div class={styles.secretModalHint}>
                  <div class={styles.secretModalHintIcon}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/></svg>
                  </div>
                  <span>{t('chats.no_users')}</span>
                </div>
              </Show>
              <For each={secretResults()}>
                {(user) => (
                  <button
                    class={styles.secretModalUser}
                    onClick={() => startSecret(user.id)}
                    disabled={secretBusy()}
                  >
                    <div class={styles.secretModalAvatar} style={`background:${avatarColor(user.id)}`}>
                      <Show when={user.avatar} fallback={<span>{displayName(user)[0]?.toUpperCase()}</span>}>
                        <img src={mediaUrl(user.avatar)} alt="" />
                      </Show>
                    </div>
                    <div class={styles.secretModalUserInfo}>
                      <span class={styles.secretModalUserName}>{displayName(user)}</span>
                      <span class={styles.secretModalUserNick}>@{user.nickname}</span>
                    </div>
                    <svg class={styles.secretModalUserArrow} width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show when={ctxMenu()}>
        <Portal>
          <div
            style="position:fixed;inset:0;z-index:8000;"
            onClick={(e) => { e.stopPropagation(); closeCtxMenu(); }}
            onContextMenu={(e) => { e.preventDefault(); closeCtxMenu(); }}
          />
          <div
            class={styles.ctxMenu}
            style={{ top: ctxMenu()!.y + 'px', left: ctxMenu()!.x + 'px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => {
              const cid = ctxMenu()!.chatId;
              const pinned = chatStore.isChatPinned(cid);
              closeCtxMenu();
              chatStore.togglePinChat(cid, !pinned).catch(() => {});
            }}>
              <Show when={chatStore.isChatPinned(ctxMenu()!.chatId)} fallback={
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M15 4.5l-4 4L7 10l-1.5 1.5 3 3-4.5 5 5-4.5 3 3L13.5 17l1.5-4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  {t('chats.pin')}
                </>
              }>
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M15 4.5l-4 4L7 10l-1.5 1.5 3 3-4.5 5 5-4.5 3 3L13.5 17l1.5-4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </svg>
                  {t('chats.unpin')}
                </>
              </Show>
            </button>

            <button onClick={() => toggleMute(ctxMenu()!.chatId)}>
              <Show when={mutedStore.isMuted(ctxMenu()!.chatId)} fallback={
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  {t('chats.mute')}
                </>
              }>
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  {t('chats.unmute')}
                </>
              </Show>
            </button>

            <Show when={(chatStore.unreadCounts[ctxMenu()!.chatId] ?? 0) > 0} fallback={
              <button onClick={() => markUnread(ctxMenu()!.chatId)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
                  <circle cx="12" cy="12" r="4" fill="currentColor"/>
                </svg>
                {t('chats.mark_unread')}
              </button>
            }>
              <button onClick={() => markRead(ctxMenu()!.chatId)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {t('chats.mark_read')}
              </button>
            </Show>

            <Show when={archiveMode()} fallback={
              <button onClick={() => {
                const cid = ctxMenu()!.chatId;
                closeCtxMenu();
                chatStore.archiveChat(cid, true).catch(() => {});
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="3" width="20" height="5" rx="1" stroke="currentColor" stroke-width="2"/>
                  <path d="M4 8v10a2 2 0 002 2h12a2 2 0 002-2V8" stroke="currentColor" stroke-width="2"/>
                  <path d="M10 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                {t('chats.archive')}
              </button>
            }>
              <button onClick={() => {
                const cid = ctxMenu()!.chatId;
                closeCtxMenu();
                chatStore.unarchiveChat(cid).catch(() => {});
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="3" width="20" height="5" rx="1" stroke="currentColor" stroke-width="2"/>
                  <path d="M4 8v10a2 2 0 002 2h12a2 2 0 002-2V8" stroke="currentColor" stroke-width="2"/>
                  <path d="M10 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                {t('chats.unarchive')}
              </button>
            </Show>

            <div class={styles.ctxDivider} />

            <Show when={ctxChat()}>
              {(c) => (
                <button
                  class={styles.ctxDanger}
                  onClick={() => deleteChat(c().id)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <Show when={c().type === 'GROUP'} fallback={
                      <><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></>
                    }>
                      <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></>
                    </Show>
                  </svg>
                  {c().type === 'GROUP' ? t('chats.leave_group') : t('chats.delete')}
                </button>
              )}
            </Show>
          </div>
        </Portal>
      </Show>

      {/* ── Archive row context menu ── */}
      <Show when={archiveRowCtx()}>
        <Portal>
          <div
            style="position:fixed;inset:0;z-index:8000;"
            onClick={() => setArchiveRowCtx(null)}
            onContextMenu={(e) => { e.preventDefault(); setArchiveRowCtx(null); }}
          />
          <div
            class={styles.ctxMenu}
            style={{ top: archiveRowCtx()!.y + 'px', left: archiveRowCtx()!.x + 'px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => {
              uiStore.setArchiveVisibleInList(false);
              setArchiveRowCtx(null);
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              {t('archive.hide_from_list')}
            </button>
            <button onClick={() => {
              for (const c of chatStore.archivedChats) chatStore.clearUnread(c.id);
              setArchiveRowCtx(null);
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              {t('archive.mark_all_read')}
            </button>
          </div>
        </Portal>
      </Show>

      {/* ── Mobile FAB (style) ── */}
      <div class={styles.fab} ref={fabMenuRef!}>
        <Show when={showNewMenu()}>
          <div class={styles.fabOverlay} onClick={closeNewMenu} />
          <div class={styles.fabMenu}>
            <button class={styles.fabMenuItem} onClick={() => { closeNewMenu(); setShowGroupModal(true); }}>
              <div class={styles.fabMenuIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                  <line x1="19" y1="8" x2="19" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <line x1="22" y1="11" x2="16" y2="11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <span>{t('chats.new_group')}</span>
            </button>
            <button class={styles.fabMenuItem} onClick={() => { closeNewMenu(); openSecretModal(); }}>
              <div class={styles.fabMenuIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <span>{t('chat.create_secret')}</span>
            </button>
          </div>
        </Show>
        <button
          class={`${styles.fabBtn} ${showNewMenu() ? styles.fabBtnActive : ''}`}
          onClick={() => setShowNewMenu((v) => !v)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <Show when={pendingDeleteChatId()}>
        <Portal>
          <div class={styles.secretOverlay} onClick={() => setPendingDeleteChatId(null)}>
            <div class={styles.secretModal} onClick={(e) => e.stopPropagation()}>
              <div class={styles.secretTitle}>{t('chats.delete')}</div>
              <p style={{ color: 'var(--text-secondary)', 'font-size': '0.9rem', 'margin-bottom': '1rem' }}>{t('settings.confirm_delete') || 'Are you sure?'}</p>
              <div style={{ display: 'flex', gap: '0.5rem', 'justify-content': 'flex-end' }}>
                <button class={styles.secretCancel} onClick={() => setPendingDeleteChatId(null)}>{t('sidebar.cancel')}</button>
                <button class={styles.secretStart} onClick={confirmDeleteChat}>{t('chats.delete')}</button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

export default ChatList;
