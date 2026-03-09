import { type Component, createSignal, Show } from 'solid-js';
import { settingsStore, type AppSettings } from '../../stores/settings.store';
import { authStore } from '../../stores/auth.store';
import { wsStore } from '../../stores/ws.store';
import { api } from '../../api/client';
import { i18n, type Locale } from '../../stores/i18n.store';
import styles from './SettingsPanel.module.css';

interface Props { onClose: () => void; }

const SettingsPanel: Component<Props> = (props) => {
  const s = () => settingsStore.settings();
  const set = settingsStore.updateSettings;
  const t = i18n.t;
  const [showLogoutConfirm, setShowLogoutConfirm] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [deleteInput, setDeleteInput] = createSignal('');
  const [langOpen, setLangOpen] = createSignal(false);

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

  const fontLabel = () => t(`settings.font_${s().fontSize}`);
  const wpLabel = () => t(`settings.wp_${s().chatWallpaper}`);

  async function requestDesktopNotifs() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      set({ notifDesktop: !s().notifDesktop });
      return;
    }
    const perm = await Notification.requestPermission();
    set({ notifDesktop: perm === 'granted' });
  }

  function selectLang(locale: Locale) {
    i18n.setLocale(locale);
    set({ locale });
    setLangOpen(false);
  }

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.panel} onClick={(e) => e.stopPropagation()}>

        {/* ── Language sub-page ── */}
        <Show when={langOpen()}>
          <div class={styles.header}>
            <button class={styles.headerBackBtn} onClick={() => setLangOpen(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class={styles.headerTitle}>{t('settings.language')}</span>
            <button class={styles.headerBtn} onClick={props.onClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class={styles.langPage}>
            <button
              class={`${styles.langPageOption} ${i18n.locale() === 'ru' ? styles.langPageActive : ''}`}
              onClick={() => selectLang('ru')}
            >
              <div class={styles.langPageInfo}>
                <div class={styles.langPageName}>Русский</div>
                <div class={styles.langPageNative}>Russian</div>
              </div>
              <Show when={i18n.locale() === 'ru'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </Show>
            </button>
            <button
              class={`${styles.langPageOption} ${i18n.locale() === 'en' ? styles.langPageActive : ''}`}
              onClick={() => selectLang('en')}
            >
              <div class={styles.langPageInfo}>
                <div class={styles.langPageName}>English</div>
                <div class={styles.langPageNative}>Английский</div>
              </div>
              <Show when={i18n.locale() === 'en'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </Show>
            </button>
          </div>
        </Show>

        {/* ── Main settings ── */}
        <Show when={!langOpen()}>
        <div class={styles.header}>
          <span class={styles.headerTitle}>{t('settings.title')}</span>
          <button class={styles.headerBtn} onClick={props.onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>

        {/* ── Language ── */}
        <div class={styles.section}>
          <div class={styles.sectionTitle}>
            <svg class={styles.sectionIcon} width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2" stroke="currentColor" stroke-width="1.8"/></svg>
            {t('settings.language')}
          </div>
          <div class={styles.row} onClick={() => setLangOpen(true)}>
            <div class={styles.rowIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2" stroke="currentColor" stroke-width="1.8"/></svg>
            </div>
            <div class={styles.rowInfo}>
              <div class={styles.rowLabel}>{t('settings.language_label')}</div>
              <div class={styles.rowDesc}>{t('settings.language_desc')}</div>
            </div>
            <span class={styles.rowValue}>
              {i18n.locale() === 'ru' ? 'Русский' : 'English'}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="color:var(--text-placeholder);flex-shrink:0"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </div>

        {/* ── Notifications ── */}
        <div class={styles.section}>
          <div class={styles.sectionTitle}>
            <svg class={styles.sectionIcon} width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            {t('settings.notifications')}
          </div>
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

        {/* ── Chat ── */}
        <div class={styles.section}>
          <div class={styles.sectionTitle}>
            <svg class={styles.sectionIcon} width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {t('settings.chat')}
          </div>
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
            <span class={styles.rowValue}>{fontLabel()}</span>
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
              <span class={styles.rowValue}>{wpLabel()}</span>
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

        {/* ── Appearance ── */}
        <div class={styles.section}>
          <div class={styles.sectionTitle}>
            <svg class={styles.sectionIcon} width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.8"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            {t('settings.appearance')}
          </div>
          <div class={styles.row}>
            <div class={styles.rowIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class={styles.rowInfo}>
              <div class={styles.rowLabel}>{t('settings.theme')}</div>
            </div>
          </div>
          <div class={styles.themeRow}>
            <button
              class={`${styles.themeOption} ${s().theme === 'dark' ? styles.themeOptionActive : ''}`}
              onClick={() => set({ theme: 'dark' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {t('settings.theme_dark')}
            </button>
            <button
              class={`${styles.themeOption} ${s().theme === 'light' ? styles.themeOptionActive : ''}`}
              onClick={() => set({ theme: 'light' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              {t('settings.theme_light')}
            </button>
          </div>
        </div>

        {/* ── Privacy ── */}
        <div class={styles.section}>
          <div class={styles.sectionTitle}>
            <svg class={styles.sectionIcon} width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            {t('settings.privacy')}
          </div>
          <div class={styles.row} onClick={() => set({ showOnlineStatus: !s().showOnlineStatus })}>
            <div class={styles.rowIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="1.8"/></svg>
            </div>
            <div class={styles.rowInfo}>
              <div class={styles.rowLabel}>{t('settings.show_online')}</div>
              <div class={styles.rowDesc}>{t('settings.show_online_desc')}</div>
            </div>
            <div class={`${styles.toggle} ${s().showOnlineStatus ? styles.toggleOn : ''}`}><div class={styles.toggleDot} /></div>
          </div>
          <div class={styles.row} onClick={() => set({ showReadReceipts: !s().showReadReceipts })}>
            <div class={styles.rowIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6L4 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/></svg>
            </div>
            <div class={styles.rowInfo}>
              <div class={styles.rowLabel}>{t('settings.read_receipts')}</div>
              <div class={styles.rowDesc}>{t('settings.read_receipts_desc')}</div>
            </div>
            <div class={`${styles.toggle} ${s().showReadReceipts ? styles.toggleOn : ''}`}><div class={styles.toggleDot} /></div>
          </div>
        </div>

        {/* ── Account ── */}
        <div class={styles.section}>
          <div class={styles.sectionTitle}>
            <svg class={styles.sectionIcon} width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/></svg>
            {t('settings.account')}
          </div>
          <div class={styles.row} onClick={() => setShowLogoutConfirm(true)}>
            <div class={styles.rowIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </div>
            <div class={styles.rowInfo}>
              <div class={styles.rowLabel}>{t('settings.logout')}</div>
              <div class={styles.rowDesc}>{t('settings.logout_desc')}</div>
            </div>
          </div>
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

        <div class={styles.resetWrap}>
          <button class={styles.resetBtn} onClick={() => settingsStore.resetSettings()}>
            {t('settings.reset')}
          </button>
        </div>
        </Show>

        {/* Logout confirmation dialog */}
        <Show when={showLogoutConfirm()}>
          <div class={styles.logoutOverlay} onClick={() => setShowLogoutConfirm(false)}>
            <div class={styles.logoutDialog} onClick={(e) => e.stopPropagation()}>
              <p>{t('settings.logout_confirm_msg')}</p>
              <div class={styles.logoutBtns}>
                <button class={styles.logoutCancel} onClick={() => setShowLogoutConfirm(false)}>{t('sidebar.cancel')}</button>
                <button class={styles.logoutConfirmBtn} onClick={async () => {
                  wsStore.disconnect();
                  await authStore.logout();
                  setShowLogoutConfirm(false);
                  props.onClose();
                }}>{t('settings.logout')}</button>
              </div>
            </div>
          </div>
        </Show>

        {/* Delete account confirmation dialog */}
        <Show when={showDeleteConfirm()}>
          <div class={styles.logoutOverlay} onClick={() => setShowDeleteConfirm(false)}>
            <div class={styles.logoutDialog} onClick={(e) => e.stopPropagation()}>
              <p class={styles.deleteWarning}>{t('settings.delete_confirm')}</p>
              <p class={styles.deleteHint}>{t('settings.delete_type_hint')}</p>
              <input
                class={styles.deleteInput}
                placeholder="DELETE"
                value={deleteInput()}
                onInput={(e) => setDeleteInput(e.currentTarget.value)}
                autofocus
              />
              <div class={styles.logoutBtns}>
                <button class={styles.logoutCancel} onClick={() => setShowDeleteConfirm(false)}>{t('sidebar.cancel')}</button>
                <button
                  class={styles.deleteConfirmBtn}
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
    </div>
  );
};

export default SettingsPanel;
