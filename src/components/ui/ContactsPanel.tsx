import { type Component, createSignal, createResource, For, Show } from 'solid-js';
import { api, mediaUrl } from '../../api/client';
import { chatStore } from '../../stores/chat.store';
import { displayName, formatLastSeen } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import { avatarColor } from '../../utils/avatar';
import type { ContactInfo } from '../../types';
import styles from './ContactsPanel.module.css';

interface Props {
  onClose: () => void;
  onOpenProfile?: (userId: string) => void;
}

const ContactsPanel: Component<Props> = (props) => {
  const t = i18n.t;
  const [search, setSearch] = createSignal('');

  const [contacts, { refetch }] = createResource(() => api.getContacts().then(r => r.data));

  const filtered = () => {
    const list = contacts() ?? [];
    const q = search().toLowerCase().trim();
    if (!q) return list;
    return list.filter(c =>
      c.nickname.toLowerCase().includes(q) ||
      (c.firstName ?? '').toLowerCase().includes(q) ||
      (c.lastName ?? '').toLowerCase().includes(q)
    );
  };

  async function handleRemove(e: Event, userId: string) {
    e.stopPropagation();
    try {
      await api.removeContact(userId);
      refetch();
    } catch { /* ignore */ }
  }

  function handleClick(c: ContactInfo) {
    if (props.onOpenProfile) {
      props.onOpenProfile(c.id);
    }
  }

  function getInitial(c: ContactInfo): string {
    return displayName(c)[0]?.toUpperCase() ?? '?';
  }

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div class={styles.header}>
          <span class={styles.headerTitle}>{t('contacts.title')}</span>
          <button class={styles.headerBtn} onClick={props.onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>

        <div class={styles.searchWrap}>
          <input
            class={styles.searchInput}
            type="text"
            placeholder={t('contacts.search')}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>

        <div class={styles.list}>
          <Show when={!contacts.loading && filtered().length === 0}>
            <div class={styles.empty}>{t('contacts.empty')}</div>
          </Show>

          <For each={filtered()}>
            {(c) => {
              const online = () => chatStore.onlineIds().has(c.id) || c.isOnline;
              return (
                <div class={styles.contactRow} onClick={() => handleClick(c)}>
                  <div class={styles.contactAvatar} style={!c.avatar ? { background: avatarColor(c.id) } : undefined}>
                    <Show when={c.avatar} fallback={<span>{getInitial(c)}</span>}>
                      <img src={mediaUrl(c.avatar)} alt="" />
                    </Show>
                    <Show when={online()}>
                      <div class={styles.onlineDot} />
                    </Show>
                  </div>
                  <div class={styles.contactInfo}>
                    <div class={styles.contactName}>
                      {displayName(c)}
                      <Show when={c.isMutual}>
                        <span class={styles.mutualBadge}>{t('contacts.mutual')}</span>
                      </Show>
                    </div>
                    <div class={`${styles.contactStatus} ${online() ? styles.contactStatusOnline : ''}`}>
                      {online() ? t('chats.online') : formatLastSeen(c.lastOnline)}
                    </div>
                  </div>
                  <button class={styles.removeBtn} onClick={(e) => handleRemove(e, c.id)} title={t('contacts.remove')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};

export default ContactsPanel;
