import { type Component, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { api } from '../../api/client';
import type { Chat, User } from '../../types';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import styles from './ChatList.module.css';

interface Props { onProfileClick?: () => void; onSettingsClick?: () => void; }

const ChatList: Component<Props> = (props) => {
  const t = i18n.t;
  const [search, setSearch] = createSignal('');
  const [ctxMenu, setCtxMenu] = createSignal<{ chatId: string; x: number; y: number } | null>(null);

  const [mutedChats, setMutedChats] = createSignal<Set<string>>(
    new Set(JSON.parse(localStorage.getItem('h2v_muted') ?? '[]'))
  );

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
    });
  });

  function toggleMute(chatId: string) {
    setMutedChats((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
      localStorage.setItem('h2v_muted', JSON.stringify([...next]));
      return next;
    });
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
      const chat = chatStore.chats.find((c) => c.id === chatId);
      if (chat?.type === 'GROUP') chatStore.removeChat(chatId);
    } catch (e) {
      console.error('[ChatList] deleteChat:', e);
    }
  }

  const [searchResults, setSearchResults] = createSignal<User[]>([]);
  const [searching, setSearching] = createSignal(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

  async function handleSearch(q: string) {
    setSearch(q);
    clearTimeout(debounceTimer);
    if (!q.trim()) { setSearchResults([]); return; }
    debounceTimer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchUsers(q.trim());
        const me = authStore.user();
        setSearchResults((res.data ?? []).filter((u) => u.id !== me?.id));
      } catch {
        setSearchResults([]);
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
    if (chat.type === 'DIRECT') return displayName(getChatPartner(chat));
    return chat.name ?? 'Группа';
  }

  function getChatAvatar(chat: Chat): string | null {
    if (chat.type === 'DIRECT') return getChatPartner(chat)?.avatar ?? null;
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
    const prefix = mine ? t('chats.you') : '';

    if (!msg.text && msg.type && msg.type !== 'TEXT') {
      const mediaLabels: Record<string, string> = {
        IMAGE: '🖼 Фото', VIDEO: '🎥 Видео', AUDIO: '🎤 Голосовое', FILE: '📎 Файл',
      };
      return { text: prefix + (mediaLabels[msg.type] ?? '[медиа]'), mine };
    }
    if (!msg.text && msg.ciphertext) {
      return { text: prefix + t('chats.encrypted'), mine };
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

  return (
    <div class={styles.wrap}>
      <div class={styles.mobileBar}>
        <button class={styles.mobileProfileBtn} onClick={() => props.onProfileClick?.()} title={t('sidebar.profile')}>
          <Show when={authStore.user()?.avatar} fallback={
            <span class={styles.mobileAvatarLetter}>{displayName(authStore.user())[0]?.toUpperCase()}</span>
          }>
            <img src={authStore.user()!.avatar!} alt="" />
          </Show>
        </button>
        <span class={styles.mobileTitle}>{t('chats.title')}</span>
        <button class={styles.mobileSettingsBtn} onClick={() => props.onSettingsClick?.()} title={t('sidebar.settings')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class={styles.header}>
        <span class={styles.title}>{t('chats.title')}</span>
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
                      <img src={u.avatar!} alt="" />
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
              const isMuted = () => mutedChats().has(chat.id);
              const isTypingNow = () => {
                const me = authStore.user();
                return (chatStore.typing[chat.id] ?? []).some((uid) => uid !== me?.id);
              };
              const showOnlineChip = () =>
                chat.type === 'DIRECT' && isOnline(chat) && !isTypingNow();

              return (
                <div
                  class={`${styles.item} ${chatStore.activeChatId() === chat.id ? styles.active : ''} ${isMuted() ? styles.muted : ''}`}
                  onClick={() => chatStore.openChat(chat.id)}
                  onContextMenu={(e) => openCtxMenu(e, chat.id)}
                >
                  <div class={styles.avatarWrap}>
                    <div class={styles.avatar}>
                      <Show when={getChatAvatar(chat)} fallback={<span>{initials(getChatName(chat))}</span>}>
                        <img src={getChatAvatar(chat)!} alt="" />
                      </Show>
                    </div>
                    <Show when={isOnline(chat)}>
                      <div class={styles.onlineDot} />
                    </Show>
                  </div>
                  <div class={styles.info}>
                    <div class={styles.row1}>
                      <span class={styles.name}>{getChatName(chat)}</span>
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
              );
            }}
          </For>
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
              <Show when={mutedChats().has(ctxMenu()!.chatId)} fallback={
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
    </div>
  );
};

export default ChatList;
