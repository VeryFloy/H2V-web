import { type Component, createSignal, createResource, Show, For } from 'solid-js';
import { api, type SessionInfo } from '../../api/client';
import { i18n } from '../../stores/i18n.store';
import styles from './SessionsPanel.module.css';

interface Props { onClose: () => void; }

function timeAgo(iso: string): string {
  const t = i18n.t;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return t('sessions.active_now') || 'Active now';
  if (mins < 60) return `${mins} ${t('sessions.min_ago') || 'min ago'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${t('sessions.hours_ago') || 'h ago'}`;
  const days = Math.floor(hours / 24);
  return `${days} ${t('sessions.days_ago') || 'd ago'}`;
}

const SessionsPanel: Component<Props> = (props) => {
  const t = i18n.t;
  const [sessions, { refetch }] = createResource(() =>
    api.getSessions().then((r) => r.data ?? []),
  );

  const [confirmId, setConfirmId] = createSignal<string | null>(null);
  const [confirmAll, setConfirmAll] = createSignal(false);

  async function handleTerminate(id: string) {
    try {
      await api.terminateSession(id);
      refetch();
    } catch { /* ignore */ }
    setConfirmId(null);
  }

  async function handleTerminateAll() {
    try {
      await api.terminateOtherSessions();
      refetch();
    } catch { /* ignore */ }
    setConfirmAll(false);
  }

  const otherSessionsExist = () => {
    const list = sessions();
    return list ? list.some((s) => !s.isCurrent) : false;
  };

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class={styles.header}>
          <button class={styles.headerBtn} onClick={props.onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class={styles.headerTitle}>{t('sessions.title') || 'Active Sessions'}</div>
        </div>

        <div class={styles.body}>
          <Show when={!sessions.loading} fallback={<div class={styles.loading}>{t('sessions.loading') || 'Loading...'}</div>}>
            <Show when={(sessions() ?? []).length > 0} fallback={<div class={styles.empty}>{t('sessions.empty') || 'No active sessions'}</div>}>
              <For each={sessions()}>
                {(session: SessionInfo) => (
                  <div class={styles.session}>
                    <div class={`${styles.sessionIcon} ${session.isCurrent ? styles.sessionIconCurrent : ''}`}>
                      <Show when={session.deviceName?.toLowerCase().includes('mobile') || session.deviceName?.toLowerCase().includes('android') || session.deviceName?.toLowerCase().includes('ios')}
                        fallback={
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/>
                            <path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                          </svg>
                        }
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" stroke-width="1.8"/>
                          <circle cx="12" cy="18" r="1" fill="currentColor"/>
                        </svg>
                      </Show>
                    </div>

                    <div class={styles.sessionInfo}>
                      <div class={styles.sessionDevice}>
                        {session.deviceName || t('sessions.unknown_device') || 'Unknown device'}
                        <Show when={session.isCurrent}>
                          <span class={styles.currentBadge}>{t('sessions.this_device') || 'This device'}</span>
                        </Show>
                      </div>
                      <div class={styles.sessionMeta}>
                        {session.ip ?? ''}{session.ip ? ' · ' : ''}{timeAgo(session.lastActiveAt)}
                      </div>
                    </div>

                    <Show when={!session.isCurrent}>
                      <div class={styles.sessionActions}>
                        <button class={styles.terminateBtn} onClick={() => setConfirmId(session.id)} title={t('sessions.terminate') || 'Terminate'}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                          </svg>
                        </button>
                      </div>
                    </Show>
                  </div>
                )}
              </For>

              <Show when={otherSessionsExist()}>
                <div class={styles.terminateAllWrap}>
                  <button class={styles.terminateAllBtn} onClick={() => setConfirmAll(true)}>
                    {t('sessions.terminate_all') || 'Terminate all other sessions'}
                  </button>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>

      {/* Confirm terminate single session */}
      <Show when={confirmId()}>
        <div class={styles.confirmOverlay} onClick={() => setConfirmId(null)}>
          <div class={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <p>{t('sessions.terminate_confirm') || 'Terminate this session? The device will be logged out.'}</p>
            <div class={styles.confirmBtns}>
              <button class={styles.confirmCancel} onClick={() => setConfirmId(null)}>{t('sidebar.cancel') || 'Cancel'}</button>
              <button class={styles.confirmDanger} onClick={() => handleTerminate(confirmId()!)}>{t('sessions.terminate') || 'Terminate'}</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Confirm terminate all other sessions */}
      <Show when={confirmAll()}>
        <div class={styles.confirmOverlay} onClick={() => setConfirmAll(false)}>
          <div class={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <p>{t('sessions.terminate_all_confirm') || 'Terminate all other sessions? All other devices will be logged out.'}</p>
            <div class={styles.confirmBtns}>
              <button class={styles.confirmCancel} onClick={() => setConfirmAll(false)}>{t('sidebar.cancel') || 'Cancel'}</button>
              <button class={styles.confirmDanger} onClick={handleTerminateAll}>{t('sessions.terminate_all') || 'Terminate all'}</button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SessionsPanel;
