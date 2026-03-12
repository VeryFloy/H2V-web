import { type Component, createSignal, createEffect, onMount, onCleanup, Show, lazy } from 'solid-js';
import { authStore, registerChatReset } from './stores/auth.store';
import { wsStore } from './stores/ws.store';
import { chatStore } from './stores/chat.store';
import { initWsEvents } from './stores/events.store';
import { settingsStore } from './stores/settings.store';
import { i18n } from './stores/i18n.store';
import { e2eStore } from './stores/e2e.store';
registerChatReset(() => { chatStore.resetStore(); e2eStore.resetE2EStore(); });

import { api } from './api/client';
import AuthFlow from './components/auth/AuthFlow';
import ChatList from './components/chat/ChatList';
import MessageArea from './components/chat/MessageArea';
import Sidebar from './components/ui/Sidebar';
const ProfilePanel = lazy(() => import('./components/ui/ProfilePanel'));
const SettingsPanel = lazy(() => import('./components/ui/SettingsPanel'));
const ContactsPanel = lazy(() => import('./components/ui/ContactsPanel'));
import InstallBanner from './components/ui/InstallBanner';
import styles from './App.module.css';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }
    if ('Notification' in window && Notification.permission === 'denied') return;

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await api.registerDeviceToken(JSON.stringify(existing.toJSON()), 'WEB');
      return;
    }
    const res = await api.getVapidKey();
    const vapidKey = res.data.vapidPublicKey;
    if (!vapidKey) return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
    });
    await api.registerDeviceToken(JSON.stringify(sub.toJSON()), 'WEB');
  } catch (err) {
    console.warn('[Push] Subscribe failed:', err);
  }
}

async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.removeDeviceToken(JSON.stringify(sub.toJSON())).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
}

const App: Component = () => {
  const [showProfile, setShowProfile] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [showContacts, setShowContacts] = createSignal(false);
  const [swUpdateAvailable, setSwUpdateAvailable] = createSignal(false);
  const [showOfflineBanner, setShowOfflineBanner] = createSignal(false);

  // Document title: show total unread count when app is in background
  createEffect(() => {
    const total = chatStore.totalUnread();
    document.title = total > 0 ? `(${total}) H2V` : 'H2V';
  });

  // Offline banner: show after 2s of no WS connection (avoids flash on initial load)
  let offlineBannerTimer: ReturnType<typeof setTimeout>;
  createEffect(() => {
    const connected = wsStore.connected();
    const logged = !!authStore.user();
    clearTimeout(offlineBannerTimer);
    if (logged && !connected) {
      offlineBannerTimer = setTimeout(() => setShowOfflineBanner(true), 2000);
    } else {
      setShowOfflineBanner(false);
    }
  });

  onMount(() => {
    authStore.loadMe();

    // Fix iOS viewport height bug: 100dvh can be inaccurate on iOS Safari.
    function setAppHeight() {
      document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
    }
    setAppHeight();
    window.addEventListener('resize', setAppHeight, { passive: true });
    onCleanup(() => window.removeEventListener('resize', setAppHeight));

    // When the API client clears expired tokens, perform a clean logout.
    function onAuthExpired() { authStore.logout(); }
    window.addEventListener('h2v:auth-expired', onAuthExpired);
    onCleanup(() => window.removeEventListener('h2v:auth-expired', onAuthExpired));

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});

      const onSwMessage = (e: MessageEvent) => {
        if (e.data?.type === 'open-chat' && e.data.chatId) {
          chatStore.openChat(e.data.chatId);
        }
      };
      navigator.serviceWorker.addEventListener('message', onSwMessage);
      onCleanup(() => navigator.serviceWorker.removeEventListener('message', onSwMessage));

      // Show update banner when a new service worker takes over
      const onControllerChange = () => setSwUpdateAvailable(true);
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      onCleanup(() => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange));
    }
  });

  // Track user id changes: only run setup when user logs IN (null → id),
  // not on every profile update that calls updateUserLocally().
  // WS reconnect after drops is handled by scheduleReconnect() in ws.store.ts.
  // WS reconnect after away-tab is handled by comeBack() in ws.store.ts.
  // Tracking wsStore.connected() here would fight the away-detection mechanism.
  createEffect((prevId: string | null) => {
    const u = authStore.user();
    const id = u?.id ?? null;

    if (id && !prevId) {
      wsStore.connect();
      chatStore.loadChats();
      settingsStore.loadFromServer().then(() => {
        const s = settingsStore.settings();
        if (s?.locale) i18n.setLocale(s.locale);
        if (s?.notifDesktop && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      });
      e2eStore.initE2EStore(id).catch(() => {});
      subscribeToPush();
    } else if (!id && prevId) {
      unsubscribeFromPush();
      wsStore.disconnect();
    }

    return id;
  }, null as string | null);

  const unsub = initWsEvents();
  onCleanup(unsub);

  // ── History API: browser back / mouse back button / iOS swipe-back ──
  // When a chat opens  → push a history entry so the back button can close it.
  // When chats switch  → replace so we don't stack up entries.
  // When chat closes programmatically (ESC / UI button) → pop the orphaned entry.
  // When popstate fires (user pressed back) → close the chat, suppress re-pop.
  let suppressNextPop = false;

  createEffect((prevId: string | null) => {
    const id = chatStore.activeChatId();
    if (id && !prevId) {
      history.pushState({ h2vChat: true }, '');
    } else if (id && prevId && id !== prevId) {
      history.replaceState({ h2vChat: true }, '');
    } else if (!id && prevId && history.state?.h2vChat) {
      suppressNextPop = true;
      history.back();
    }
    return id;
  }, null as string | null);

  onMount(() => {
    function onPopState() {
      if (suppressNextPop) { suppressNextPop = false; return; }
      if (chatStore.activeChatId()) {
        chatStore.setActiveChatId(null);
      }
    }
    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));
  });

  // chatOpen drives the mobile slide animation
  const chatOpen = () => !!chatStore.activeChatId();

  return (
    <Show when={!authStore.loading()} fallback={
      <div class={styles.loadingScreen}>
        <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '1rem' }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ animation: 'connSpin 1s linear infinite' }}>
            <circle cx="24" cy="24" r="20" stroke="var(--accent, #7c5cfc)" stroke-width="4" stroke-dasharray="90 150" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    }>
      <div class={styles.fadeIn}>
        {/* Global banners */}
        <div class={styles.bannerWrap}>
          <Show when={swUpdateAvailable()}>
            <div class={styles.updateBanner}>
              <span>{i18n.t('app.update_available')}</span>
              <button class={styles.updateBannerBtn} onClick={() => window.location.reload()}>
                {i18n.t('app.reload')}
              </button>
            </div>
          </Show>
          <Show when={showOfflineBanner()}>
            <div class={styles.offlineBanner}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-dasharray="40 20" stroke-linecap="round"/>
              </svg>
              {i18n.t('app.reconnecting')}
            </div>
          </Show>
        </div>

        <Show when={authStore.user()} fallback={<AuthFlow />}>
          <div class={`${styles.shell} ${chatOpen() ? styles.shellChatOpen : ''}`}>
            <div class={styles.sidebarArea}>
              <Sidebar onProfileClick={() => setShowProfile(true)} onSettingsClick={() => setShowSettings(true)} onContactsClick={() => setShowContacts(true)} />
            </div>
            <div class={styles.chatList}>
              <ChatList onProfileClick={() => setShowProfile(true)} onSettingsClick={() => setShowSettings(true)} />
            </div>
            <div class={styles.chatArea}>
              <MessageArea />
            </div>
          </div>
          <Show when={showProfile()}>
            <ProfilePanel onClose={() => setShowProfile(false)} />
          </Show>
          <Show when={showSettings()}>
            <SettingsPanel onClose={() => setShowSettings(false)} />
          </Show>
          <Show when={showContacts()}>
            <ContactsPanel
              onClose={() => setShowContacts(false)}
              onOpenProfile={(userId) => {
                setShowContacts(false);
                chatStore.startDirectChat(userId).catch(() => {});
              }}
            />
          </Show>
        </Show>
        <InstallBanner />
      </div>
    </Show>
  );
};

export default App;
