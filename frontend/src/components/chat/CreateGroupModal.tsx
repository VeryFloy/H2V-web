import { type Component, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { api, mediaUrl } from '../../api/client';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import type { User } from '../../types';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import styles from './CreateGroupModal.module.css';

interface Props {
  onClose: () => void;
}

const MAX_MEMBERS = 200;

const CreateGroupModal: Component<Props> = (props) => {
  const t = i18n.t;
  const [groupName, setGroupName] = createSignal('');
  const [search, setSearch] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<User[]>([]);
  const [selected, setSelected] = createSignal<User[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal('');

  const isFull = () => selected().length >= MAX_MEMBERS - 1; // -1 for self

  let nameRef!: HTMLInputElement;
  let debounceTimer: ReturnType<typeof setTimeout>;

  onMount(() => {
    if (window.innerWidth > 768) nameRef?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(debounceTimer);
    });
  });

  async function handleSearch(q: string) {
    setSearch(q);
    clearTimeout(debounceTimer);
    if (!q.trim()) { setSearchResults([]); return; }
    debounceTimer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchUsers(q.trim());
        const me = authStore.user();
        const selectedIds = new Set(selected().map((u) => u.id));
        setSearchResults(
          (res.data ?? []).filter((u) => u.id !== me?.id && !selectedIds.has(u.id)),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function addUser(user: User) {
    if (isFull()) { setError(t('group.error_limit')); return; }
    setSelected((prev) => [...prev, user]);
    setSearchResults((prev) => prev.filter((u) => u.id !== user.id));
    setSearch('');
    setError('');
  }

  function removeUser(userId: string) {
    setSelected((prev) => prev.filter((u) => u.id !== userId));
  }

  function initials(name: string) {
    return name.slice(0, 2).toUpperCase();
  }

  async function handleCreate() {
    const name = groupName().trim();
    if (!name) { setError(t('group.error_name')); return; }
    if (selected().length === 0) { setError(t('group.error_members')); return; }
    setError('');
    setCreating(true);
    try {
      const res = await api.createGroup(name, selected().map((u) => u.id));
      chatStore.addChat(res.data);
      chatStore.openChat(res.data.id);
      props.onClose();
    } catch (err: any) {
      const code = err?.code ?? err?.message ?? '';
      if (code.startsWith('PRIVACY_GROUP_INVITE:')) {
        const names = code.replace('PRIVACY_GROUP_INVITE:', '');
        setError(t('group.error_privacy').replace('{names}', names));
      } else {
        setError(t('group.error_create'));
      }
    } finally {
      setCreating(false);
    }
  }

  const canCreate = () => groupName().trim().length > 0 && selected().length > 0;

  return (
    <Portal>
      <div class={styles.overlay} onClick={props.onClose}>
        <div class={styles.modal} onClick={(e) => e.stopPropagation()}>

          {/* Header */}
          <div class={styles.header}>
            <button class={styles.closeBtn} onClick={props.onClose} aria-label={t('group.close')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2"
                  stroke-linecap="round"/>
              </svg>
            </button>
            <h2 class={styles.title}>{t('group.new')}</h2>
            <div style="width:34px" />
          </div>

          <div class={styles.body}>
            {/* Group name */}
            <div class={styles.section}>
              <label class={styles.label}>{t('group.name_label')}</label>
              <div class={styles.nameWrap}>
                <div class={styles.groupIconPreview}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor"
                      stroke-width="2" stroke-linecap="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87" stroke="currentColor" stroke-width="2"
                      stroke-linecap="round"/>
                    <path d="M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2"
                      stroke-linecap="round"/>
                  </svg>
                </div>
                <input
                  ref={nameRef}
                  class={styles.nameInput}
                  type="text"
                  placeholder={t('group.name_placeholder')}
                  maxLength={64}
                  value={groupName()}
                  onInput={(e) => { setGroupName(e.currentTarget.value); setError(''); }}
                />
              </div>
            </div>

            {/* Add members */}
            <div class={styles.section}>
              <label class={styles.label}>
                {t('group.members')}
                <span class={`${styles.countBadge} ${isFull() ? styles.countBadgeFull : ''}`}>
                  {selected().length + 1} / {MAX_MEMBERS}
                </span>
              </label>
              <input
                class={styles.searchInput}
                type="text"
                placeholder={isFull() ? t('group.limit_reached') : t('group.search_placeholder')}
                value={search()}
                disabled={isFull()}
                onInput={(e) => handleSearch(e.currentTarget.value)}
              />
            </div>

            {/* Selected members chips */}
            <Show when={selected().length > 0}>
              <div class={styles.chips}>
                <For each={selected()}>
                  {(user) => (
                    <div class={styles.chip}>
                      <Show when={user.avatar} fallback={
                        <div class={styles.chipAvatar}>{initials(displayName(user))}</div>
                      }>
                        <img class={styles.chipAvatarImg} src={mediaUrl(user.avatar)} alt="" />
                      </Show>
                      <span class={styles.chipName}>{displayName(user)}</span>
                      <button
                        class={styles.chipRemove}
                        onClick={() => removeUser(user.id)}
                        aria-label={t('group.remove')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5"
                            stroke-linecap="round"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Search results */}
            <div class={styles.results}>
              <Show when={searching()}>
                <div class={styles.hint}>{t('group.searching')}</div>
              </Show>
              <Show when={!searching() && search().trim() && searchResults().length === 0}>
                <div class={styles.hint}>{t('group.no_results')}</div>
              </Show>
              <For each={searchResults()}>
                {(user) => (
                  <div class={styles.userRow} onClick={() => addUser(user)}>
                    <div class={styles.userAvatarWrap}>
                      <div class={styles.userAvatar}>
                        <Show when={user.avatar} fallback={
                          <span>{initials(displayName(user))}</span>
                        }>
                          <img src={mediaUrl(user.avatar)} alt="" />
                        </Show>
                      </div>
                      <Show when={chatStore.onlineIds().has(user.id)}>
                        <div class={styles.onlineDot} />
                      </Show>
                    </div>
                    <div class={styles.userInfo}>
                      <div class={styles.userName}>{displayName(user)}</div>
                      <div class={styles.userNick}>@{user.nickname}</div>
                    </div>
                    <div class={styles.addIcon}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
                        <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2"
                          stroke-linecap="round"/>
                      </svg>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Footer */}
          <div class={styles.footer}>
            <Show when={error()}>
              <p class={styles.error}>{error()}</p>
            </Show>
            <button
              class={styles.createBtn}
              onClick={handleCreate}
              disabled={!canCreate() || creating()}
            >
              <Show when={creating()} fallback={
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor"
                      stroke-width="2" stroke-linecap="round"/>
                    <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  {t('group.create_btn')}
                  <Show when={selected().length > 0}>
                    <span class={styles.memberCount}>· {selected().length + 1} {t('group.members_short')}</span>
                  </Show>
                </>
              }>
                {t('group.creating')}
              </Show>
            </button>
          </div>

        </div>
      </div>
    </Portal>
  );
};

export default CreateGroupModal;
