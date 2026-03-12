import { type Component, Show } from 'solid-js';
import { authStore } from '../../stores/auth.store';
import { mediaUrl } from '../../api/client';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import styles from './Sidebar.module.css';

interface Props {
  onProfileClick: () => void;
  onSettingsClick: () => void;
  onContactsClick: () => void;
}

const Sidebar: Component<Props> = (props) => {
  const t = i18n.t;

  return (
    <div class={styles.sidebar}>
      <div class={styles.avatar} onClick={props.onProfileClick} title={t('sidebar.profile')}>
        <Show when={authStore.user()?.avatar} fallback={
          <span>{displayName(authStore.user())[0]?.toUpperCase()}</span>
        }>
          <img src={mediaUrl(authStore.user()!.avatar)} alt="" />
        </Show>
      </div>
      <div class={styles.spacer} />
      <button class={styles.iconBtn} onClick={props.onContactsClick} title={t('contacts.title')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class={styles.iconBtn} onClick={props.onSettingsClick} title={t('sidebar.settings')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  );
};

export default Sidebar;
