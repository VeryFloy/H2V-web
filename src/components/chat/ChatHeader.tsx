import {
  type Component, type Accessor, type Setter,
  createSignal, createMemo, createEffect, Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { uiStore } from '../../stores/ui.store';
import { mediaUrl } from '../../api/client';
import { mutedStore } from '../../stores/muted.store';
import { avatarColor } from '../../utils/avatar';
import { i18n } from '../../stores/i18n.store';
import { formatLastSeen, displayName } from '../../utils/format';
import type { Message } from '../../types';
import styles from './ChatHeader.module.css';

export interface ChatHeaderProps {
  searchOpen: Accessor<boolean>;
  setSearchOpen: Setter<boolean>;
  searchQ: Accessor<string>;
  setSearchQ: Setter<string>;
  searchResults: Accessor<Message[]>;
  setSearchResults: Setter<Message[]>;
  searchLoading: Accessor<boolean>;
  searchIdx: Accessor<number>;
  showHeaderMenu: Accessor<boolean>;
  setShowHeaderMenu: Setter<boolean>;
  setShowProfile: (v: boolean) => void;
  onCloseSearch: () => void;
  onHandleSearch: (q: string) => void;
  onLeaveChat: () => void;
  onToggleFilters?: () => void;
  onSearchPrev: () => void;
  onSearchNext: () => void;
}

const ChatHeader: Component<ChatHeaderProps> = (props) => {
  let menuBtnRef!: HTMLButtonElement;
  let searchInputRef!: HTMLInputElement;

  const [menuPortalPos, setMenuPortalPos] = createSignal({ top: 0, right: 0 });

  const chatId = () => chatStore.activeChatId();
  const chat = () => chatStore.activeChat();
  const me = () => authStore.user();
  const isMuted = () => mutedStore.isMuted(chatId() ?? '');

  const partner = createMemo(() => {
    const c = chat();
    if (!c || (c.type !== 'DIRECT' && c.type !== 'SECRET')) return null;
    return c.members.find((m) => m.user.id !== me()?.id)?.user ?? null;
  });

  function typingLabel(): string {
    const id = chatId(); if (!id) return '';
    const others = (chatStore.typing[id] ?? []).filter((uid: string) => uid !== me()?.id);
    if (!others.length) return '';
    const c = chat();
    const tSingle = i18n.t('msg.typing_single');
    const tPlural = i18n.t('msg.typing_plural');
    if (c?.type === 'DIRECT' || c?.type === 'SECRET') {
      const p = partner();
      return p ? `${displayName(p)} ${tSingle}` : tSingle;
    }
    const names = others
      .map((uid) => { const u = c?.members.find((m) => m.user.id === uid)?.user; return u ? displayName(u) : null; })
      .filter(Boolean) as string[];
    if (!names.length) return tSingle;
    if (names.length === 1) return `${names[0]} ${tSingle}`;
    if (names.length === 2) return `${names[0]} & ${names[1]} ${tPlural}`;
    return `${names[0]} +${names.length - 1} ${tPlural}`;
  }

  createEffect(() => {
    if (props.searchOpen() && searchInputRef) {
      setTimeout(() => searchInputRef?.focus(), 50);
    }
  });

  function openHeaderMenu() {
    if (menuBtnRef) {
      const rect = menuBtnRef.getBoundingClientRect();
      setMenuPortalPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    props.setShowHeaderMenu((v) => !v);
  }

  function closeHeaderMenu() {
    props.setShowHeaderMenu(false);
  }

  function toggleMute() {
    const id = chatId(); if (!id) return;
    mutedStore.toggle(id);
    closeHeaderMenu();
  }

  return (
    <>
      {/* ── Header (normal + search mode overlap, animated) ── */}
      <div class={styles.header}>
        {/* Normal mode */}
        <div class={`${styles.headerNormal} ${props.searchOpen() ? styles.headerNormalHide : ''}`}>
          <button
            class={styles.mobileBack}
            onClick={() => {
              if (history.state?.h2vChat) history.back();
              else chatStore.setActiveChatId(null);
            }}
            title={i18n.t('sidebar.cancel')}
            aria-label={i18n.t('common.back')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            class={styles.hUserBtn}
            onClick={() => {
              if (chat()?.type === 'GROUP') uiStore.openGroupProfile(chat()!.id);
              else props.setShowProfile(true);
            }}
            title={i18n.t('msg.profile')}
          >
            <Show when={partner()} keyed>
              {(p) => (
                <>
                  <div class={styles.hAvatar} style={!p.avatar ? { background: avatarColor(p.id) } : undefined}>
                    <Show when={p.avatar} fallback={<span>{displayName(p)[0]?.toUpperCase()}</span>}>
                      <img src={mediaUrl(p.avatar)} alt="" />
                    </Show>
                    <Show when={chatStore.onlineIds().has(p.id)}>
                      <div class={styles.hOnline} />
                    </Show>
                  </div>
                  <div>
                    <div class={styles.hName}>
                      <Show when={chat()?.type === 'SECRET'}>
                        <svg style="display:inline;vertical-align:-2px;margin-right:5px;color:#a78bfa" width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2.5"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                      </Show>
                      {displayName(p)}
                    </div>
                    <Show when={chat()?.type === 'SECRET'} fallback={
                      <div class={styles.hStatusWrap}>
                        <Show when={typingLabel()} fallback={
                          <>
                            <span class={`${styles.hStatusDot} ${chatStore.onlineIds().has(p.id) ? styles.hStatusDotOnline : ''}`} />
                            <span class={`${styles.hStatusText} ${chatStore.onlineIds().has(p.id) ? styles.hStatusTextOnline : ''}`}>
                              {chatStore.onlineIds().has(p.id) ? i18n.t('profile.online') : formatLastSeen(p.lastOnline)}
                            </span>
                          </>
                        }>
                          <span class={`${styles.hStatusText} ${styles.hStatusTyping}`}>{typingLabel()}</span>
                        </Show>
                      </div>
                    }>
                      <div class={styles.hSecretBadge}>{i18n.t('chat.secret_desc')}</div>
                    </Show>
                  </div>
                </>
              )}
            </Show>
            <Show when={chat()?.type === 'GROUP'}>
              <div class={styles.hAvatar} style={!chat()?.avatar ? { background: avatarColor(chat()!.id) } : undefined}>
                <Show when={chat()?.avatar} fallback={<span>{chat()?.name?.[0]?.toUpperCase() ?? '#'}</span>}>
                  <img src={mediaUrl(chat()!.avatar)} alt="" />
                </Show>
              </div>
              <div>
                <div class={styles.hName}>{chat()?.name ?? i18n.t('common.group')}</div>
                <div class={styles.hStatus}>{chat()?.members.length ?? 0} {i18n.t('msg.members')}</div>
              </div>
            </Show>
            <Show when={chat()?.type === 'SELF'}>
              <div class={styles.hAvatar} style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div>
                <div class={styles.hName}>{i18n.t('sidebar.saved_messages')}</div>
                <div class={styles.hStatus}>{(chatStore.messages[chatId()!] ?? []).length} {i18n.t('chat.saved_count')}</div>
              </div>
            </Show>
          </button>

          <div class={styles.hActions}>
            <button class={styles.iconBtn} onClick={() => props.setSearchOpen(true)} title={i18n.t('msg.search')} aria-label={i18n.t('msg.search')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <button
              ref={menuBtnRef!}
              class={`${styles.iconBtn} ${props.showHeaderMenu() ? styles.iconBtnActive : ''}`}
              onClick={openHeaderMenu}
              title={i18n.t('common.more')}
              aria-label={i18n.t('common.more')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Search mode — slides in from right */}
        <div class={`${styles.headerSearchMode} ${props.searchOpen() ? styles.headerSearchModeShow : ''}`}>
          <button class={styles.iconBtn} onClick={props.onCloseSearch} aria-label={i18n.t('common.close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class={styles.headerSearchInputWrap}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" class={styles.headerSearchIcon}>
              <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
              <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <input
              ref={searchInputRef!}
              class={styles.headerSearchInput}
              placeholder={i18n.t('msg.search_chat')}
              value={props.searchQ()}
              onInput={(e) => props.onHandleSearch(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) props.onSearchPrev();
                  else props.onSearchNext();
                }
              }}
            />
          </div>
          <Show when={props.searchLoading()}>
            <div class={styles.searchCounter}>
              <div class={styles.searchSpinner} />
            </div>
          </Show>
          <Show when={!props.searchLoading() && props.searchQ().trim()}>
            <Show when={props.searchResults().length > 0} fallback={
              <span class={styles.searchCounterEmpty}>{i18n.t('msg.not_found')}</span>
            }>
              <span class={styles.searchCounter}>
                {props.searchIdx() >= 0 ? `${props.searchIdx() + 1} / ` : ''}{props.searchResults().length}
              </span>
            </Show>
          </Show>
          <Show when={props.searchResults().length > 0}>
            <div class={styles.searchNav}>
              <button
                class={styles.searchNavBtn}
                onClick={props.onSearchPrev}
                disabled={props.searchIdx() <= 0}
                title={i18n.t('msg.prev_result')}
                aria-label={i18n.t('msg.prev_result')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button
                class={styles.searchNavBtn}
                onClick={props.onSearchNext}
                disabled={props.searchIdx() < 0 || props.searchIdx() >= props.searchResults().length - 1}
                title={i18n.t('msg.next_result')}
                aria-label={i18n.t('msg.next_result')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </Show>
          <Show when={props.onToggleFilters}>
            <button class={styles.iconBtn} onClick={() => props.onToggleFilters?.()} title={i18n.t('msg.filters') || 'Filters'} aria-label={i18n.t('msg.filters') || 'Filters'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </Show>
        </div>
      </div>

      {/* 3-dot menu via Portal */}
      <Show when={props.showHeaderMenu()}>
        <Portal>
          <div
            style="position:fixed;inset:0;z-index:9996;"
            onClick={closeHeaderMenu}
          />
          <div
            class={styles.headerMenuPortal}
            style={{ top: menuPortalPos().top + 'px', right: menuPortalPos().right + 'px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={toggleMute}>
              <Show when={isMuted()} fallback={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              }>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </Show>
              {isMuted() ? i18n.t('msg.unmute_chat') : i18n.t('msg.mute_chat')}
            </button>
            <button onClick={() => { props.setSearchOpen(true); closeHeaderMenu(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              {i18n.t('msg.search')}
            </button>
            <Show when={chat()?.type === 'DIRECT' || chat()?.type === 'SECRET'}>
              <button onClick={() => { props.setShowProfile(true); closeHeaderMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>
                {i18n.t('msg.profile')}
              </button>
            </Show>
            <div class={styles.headerMenuDivider} />
            <Show when={chat()?.type === 'GROUP'}>
              <button onClick={() => { uiStore.openGroupProfile(chat()!.id); closeHeaderMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                {i18n.t('grp.title')}
              </button>
              <button onClick={() => { closeHeaderMenu(); props.onLeaveChat(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                {i18n.t('msg.leave_group')}
              </button>
            </Show>
            <Show when={chat()?.type === 'DIRECT' || chat()?.type === 'SECRET'}>
              <button class={styles.headerMenuDanger} onClick={() => { closeHeaderMenu(); props.onLeaveChat(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                {i18n.t('msg.delete_chat')}
              </button>
            </Show>
          </div>
        </Portal>
      </Show>
    </>
  );
};

export default ChatHeader;
