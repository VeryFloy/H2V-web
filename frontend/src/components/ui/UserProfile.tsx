import { type Component, createSignal, createEffect, Show } from 'solid-js';
import { api } from '../../api/client';
import { chatStore } from '../../stores/chat.store';
import { displayName, formatLastSeen } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import type { User } from '../../types';
import styles from './UserProfile.module.css';

interface Props {
  userId: string;
  onClose: () => void;
  onStartChat?: (userId: string) => void;
}

const UserProfile: Component<Props> = (props) => {
  const t = i18n.t;
  const [user, setUser] = createSignal<User | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');

  createEffect(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.getUser(props.userId);
      setUser(res.data);
    } catch {
      setError('Failed to load profile');
    } finally { setLoading(false); }
  });

  const isOnline = () => chatStore.onlineIds().has(props.userId);
  const avatarLetter = () => displayName(user())[0]?.toUpperCase() ?? '?';

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div class={styles.header}>
          <span class={styles.headerTitle}>{t('profile.title')}</span>
          <button class={styles.headerBtn} onClick={props.onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>

        <Show when={loading()}>
          <div class={styles.loading}>...</div>
        </Show>

        <Show when={error()}>
          <div class={styles.error}>{error()}</div>
        </Show>

        <Show when={user()}>
          <div class={styles.avatarSection}>
            <div class={styles.avatar}>
              <Show when={user()!.avatar} fallback={<span class={styles.avatarLetter}>{avatarLetter()}</span>}>
                <img src={user()!.avatar!} alt="" />
              </Show>
            </div>
            <Show when={isOnline()}>
              <div class={styles.onlineBadge} />
            </Show>
          </div>

          <div class={styles.name}>{displayName(user())}</div>
          <div class={`${styles.statusLine} ${isOnline() ? styles.statusOnline : ''}`}>
            {isOnline() ? t('profile.online') : formatLastSeen(user()!.lastOnline)}
          </div>

          <div class={styles.infoSection}>
            <div class={styles.infoRow}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/></svg>
              <div class={styles.infoContent}>
                <div class={styles.infoLabel}>{t('profile.username')}</div>
                <div class={styles.infoValue}>@{user()!.nickname}</div>
              </div>
            </div>
            <Show when={user()!.bio}>
              <div class={styles.infoRow}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="1.8"/></svg>
                <div class={styles.infoContent}>
                  <div class={styles.infoLabel}>{t('profile.about')}</div>
                  <div class={styles.infoValue}>{user()!.bio}</div>
                </div>
              </div>
            </Show>
          </div>

          <Show when={props.onStartChat}>
            <div class={styles.actions}>
              <button class={styles.chatBtn} onClick={() => props.onStartChat?.(props.userId)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                {t('profile.send_message')}
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default UserProfile;
