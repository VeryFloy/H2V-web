import { type Component, createResource, createSignal, createEffect, Show } from 'solid-js';
import { api, mediaUrl } from '../../api/client';
import { chatStore } from '../../stores/chat.store';
import { displayName, formatLastSeen } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import styles from './UserProfile.module.css';

interface Props {
  userId: string;
  onClose: () => void;
  onStartChat?: (userId: string) => void;
  onStartSecretChat?: (userId: string) => void;
}

const UserProfile: Component<Props> = (props) => {
  const t = i18n.t;

  const [userData] = createResource(
    () => props.userId,
    (id) => api.getUser(id).then((r) => r.data),
  );

  const isOnline = () => chatStore.onlineIds().has(props.userId);
  const avatarLetter = () => displayName(userData())[0]?.toUpperCase() ?? '?';

  const [isBlockedState, setIsBlockedState] = createSignal(false);
  createEffect(() => {
    const uid = props.userId;
    api.getBlockedUsers().then(r => {
      setIsBlockedState(r.data?.includes(uid) ?? false);
    }).catch(() => {});
  });

  const [blockLoading, setBlockLoading] = createSignal(false);

  async function toggleBlock() {
    if (blockLoading()) return;
    setBlockLoading(true);
    try {
      if (isBlockedState()) {
        await api.unblockUser(props.userId);
        setIsBlockedState(false);
      } else {
        await api.blockUser(props.userId);
        setIsBlockedState(true);
      }
    } catch {
      console.error('[UserProfile] toggleBlock failed');
    } finally {
      setBlockLoading(false);
    }
  }

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div class={styles.header}>
          <span class={styles.headerTitle}>{t('profile.title')}</span>
          <button class={styles.headerBtn} onClick={props.onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>

        <Show when={userData.loading}>
          <div class={styles.loading}>...</div>
        </Show>

        <Show when={userData.error}>
          <div class={styles.error}>{t('profile.load_error')}</div>
        </Show>

        <Show when={userData()}>
          {(user) => (
            <>
              <div class={styles.avatarSection}>
                <div class={styles.avatar}>
                  <Show when={user().avatar} fallback={<span class={styles.avatarLetter}>{avatarLetter()}</span>}>
                    <img src={mediaUrl(user().avatar)} alt="" />
                  </Show>
                </div>
                <Show when={isOnline()}>
                  <div class={styles.onlineBadge} />
                </Show>
              </div>

              <div class={styles.name}>{displayName(user())}</div>
              <div class={`${styles.statusLine} ${isOnline() ? styles.statusOnline : ''}`}>
                {isOnline() ? t('profile.online') : formatLastSeen(user().lastOnline)}
              </div>

              <div class={styles.infoSection}>
                <div class={styles.infoRow}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/></svg>
                  <div class={styles.infoContent}>
                    <div class={styles.infoLabel}>{t('profile.username')}</div>
                    <div class={styles.infoValue}>@{user().nickname}</div>
                  </div>
                </div>
                <Show when={user().bio}>
                  <div class={styles.infoRow}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="1.8"/></svg>
                    <div class={styles.infoContent}>
                      <div class={styles.infoLabel}>{t('profile.about')}</div>
                      <div class={styles.infoValue}>{user().bio}</div>
                    </div>
                  </div>
                </Show>
              </div>

              <Show when={props.onStartChat || props.onStartSecretChat}>
                <div class={styles.actions}>
                  <Show when={props.onStartChat}>
                    <button class={styles.chatBtn} onClick={() => props.onStartChat?.(props.userId)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {t('profile.send_message')}
                    </button>
                  </Show>
                  <Show when={props.onStartSecretChat}>
                    <button class={styles.secretBtn} onClick={() => props.onStartSecretChat?.(props.userId)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      {t('profile.secret_chat')}
                    </button>
                  </Show>
                </div>
              </Show>

              <button class={styles.blockBtn} onClick={toggleBlock}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="currentColor" stroke-width="2"/></svg>
                {isBlockedState() ? t('msg.unblock') : t('msg.block')}
              </button>
            </>
          )}
        </Show>
      </div>
    </div>
  );
};

export default UserProfile;
