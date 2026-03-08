import { type Component, createSignal, For, Show, onMount, onCleanup, createEffect, batch } from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { mutedStore } from '../../stores/muted.store';
import { e2eStore } from '../../stores/e2e.store';
import { api, mediaUrl } from '../../api/client';
import type { Chat, User } from '../../types';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import CreateGroupModal from './CreateGroupModal';
import styles from './ChatList.module.css';

interface Props { onProfileClick?: () => void; onSettingsClick?: () => void; }

const ChatList: Component<Props> = (props) => {
  const t = i18n.t;
  const [search, setSearch] = createSignal('');
  const [showGroupModal, setShowGroupModal] = createSignal(false);
  const [showNewMenu, setShowNewMenu] = createSignal(false);
  const [showSecretModal, setShowSecretModal] = createSignal(false);
  const [secretSearch, setSecretSearch] = createSignal('');
  const [secretResults, setSecretResults] = createSignal<User[]>([]);
  const [secretBusy, setSecretBusy] = createSignal(false);
  let newMenuRef: HTMLDivElement | undefined;
  let secretSearchTimer = 0;

  const AVATAR_COLORS = ['#5b8af5','#7b61ff','#e05c7a','#20c9a6','#f5a623','#c87eff','#3fbdf0'];
  function avatarColor(id: string): string {
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function closeNewMenu() { setShowNewMenu(false); }

  // Close new-menu on outside click
  createEffect(() => {
    if (!showNewMenu()) return;
    const handler = (e: MouseEvent) => {
      if (newMenuRef && !newMenuRef.contains(e.target as Node)) closeNewMenu();
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

  async function startSecret(userId: string) {
    setSecretBusy(true);
    try {
      await chatStore.startSecretChat(userId);
      setShowSecretModal(false);
      setSecretSearch('');
      setSecretResults([]);
    } catch { /* noop */ } finally { setSecretBusy(false); }
  }

  function openSecretModal() {
    closeNewMenu();
    setSecretSearch('');
    setSecretResults([]);
    setShowSecretModal(true);
  }

  const [ctxMenu, setCtxMenu] = createSignal<{ chatId: string; x: number; y: number } | null>(null);

  function closeCtxMenu() { setCtxMenu(null); }

  function openCtxMenu(e: MouseEvent, chatId: string) {
    e.preventDefault();
    e.stopPropagation();
    const menuW = 210;
    const menuH = 180;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ chatId, x, y });
  }

  onMount(() => {
    function onDocClick() { closeCtxMenu(); }
    document.addEventListener('click', onDocClick);
    document.addEventListener('contextmenu', onDocClick);
    onCleanup(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('contextmenu', onDocClick);
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

  async function deleteChat(chatId: string) {
    closeCtxMenu();
    try {
      await api.leaveChat(chatId);
      chatStore.removeChat(chatId);
    } catch (e) {
      console.error('[ChatList] deleteChat:', e);
    }
  }

  const [searchResults, setSearchResults] = createSignal<User[]>([]);
  const [globalResults, setGlobalResults] = createSignal<any[]>([]);
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
    if (chat.type === 'DIRECT' || chat.type === 'SECRET') return displayName(getChatPartner(chat));
    return chat.name ?? i18n.t('common.group');
  }

  function getChatAvatar(chat: Chat): string | null {
    if (chat.type === 'DIRECT' || chat.type === 'SECRET') return getChatPartner(chat)?.avatar ?? null;
    return chat.avatar;
  }

  function isOnline(chat: Chat): boolean {
    const partner = getChatPartner(chat);
    return partner ? chatStore.onlineIds().has(partner.id) : false;
  }

  function getPreview(chat: Chat): { text: string; mine: boolean } {
    const me = authStore.user();

    const typingUsers = chatStore.typing[chat.id] ?? [];
    const othersTyping = typingUsers.filter((uid) => uid !== me?.id);
    if (othersTyping.length > 0) {
      return { text: t('chats.typing'), mine: false };
    }

    const msg = chat.lastMessage;
    if (!msg) return { text: t('chats.no_messages'), mine: false };
    if (msg.isDeleted) return { text: t('chats.deleted'), mine: false };

    const mine = msg.sender?.id === me?.id;

    // Для групп показываем имя отправителя, для личных — «Вы:»
    let prefix = '';
    if (mine) {
      prefix = t('chats.you');
    } else if (chat.type === 'GROUP' && msg.sender) {
      const senderName = msg.sender.firstName ?? msg.sender.nickname;
      prefix = `${senderName}: `;
    }

    if (!msg.text && msg.type && msg.type !== 'TEXT') {
      const mediaLabels: Record<string, string> = {
        IMAGE: i18n.t('chats.media_photo'), VIDEO: i18n.t('chats.media_video'), AUDIO: i18n.t('chats.media_audio'), FILE: i18n.t('chats.media_file'),
      };
      return { text: prefix + (mediaLabels[msg.type] ?? i18n.t('common.media')), mine };
    }
    if (!msg.text && msg.ciphertext) {
      const decrypted = e2eStore.getDecryptedText(msg.id);
      return { text: prefix + (decrypted ?? t('chats.encrypted')), mine };
    }

    return { text: prefix + (msg.text ?? ''), mine };
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
    return chatStore.chats.find((c) => c.id === m.chatId) ?? null;
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

  function swipeAction(chatId: string, action: 'mute' | 'read' | 'delete') {
    resetSwipe();
    if (action === 'mute') mutedStore.toggle(chatId);
    else if (action === 'read') {
      if ((chatStore.unreadCounts[chatId] ?? 0) > 0) chatStore.clearUnread(chatId);
      else chatStore.incrementUnread(chatId);
    }
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
        <span class={styles.mobileTitle}>{t('chats.title')}</span>
        <div class={styles.mobileActions}>
          <button class={styles.mobileSettingsBtn} onClick={() => props.onSettingsClick?.()} title={t('sidebar.settings')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class={styles.header}>
        <div class={styles.headerRow}>
          <span class={styles.title}>{t('chats.title')}</span>
          <div class={styles.newMenuWrap} ref={newMenuRef!}>
            <button
              class={styles.newGroupBtn}
              onClick={() => setShowNewMenu((v) => !v)}
              title={t('chats.new_chat')}
            >
              {/* Pencil Write icon */}
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

      <Show when={!search().trim()}>
        <div class={styles.list}>
          <For
            each={chatStore.chats}
            fallback={<div class={styles.hint}>{t('chats.empty')}</div>}
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
                      <div class={`${styles.avatar} ${chat.type === 'GROUP' ? styles.groupAvatar : ''}`}>
                        <Show when={getChatAvatar(chat)} fallback={
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
                          <img src={mediaUrl(getChatAvatar(chat))} alt="" />
                        </Show>
                      </div>
                      <Show when={(chat.type === 'DIRECT' || chat.type === 'SECRET') && isOnline(chat)}>
                        <div class={styles.onlineDot} />
                      </Show>
                      <Show when={chat.type === 'GROUP'}>
                        <div class={styles.groupBadge} title={`${chat.members.length} участников`}>
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
                          <span class={`${styles.previewText} ${
                            isTypingNow() ? styles.previewTyping
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

      {/* ── Secret Chat User Picker — Telegram-style ── */}
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

      {/* ── Mobile FAB (Telegram-style) ── */}
      <div class={styles.fab} ref={newMenuRef!}>
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
    </div>
  );
};

export default ChatList;
