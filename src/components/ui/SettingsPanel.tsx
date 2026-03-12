import { type Component, createSignal, createResource, createEffect, Show, For, lazy } from 'solid-js';
import { settingsStore, type AppSettings } from '../../stores/settings.store';
import { authStore } from '../../stores/auth.store';
import { wsStore } from '../../stores/ws.store';
import { api, mediaUrl } from '../../api/client';
import { i18n, type Locale } from '../../stores/i18n.store';
import { displayName } from '../../utils/format';
import { avatarColor } from '../../utils/avatar';
import type { PrivacyLevel } from '../../types';
import { useSwipeBack } from '../../utils/useSwipeBack';
import styles from './SettingsPanel.module.css';

const SessionsPanel = lazy(() => import('./SessionsPanel'));

interface Props { onClose: () => void; onOpenProfile?: () => void; }

type Page = 'main' | 'general' | 'notifications' | 'chat' | 'privacy' | 'sessions';

const ChevronRight = () => (
  <svg class={styles.menuChevron} width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
);

const BackBtn: Component<{ onClick: () => void }> = (props) => (
  <button class={styles.headerBtn} onClick={props.onClick}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
);

const SettingsPanel: Component<Props> = (props) => {
  const s = () => settingsStore.settings();
  const set = settingsStore.updateSettings;
  const t = i18n.t;
  const [page, setPage] = createSignal<Page>('main');
  const [renderedPage, setRenderedPage] = createSignal<Page>('main');
  const [showLogoutConfirm, setShowLogoutConfirm] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [deleteInput, setDeleteInput] = createSignal('');
  const [blockedUsers, { refetch: refetchBlocked }] = createResource(
    () => api.getBlockedUsersFull().then(r => r.data ?? []),
  );

  const subPageOpen = () => page() !== 'main';

  createEffect(() => {
    const p = page();
    if (p !== 'main') setRenderedPage(p);
  });

  function openSub(p: Page) {
    setRenderedPage(p);
    requestAnimationFrame(() => setPage(p));
  }

  function closeSub() {
    setPage('main');
  }

  // Swipe-right-to-back for sub-pages
  let touchStartX = 0;
  let touchStartY = 0;
  let swiping = false;

  function onSubTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiping = false;
  }
  function onSubTouchMove(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) swiping = true;
  }
  function onSubTouchEnd(e: TouchEvent) {
    if (!swiping) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX;
    if (dx > 60) closeSub();
    swiping = false;
  }

  async function handleUnblock(userId: string) {
    await api.unblockUser(userId);
    refetchBlocked();
  }

  function cycleFontSize() {
    const order: AppSettings['fontSize'][] = ['small', 'medium', 'large'];
    const idx = order.indexOf(s().fontSize);
    set({ fontSize: order[(idx + 1) % order.length] });
  }

  function cycleWallpaper() {
    const order: AppSettings['chatWallpaper'][] = ['default', 'dark', 'dots', 'gradient'];
    const idx = order.indexOf(s().chatWallpaper);
    set({ chatWallpaper: order[(idx + 1) % order.length] });
  }

  function selectLang(locale: Locale) {
    set({ locale });
  }

  async function requestDesktopNotifs() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      set({ notifDesktop: !s().notifDesktop });
      return;
    }
    const perm = await Notification.requestPermission();
    set({ notifDesktop: perm === 'granted' });
  }

  const mainSwipe = useSwipeBack(() => props.onClose());

  const user = () => authStore.user();

  return (
    <div class={styles.panel}>
      {/* ─── Header ─── */}
      <div class={styles.header}>
        <BackBtn onClick={subPageOpen() ? closeSub : props.onClose} />
        <div class={styles.headerTitle}>
          {subPageOpen()
            ? t(`settings.${page() === 'chat' ? 'chat_settings' : page() === 'privacy' ? 'privacy_security' : page()}`)
            : t('settings.title')}
        </div>
      </div>

      {/* ─── Two-layer animated body ─── */}
      <div class={styles.pageContainer}>
        {/* Main menu layer */}
        <div
          class={`${styles.mainLayer} ${subPageOpen() ? styles.mainLayerHidden : ''}`}
          onTouchStart={mainSwipe.onTouchStart}
          onTouchMove={mainSwipe.onTouchMove}
          onTouchEnd={mainSwipe.onTouchEnd}
        >
          <div class={styles.body}>
            {/* Profile card */}
            <Show when={user()}>
              {(u) => (
                <div class={styles.profileCard} onClick={() => props.onOpenProfile?.()} style={{ cursor: 'pointer' }}>
                  <div class={styles.profileAvatar} style={!u().avatar ? { background: avatarColor(u().id) } : undefined}>
                    <Show when={u().avatar} fallback={<span>{displayName(u())[0]?.toUpperCase()}</span>}>
                      <img src={mediaUrl(u().avatar!)} alt="" />
                    </Show>
                  </div>
                  <div class={styles.profileInfo}>
                    <div class={styles.profileName}>{displayName(u())}</div>
                    <div class={styles.profileNick}>@{u().nickname}</div>
                  </div>
                  <ChevronRight />
                </div>
              )}
            </Show>

            <div class={styles.menuList}>
              <button class={styles.menuItem} onClick={() => openSub('general')}>
                <div class={styles.menuIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.8"/></svg>
                </div>
                <span class={styles.menuLabel}>{t('settings.general')}</span>
                <ChevronRight />
              </button>
              <button class={styles.menuItem} onClick={() => openSub('notifications')}>
                <div class={styles.menuIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </div>
                <span class={styles.menuLabel}>{t('settings.notifications')}</span>
                <ChevronRight />
              </button>
              <button class={styles.menuItem} onClick={() => openSub('chat')}>
                <div class={styles.menuIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <span class={styles.menuLabel}>{t('settings.chat_settings')}</span>
                <ChevronRight />
              </button>
              <button class={styles.menuItem} onClick={() => openSub('privacy')}>
                <div class={styles.menuIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </div>
                <span class={styles.menuLabel}>{t('settings.privacy_security')}</span>
                <ChevronRight />
              </button>
              <button class={styles.menuItem} onClick={() => openSub('sessions')}>
                <div class={styles.menuIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </div>
                <span class={styles.menuLabel}>{t('settings.sessions')}</span>
                <ChevronRight />
              </button>

              <div class={styles.menuDivider} />

              <button class={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => setShowLogoutConfirm(true)}>
                <div class={styles.menuIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </div>
                <span class={styles.menuLabel}>{t('settings.logout')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sub-page layer */}
        <div
          class={`${styles.subLayer} ${subPageOpen() ? styles.subLayerActive : ''}`}
          onTouchStart={onSubTouchStart}
          onTouchMove={onSubTouchMove}
          onTouchEnd={onSubTouchEnd}
        >
          <div class={styles.body}>
            {/* ── GENERAL ── */}
            <Show when={renderedPage() === 'general'}>
              <div class={styles.subPage}>
                <div class={styles.sectionTitle}>{t('settings.language')}</div>
                <button
                  class={`${styles.langOption} ${i18n.locale() === 'en' ? styles.langActive : ''}`}
                  onClick={() => selectLang('en')}
                >
                  <div class={styles.langInfo}>
                    <div class={styles.langName}>English</div>
                    <div class={styles.langNative}>English</div>
                  </div>
                  <Show when={i18n.locale() === 'en'}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </Show>
                </button>
                <button
                  class={`${styles.langOption} ${i18n.locale() === 'ru' ? styles.langActive : ''}`}
                  onClick={() => selectLang('ru')}
                >
                  <div class={styles.langInfo}>
                    <div class={styles.langName}>Русский</div>
                    <div class={styles.langNative}>Russian</div>
                  </div>
                  <Show when={i18n.locale() === 'ru'}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </Show>
                </button>

                <div class={styles.sectionTitle}>{t('settings.theme')}</div>
                <div class={styles.themeRow}>
                  <button
                    class={`${styles.themeOption} ${s().theme === 'dark' ? styles.themeOptionActive : ''}`}
                    onClick={() => set({ theme: 'dark' })}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    {t('settings.theme_dark')}
                  </button>
                  <button
                    class={`${styles.themeOption} ${s().theme === 'light' ? styles.themeOptionActive : ''}`}
                    onClick={() => set({ theme: 'light' })}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    {t('settings.theme_light')}
                  </button>
                </div>
                <div class={styles.resetWrap}>
                  <button class={styles.resetBtn} onClick={() => settingsStore.resetSettings()}>
                    {t('settings.reset')}
                  </button>
                </div>
              </div>
            </Show>

            {/* ── NOTIFICATIONS ── */}
            <Show when={renderedPage() === 'notifications'}>
              <div class={styles.subPage}>
                <div class={styles.row} onClick={() => set({ notifSound: !s().notifSound })}>
                  <div class={styles.rowIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                  </div>
                  <div class={styles.rowInfo}>
                    <div class={styles.rowLabel}>{t('settings.notif_sound')}</div>
                    <div class={styles.rowDesc}>{t('settings.notif_sound_desc')}</div>
                  </div>
                  <div class={`${styles.toggle} ${s().notifSound ? styles.toggleOn : ''}`}><div class={styles.toggleDot} /></div>
                </div>
                <div class={styles.row} onClick={requestDesktopNotifs}>
                  <div class={styles.rowIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div class={styles.rowInfo}>
                    <div class={styles.rowLabel}>{t('settings.notif_push')}</div>
                    <div class={styles.rowDesc}>{t('settings.notif_push_desc')}</div>
                  </div>
                  <div class={`${styles.toggle} ${s().notifDesktop ? styles.toggleOn : ''}`}><div class={styles.toggleDot} /></div>
                </div>
              </div>
            </Show>

            {/* ── CHAT SETTINGS ── */}
            <Show when={renderedPage() === 'chat'}>
              <div class={styles.subPage}>
                <div class={styles.row} onClick={() => set({ sendByEnter: !s().sendByEnter })}>
                  <div class={styles.rowIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 10l-5 5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4v7a4 4 0 01-4 4H4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div class={styles.rowInfo}>
                    <div class={styles.rowLabel}>{t('settings.send_enter')}</div>
                    <div class={styles.rowDesc}>{s().sendByEnter ? t('settings.send_enter_on') : t('settings.send_enter_off')}</div>
                  </div>
                  <div class={`${styles.toggle} ${s().sendByEnter ? styles.toggleOn : ''}`}><div class={styles.toggleDot} /></div>
                </div>
                <div class={styles.row} onClick={cycleFontSize}>
                  <div class={styles.rowIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7V4h16v3M9 20h6M12 4v16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div class={styles.rowInfo}>
                    <div class={styles.rowLabel}>{t('settings.font_size')}</div>
                    <div class={styles.rowDesc}>{t('settings.font_size_desc')}</div>
                  </div>
                  <span class={styles.rowValue}>{t(`settings.font_${s().fontSize}`)}</span>
                </div>
                <div class={styles.row} onClick={cycleWallpaper}>
                  <div class={styles.rowIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div class={styles.rowInfo}>
                    <div class={styles.rowLabel}>{t('settings.wallpaper')}</div>
                    <div class={styles.rowDesc}>{t('settings.wallpaper_desc')}</div>
                  </div>
                  <div class={styles.rowValueGroup}>
                    <div class={`${styles.wallpaperDot} ${styles[`wp_${s().chatWallpaper}`]}`} />
                    <span class={styles.rowValue}>{t(`settings.wp_${s().chatWallpaper}`)}</span>
                  </div>
                </div>
                <div class={styles.row} onClick={() => set({ mediaAutoDownload: !s().mediaAutoDownload })}>
                  <div class={styles.rowIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <div class={styles.rowInfo}>
                    <div class={styles.rowLabel}>{t('settings.media_auto')}</div>
                    <div class={styles.rowDesc}>{t('settings.media_auto_desc')}</div>
                  </div>
                  <div class={`${styles.toggle} ${s().mediaAutoDownload ? styles.toggleOn : ''}`}><div class={styles.toggleDot} /></div>
                </div>
              </div>
            </Show>

            {/* ── PRIVACY & SECURITY ── */}
            <Show when={renderedPage() === 'privacy'}>
              <div class={styles.subPage}>
                <div class={styles.privacyBlock}>
                  <div class={styles.privacyLabel}>{t('privacy.online_status')}</div>
                  <div class={styles.privacyDesc}>{t('privacy.online_status_desc')}</div>
                  <div class={styles.segmented}>
                    {(['all', 'contacts', 'nobody'] as PrivacyLevel[]).map((lvl) => (
                      <button class={`${styles.segBtn} ${s().showOnlineStatus === lvl ? styles.segBtnActive : ''}`} onClick={() => set({ showOnlineStatus: lvl })}>
                        {t(`privacy.${lvl === 'contacts' ? 'contacts_only' : lvl}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div class={styles.privacyBlock}>
                  <div class={styles.privacyLabel}>{t('privacy.read_receipts')}</div>
                  <div class={styles.privacyDesc}>{t('privacy.read_receipts_desc')}</div>
                  <div class={styles.segmented}>
                    {(['all', 'contacts', 'nobody'] as PrivacyLevel[]).map((lvl) => (
                      <button class={`${styles.segBtn} ${s().showReadReceipts === lvl ? styles.segBtnActive : ''}`} onClick={() => set({ showReadReceipts: lvl })}>
                        {t(`privacy.${lvl === 'contacts' ? 'contacts_only' : lvl}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div class={styles.privacyBlock}>
                  <div class={styles.privacyLabel}>{t('privacy.avatar')}</div>
                  <div class={styles.privacyDesc}>{t('privacy.avatar_desc')}</div>
                  <div class={styles.segmented}>
                    {(['all', 'contacts', 'nobody'] as PrivacyLevel[]).map((lvl) => (
                      <button class={`${styles.segBtn} ${s().showAvatar === lvl ? styles.segBtnActive : ''}`} onClick={() => set({ showAvatar: lvl })}>
                        {t(`privacy.${lvl === 'contacts' ? 'contacts_only' : lvl}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div class={styles.privacyBlock}>
                  <div class={styles.privacyLabel}>{t('privacy.group_invites')}</div>
                  <div class={styles.privacyDesc}>{t('privacy.group_invites_desc')}</div>
                  <div class={styles.segmented}>
                    {(['all', 'contacts', 'nobody'] as PrivacyLevel[]).map((lvl) => (
                      <button class={`${styles.segBtn} ${s().allowGroupInvites === lvl ? styles.segBtnActive : ''}`} onClick={() => set({ allowGroupInvites: lvl })}>
                        {t(`privacy.${lvl === 'contacts' ? 'contacts_only' : lvl}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div class={styles.privacyBlock}>
                  <div class={styles.privacyLabel}>{t('privacy.blacklist')}</div>
                  <div class={styles.privacyDesc}>{t('privacy.blacklist_desc')}</div>
                  <div class={styles.blockedList}>
                    <Show when={!blockedUsers.loading && blockedUsers()?.length === 0}>
                      <div class={styles.blockedEmpty}>{t('privacy.blacklist_empty')}</div>
                    </Show>
                    <For each={blockedUsers()}>
                      {(u) => (
                        <div class={styles.blockedRow}>
                          <div class={styles.blockedAvatar} style={!u.avatar ? { background: avatarColor(u.id) } : undefined}>
                            <Show when={u.avatar} fallback={<span>{displayName(u)[0]?.toUpperCase()}</span>}>
                              <img src={mediaUrl(u.avatar)} alt="" />
                            </Show>
                          </div>
                          <div class={styles.blockedName}>{displayName(u)}</div>
                          <button class={styles.blockedUnblock} onClick={() => handleUnblock(u.id)}>
                            {t('privacy.unblock')}
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
                <div class={styles.sectionTitle}>{t('settings.account')}</div>
                <div class={styles.row} onClick={() => { setDeleteInput(''); setShowDeleteConfirm(true); }}>
                  <div class={`${styles.rowIcon} ${styles.rowIconDanger}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                  </div>
                  <div class={styles.rowInfo}>
                    <div class={`${styles.rowLabel} ${styles.rowLabelDanger}`}>{t('settings.delete_account')}</div>
                    <div class={styles.rowDesc}>{t('settings.delete_desc')}</div>
                  </div>
                </div>
              </div>
            </Show>

            {/* ── SESSIONS ── */}
            <Show when={renderedPage() === 'sessions'}>
              <SessionsPanel onClose={closeSub} />
            </Show>
          </div>
        </div>
      </div>

      {/* ═══════════════ DIALOGS ═══════════════ */}
      <Show when={showLogoutConfirm()}>
        <div class={styles.dialogOverlay} onClick={() => setShowLogoutConfirm(false)}>
          <div class={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <p>{t('settings.logout_confirm_msg')}</p>
            <div class={styles.dialogBtns}>
              <button class={styles.dialogCancel} onClick={() => setShowLogoutConfirm(false)}>{t('common.cancel')}</button>
              <button class={styles.dialogDanger} onClick={async () => {
                wsStore.disconnect();
                await authStore.logout();
                setShowLogoutConfirm(false);
                props.onClose();
              }}>{t('settings.logout')}</button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={showDeleteConfirm()}>
        <div class={styles.dialogOverlay} onClick={() => setShowDeleteConfirm(false)}>
          <div class={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <p class={styles.deleteWarning}>{t('settings.delete_confirm')}</p>
            <p class={styles.deleteHint}>{t('settings.delete_type_hint')}</p>
            <input
              class={styles.deleteInput}
              placeholder="DELETE"
              value={deleteInput()}
              onInput={(e) => setDeleteInput(e.currentTarget.value)}
              autofocus
            />
            <div class={styles.dialogBtns}>
              <button class={styles.dialogCancel} onClick={() => setShowDeleteConfirm(false)}>{t('common.cancel')}</button>
              <button
                class={styles.dialogDanger}
                disabled={deleteInput() !== 'DELETE'}
                onClick={async () => {
                  try {
                    await api.deleteMe();
                    await authStore.logout();
                    setShowDeleteConfirm(false);
                    props.onClose();
                  } catch {
                    alert(t('error.generic') || 'Failed to delete account');
                  }
                }}
              >{t('settings.delete_account')}</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SettingsPanel;
