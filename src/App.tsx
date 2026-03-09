import { type Component, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { authStore, registerChatReset } from './stores/auth.store';
import { wsStore } from './stores/ws.store';
import { chatStore } from './stores/chat.store';
import { initWsEvents } from './stores/events.store';
import { settingsStore } from './stores/settings.store';
import { i18n } from './stores/i18n.store';
import { e2eStore } from './stores/e2e.store';
registerChatReset(() => { chatStore.resetStore(); e2eStore.resetE2EStore(); });

import AuthFlow from './components/auth/AuthFlow';
import ChatList from './components/chat/ChatList';
import MessageArea from './components/chat/MessageArea';
import Sidebar from './components/ui/Sidebar';
import ProfilePanel from './components/ui/ProfilePanel';
import SettingsPanel from './components/ui/SettingsPanel';
import InstallBanner from './components/ui/InstallBanner';
import styles from './App.module.css';

const App: Component = () => {
  const [showProfile, setShowProfile] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);

  onMount(() => {
    authStore.loadMe();

    // Fix iOS viewport height bug: 100dvh can be inaccurate on iOS Safari.
    // We measure the real inner height and expose it as --app-h.
    function setAppHeight() {
      document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
    }
    setAppHeight();
    window.addEventListener('resize', setAppHeight, { passive: true });
    onCleanup(() => window.removeEventListener('resize', setAppHeight));

    // When the API client clears expired tokens, perform a clean logout
    // instead of a hard page reload — preserves SPA state and avoids re-downloading the bundle.
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
      const token = localStorage.getItem('accessToken');
      if (token) wsStore.connect(token);
      chatStore.loadChats();
      settingsStore.loadFromServer().then(() => {
        const s = settingsStore.settings();
        if (s?.locale) i18n.setLocale(s.locale);
        if (s?.notifDesktop && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      });
      e2eStore.initE2EStore(id).catch(() => {});
    } else if (!id && prevId) {
      // Logged out
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
        <Show when={authStore.user()} fallback={<AuthFlow />}>
          <div class={`${styles.shell} ${chatOpen() ? styles.shellChatOpen : ''}`}>
            {/* Sidebar — hidden on mobile */}
            <div class={styles.sidebarArea}>
              <Sidebar onProfileClick={() => setShowProfile(true)} onSettingsClick={() => setShowSettings(true)} />
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
        </Show>
        <InstallBanner />
      </div>
    </Show>
  );
};

export default App;
