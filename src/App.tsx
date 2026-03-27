import { type Component, createSignal, createEffect, onMount, onCleanup, Show, lazy, ErrorBoundary, Suspense } from 'solid-js';
import { authStore, registerChatReset } from './stores/auth.store';
import { wsStore } from './stores/ws.store';
import { chatStore } from './stores/chat.store';
import { initWsEvents, resetEventsStore } from './stores/events.store';
import { settingsStore } from './stores/settings.store';
import { i18n } from './stores/i18n.store';
import { e2eStore } from './stores/e2e.store';
import { uiStore, type LeftPanel } from './stores/ui.store';
registerChatReset(() => {
  chatStore.resetStore();
  e2eStore.resetE2EStore();
  resetEventsStore();
});

import { api } from './api/client';
import AuthFlow from './components/auth/AuthFlow';
import ChatList from './components/chat/ChatList';
import MessageArea from './components/chat/MessageArea';
import Sidebar from './components/ui/Sidebar';
const ProfilePanel = lazy(() => import('./components/ui/ProfilePanel'));
const SettingsPanel = lazy(() => import('./components/ui/SettingsPanel'));
const ContactsPanel = lazy(() => import('./components/ui/ContactsPanel'));
const UserProfile = lazy(() => import('./components/ui/UserProfile'));
const GroupProfile = lazy(() => import('./components/chat/GroupProfile'));
const ArchivePanel = lazy(() => import('./components/ui/ArchivePanel'));
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
    if (import.meta.env.DEV) console.warn('[Push] Subscribe failed:', err);
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

async function handleJoinInvite() {
  const match = window.location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)$/);
  if (!match) return;
  const code = match[1];
  history.replaceState(null, '', '/');
  try {
    const res = await api.joinByInvite(code);
    if (res.data) {
      chatStore.addChat(res.data);
      chatStore.openChat(res.data.id);
    }
  } catch (err: any) {
    if (import.meta.env.DEV) console.warn('[JoinInvite]', err?.message ?? err);
  }
}

function PanelFallback(props: { err: any; reset: () => void }) {
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', height: '100%', gap: '0.75rem', padding: '2rem', color: 'var(--text-secondary)', 'text-align': 'center' }}>
      <p style={{ 'font-size': '14px' }}>{i18n.t('error.generic')}</p>
      <button onClick={props.reset} style={{ padding: '6px 16px', background: 'var(--accent)', color: '#fff', border: 'none', 'border-radius': '8px', cursor: 'pointer', 'font-size': '13px' }}>{i18n.t('app.reload')}</button>
    </div>
  );
}

const App: Component = () => {
  const [showContacts, setShowContacts] = createSignal(false);
  const [swUpdateAvailable, setSwUpdateAvailable] = createSignal(false);
  const [showOfflineBanner, setShowOfflineBanner] = createSignal(false);
  const [e2eInitFailed, setE2eInitFailed] = createSignal(false);

  // Previous left panel for animation direction
  const [prevPanel, setPrevPanel] = createSignal<LeftPanel>('chats');
  const [animating, setAnimating] = createSignal(false);

  createEffect(() => {
    const total = chatStore.totalUnread();
    const chat = chatStore.activeChat();
    const me = authStore.user();
    const partner = chat?.members.find(m => m.user.id !== me?.id)?.user;
    const name = chat?.name || partner?.nickname || partner?.firstName || '';
    if (name) {
      document.title = total > 0 ? `(${total}) ${name} — H2V Web` : `${name} — H2V Web`;
    } else {
      document.title = total > 0 ? `(${total}) H2V Web` : 'H2V Web';
    }
  });

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

    // URL routing: parse initial URL → open chat
    const chatMatch = window.location.pathname.match(/^\/chat\/(.+)$/);
    if (chatMatch) {
      chatStore.setActiveChatIdFromUrl(decodeURIComponent(chatMatch[1]));
    }

    // Browser back/forward → sync chat state
    function onPopState() {
      const m = window.location.pathname.match(/^\/chat\/(.+)$/);
      chatStore.setActiveChatIdFromUrl(m ? decodeURIComponent(m[1]) : null);
    }
    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));

    function setAppHeight() {
      const vv = window.visualViewport;
      const h = vv?.height ?? window.innerHeight;
      const top = vv?.offsetTop ?? 0;
      const root = document.documentElement;
      root.style.setProperty('--app-h', h + 'px');
      root.style.setProperty('--app-top', top + 'px');
      window.scrollTo(0, 0);
    }
    setAppHeight();
    window.addEventListener('resize', setAppHeight, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setAppHeight, { passive: true });
      window.visualViewport.addEventListener('scroll', setAppHeight, { passive: true });
    }
    onCleanup(() => {
      window.removeEventListener('resize', setAppHeight);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', setAppHeight);
        window.visualViewport.removeEventListener('scroll', setAppHeight);
      }
    });

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

      const onControllerChange = () => setSwUpdateAvailable(true);
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      onCleanup(() => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange));
    }
  });

  createEffect((prevId: string | null) => {
    const u = authStore.user();
    const id = u?.id ?? null;

    if (id && !prevId) {
      wsStore.connect();
      chatStore.loadChats().then(() => handleJoinInvite());
      settingsStore.loadFromServer().then(() => {
        const s = settingsStore.settings();
        if (s?.notifDesktop && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      });
      e2eStore.initE2EStore(id).then(() => setE2eInitFailed(false)).catch(() => setE2eInitFailed(true));
      subscribeToPush();
    } else if (!id && prevId) {
      unsubscribeFromPush();
      wsStore.disconnect();
    }

    return id;
  }, null as string | null);

  const unsub = initWsEvents();
  onCleanup(unsub);

  const unsubReconnect = wsStore.onReconnect(() => {
    chatStore.loadChats();

    const activeChatId = chatStore.activeChatId();
    if (activeChatId) {
      setTimeout(() => chatStore.loadMessages(activeChatId), 800);
    }
  });
  onCleanup(unsubReconnect);

  // ── Left panel animation tracking ──
  createEffect(() => {
    const current = uiStore.leftPanel();
    const prev = prevPanel();
    if (current !== prev) {
      setAnimating(true);
      setTimeout(() => setAnimating(false), 280);
      setPrevPanel(current);
    }
  });

  // ── Update right panel when active chat changes (keep it open) ──
  createEffect((prevChatId: string | null) => {
    const chatId = chatStore.activeChatId();
    if (prevChatId && chatId && chatId !== prevChatId) {
      const profileOpen = !!uiStore.viewingUserId();
      const groupOpen = !!uiStore.viewingGroupId();
      if (profileOpen || groupOpen) {
        const newChat = chatStore.chats.find(c => c.id === chatId);
        if (newChat) {
          if (newChat.type === 'GROUP') {
            uiStore.openGroupProfile(newChat.id);
          } else if (newChat.type === 'SELF') {
            const me = authStore.user();
            if (me) uiStore.openUserProfile(me.id);
          } else if (newChat.type === 'DIRECT' || newChat.type === 'SECRET') {
            const me = authStore.user();
            const partner = newChat.members.find(m => m.user.id !== me?.id)?.user;
            if (partner) {
              uiStore.openUserProfile(partner.id);
            } else {
              uiStore.closeUserProfile();
              uiStore.closeGroupProfile();
            }
          } else {
            uiStore.closeUserProfile();
            uiStore.closeGroupProfile();
          }
        }
      }
    }
    return chatId;
  }, null as string | null);

  // ── History API: browser back / mouse back ──
  let suppressNextPop = false;

  // Chat history
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

  // Left panel history
  createEffect((prev: LeftPanel) => {
    const current = uiStore.leftPanel();
    if (current !== 'chats' && prev === 'chats') {
      history.pushState({ h2vPanel: current }, '');
    } else if (current === 'chats' && prev !== 'chats' && history.state?.h2vPanel) {
      suppressNextPop = true;
      history.back();
    }
    return current;
  }, 'chats' as LeftPanel);

  // Right panel (user/group profile) history
  createEffect((prev: { user?: string; group?: string } | null) => {
    const uid = uiStore.viewingUserId();
    const gid = uiStore.viewingGroupId();
    const key = uid ? 'user' : gid ? 'group' : null;
    const id = uid ?? gid ?? null;
    if (id && !prev) {
      history.pushState({ h2vRightPanel: key, h2vRightPanelId: id }, '');
    } else if (!id && prev && history.state?.h2vRightPanel) {
      suppressNextPop = true;
      history.back();
    }
    return id ? { [key!]: id } : null;
  }, null as { user?: string; group?: string } | null);

  // Contacts panel history
  createEffect((prev: boolean) => {
    const open = showContacts();
    if (open && !prev) {
      history.pushState({ h2vContacts: true }, '');
    } else if (!open && prev && history.state?.h2vContacts) {
      suppressNextPop = true;
      history.back();
    }
    return open;
  }, false);

  onMount(() => {
    function onPopState() {
      if (suppressNextPop) { suppressNextPop = false; return; }
      if (showContacts()) {
        setShowContacts(false);
      } else if (uiStore.viewingUserId()) {
        uiStore.closeUserProfile();
      } else if (uiStore.viewingGroupId()) {
        uiStore.closeGroupProfile();
      } else if (uiStore.leftPanel() !== 'chats') {
        uiStore.backToChats();
      } else if (chatStore.activeChatId()) {
        chatStore.setActiveChatId(null);
      }
    }
    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));
  });

  const chatOpen = () => !!chatStore.activeChatId();
  const rightPanelOpen = () => !!uiStore.viewingUserId() || !!uiStore.viewingGroupId();
  const leftPanelActive = () => uiStore.leftPanel() !== 'chats';

  return (
    <ErrorBoundary fallback={(err) => (
      <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'min-height': '100vh', background: '#0f0f13', color: '#e8e8f0', 'font-family': 'sans-serif', 'text-align': 'center', padding: '2rem' }}>
        <div>
          <h2 style={{ 'margin-bottom': '1rem' }}>{i18n.t('error.generic')}</h2>
          <p style={{ color: '#888', 'margin-bottom': '1.5rem' }}>{String(err)}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '0.5rem 1.5rem', background: '#7c5cfc', color: '#fff', border: 'none', 'border-radius': '8px', cursor: 'pointer' }}>{i18n.t('app.reload')}</button>
        </div>
      </div>
    )}>
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
          <Show when={e2eInitFailed()}>
            <div class={styles.e2eBanner}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              {i18n.t('e2e.init_failed')}
              <button class={styles.e2eBannerBtn} onClick={() => { setE2eInitFailed(false); const id = authStore.user()?.id; if (id) e2eStore.initE2EStore(id).then(() => setE2eInitFailed(false)).catch(() => setE2eInitFailed(true)); }}>
                {i18n.t('common.retry')}
              </button>
            </div>
          </Show>
        </div>

        <Show when={authStore.user()} fallback={<AuthFlow />}>
          <div class={`${styles.shell} ${chatOpen() ? styles.shellChatOpen : ''} ${rightPanelOpen() ? styles.shellRightOpen : ''}`}>
            <div class={styles.sidebarArea}>
              <Sidebar
                onProfileClick={() => uiStore.openProfile()}
                onSettingsClick={() => uiStore.toggleSettings()}
                onContactsClick={() => setShowContacts(true)}
              />
            </div>

            {/* ── Left panel (chatList area): chats / settings / profile ── */}
            <div class={styles.chatList}>
              <div class={styles.leftPanelContainer}>
                {/* Chats layer */}
                <div class={`${styles.leftLayer} ${leftPanelActive() ? styles.leftLayerBack : ''}`}>
                  <ErrorBoundary fallback={(err, reset) => <PanelFallback err={err} reset={reset} />}>
                    <ChatList
                      onProfileClick={() => uiStore.openProfile()}
                      onSettingsClick={() => uiStore.toggleSettings()}
                    />
                  </ErrorBoundary>
                </div>
                {/* Settings / Profile layer */}
                <div class={`${styles.leftLayer} ${styles.leftLayerSub} ${leftPanelActive() ? styles.leftLayerSubActive : ''}`}>
                  <ErrorBoundary fallback={(err, reset) => <PanelFallback err={err} reset={reset} />}>
                    <Suspense>
                      <Show when={uiStore.leftPanel() === 'settings'}>
                        <SettingsPanel onClose={() => uiStore.backToChats()} onOpenProfile={() => uiStore.openProfile()} />
                      </Show>
                      <Show when={uiStore.leftPanel() === 'profile'}>
                        <ProfilePanel onClose={() => uiStore.backToChats()} />
                      </Show>
                      <Show when={uiStore.leftPanel() === 'archive'}>
                        <ArchivePanel onClose={() => uiStore.backToChats()} />
                      </Show>
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </div>
            </div>

            {/* ── Chat area ── */}
            <div class={styles.chatArea}>
              <ErrorBoundary fallback={(err, reset) => <PanelFallback err={err} reset={reset} />}>
                <MessageArea />
              </ErrorBoundary>
            </div>

            {/* ── Right panel: user profile or group profile (desktop: inline, mobile: fullscreen) ── */}
            <div class={`${styles.rightPanel} ${rightPanelOpen() ? styles.rightPanelOpen : ''}`}>
              <ErrorBoundary fallback={(err, reset) => <PanelFallback err={err} reset={reset} />}>
              <Suspense>
              <Show when={uiStore.viewingUserId()}>
                {(uid) => (
                  <UserProfile
                    userId={uid()}
                    inline
                    onClose={() => uiStore.closeUserProfile()}
                    onStartChat={async (id) => {
                      uiStore.closeUserProfile();
                      await chatStore.startDirectChat(id);
                    }}
                    onStartSecretChat={async (id) => {
                      try {
                        uiStore.closeUserProfile();
                        await chatStore.startSecretChat(id);
                      } catch (err: any) {
                        if (import.meta.env.DEV) console.error('[App] startSecretChat failed:', err);
                      }
                    }}
                  />
                )}
              </Show>
              <Show when={uiStore.viewingGroupId()}>
                {(gid) => {
                  const groupChat = () =>
                    chatStore.chats.find((c) => c.id === gid() && c.type === 'GROUP') ??
                    (chatStore.activeChatId() === gid() ? chatStore.activeChat() : null);
                  return (
                    <Show when={groupChat()}>
                      {(chat) => (
                        <GroupProfile
                          chat={chat()!}
                          inline
                          onClose={() => uiStore.closeGroupProfile()}
                          onOpenUserProfile={(uid) => {
                            uiStore.closeGroupProfile();
                            chatStore.startDirectChat(uid).catch(() => {});
                          }}
                        />
                      )}
                    </Show>
                  );
                }}
              </Show>
              </Suspense>
              </ErrorBoundary>
            </div>
          </div>
          <Show when={showContacts()}>
            <Suspense>
              <ContactsPanel
                onClose={() => setShowContacts(false)}
                onOpenProfile={(userId) => {
                  setShowContacts(false);
                  chatStore.startDirectChat(userId).catch(() => {});
                }}
              />
            </Suspense>
          </Show>
        </Show>
        <InstallBanner />
      </div>
    </Show>
    </ErrorBoundary>
  );
};

export default App;
