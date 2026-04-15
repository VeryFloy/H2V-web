import { type Component, createSignal, Show, onCleanup } from 'solid-js';
import { authStore } from '../../stores/auth.store';
import { api, mediaUrl } from '../../api/client';
import { getErrMsg } from '../../utils/error';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import { useSwipeBack } from '../../utils/useSwipeBack';
import styles from './ProfilePanel.module.css';

const BIO_MAX = 70;

interface Props { onClose: () => void; }

const ProfilePanel: Component<Props> = (props) => {
  const t = i18n.t;
  const [editMode, setEditMode] = createSignal(false);
  const [firstName, setFirstName] = createSignal(authStore.user()?.firstName ?? '');
  const [lastName, setLastName] = createSignal(authStore.user()?.lastName ?? '');
  const [nickname, setNickname] = createSignal(authStore.user()?.nickname ?? '');
  const [bio, setBio] = createSignal(authStore.user()?.bio ?? '');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [avatarMenu, setAvatarMenu] = createSignal(false);

  let fileInputRef: HTMLInputElement | undefined;

  function enterEdit() {
    setFirstName(authStore.user()?.firstName ?? '');
    setLastName(authStore.user()?.lastName ?? '');
    setNickname(authStore.user()?.nickname ?? '');
    setBio(authStore.user()?.bio ?? '');
    setError('');
    setEditMode(true);
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    const nick = nickname().trim();
    const currentNick = authStore.user()?.nickname ?? '';
    const nickChanged = nick !== currentNick;

    if (nickChanged) {
      if (nick.length < 5) { setError(t('auth.nick_min')); return; }
      if (!/^[a-zA-Z][a-zA-Z0-9.]{4,31}$/.test(nick)) {
        setError(t('auth.nick_format'));
        return;
      }
    }

    setError(''); setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: firstName().trim() || null,
        lastName: lastName().trim() || null,
        bio: bio().trim() || null,
      };
      if (nickChanged) payload.nickname = nick;

      const res = await api.updateMe(payload);
      authStore.updateUserLocally(res.data);
      setSuccess(true);
      setTimeout(() => { setSuccess(false); setEditMode(false); }, 800);
    } catch (err) {
      setError(getErrMsg(err, t('profile.save_error')));
    } finally { setSaving(false); }
  }

  function handleAvatarClick() {
    if (user()?.avatar) {
      setAvatarMenu(!avatarMenu());
    } else {
      fileInputRef?.click();
    }
  }

  async function handleAvatarFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    setAvatarMenu(false);
    setUploading(true); setError('');
    try {
      const uploaded = await api.uploadAvatar(file);
      const res = await api.updateMe({ avatar: uploaded.data.url });
      authStore.updateUserLocally(res.data);
    } catch (err) { setError(getErrMsg(err, t('profile.upload_error'))); }
    finally { setUploading(false); }
  }

  async function handleRemoveAvatar() {
    setAvatarMenu(false); setError('');
    try {
      const res = await api.updateMe({ avatar: null });
      authStore.updateUserLocally(res.data);
    } catch (err) { setError(getErrMsg(err, t('error.generic'))); }
  }

  const user = () => authStore.user();
  const avatarLetter = () => displayName(user())[0]?.toUpperCase() ?? '?';

  const swipe = useSwipeBack(() => props.onClose());
  onCleanup(swipe.cleanup);

  return (
    <div class={styles.panel} onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd}>
      <div class={styles.header}>
        <Show when={editMode()} fallback={
          <button class={styles.headerBtn} onClick={props.onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        }>
          <button class={styles.headerBtn} onClick={() => setEditMode(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </Show>
        <span class={styles.headerTitle}>{editMode() ? t('profile.edit') : t('profile.title')}</span>
        <Show when={!editMode()}>
          <button class={styles.headerBtn} onClick={enterEdit} title={t('profile.edit')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </Show>
      </div>

      <div class={styles.body}>
        <div class={styles.avatarSection}>
          <div
            class={`${styles.avatar} ${uploading() ? styles.avatarUploading : ''}`}
            onClick={handleAvatarClick}
          >
            <Show when={user()?.avatar} fallback={<span class={styles.avatarLetter}>{avatarLetter()}</span>}>
              <img src={mediaUrl(user()?.avatar)} alt="" />
            </Show>
            <div class={styles.avatarHover}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="#fff" stroke-width="2"/><circle cx="12" cy="13" r="4" stroke="#fff" stroke-width="2"/></svg>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style="display:none" onChange={handleAvatarFile} />

          <Show when={avatarMenu()}>
            <div class={styles.avatarMenuBackdrop} onClick={() => setAvatarMenu(false)} />
            <div class={styles.avatarMenuPopup}>
              <button onClick={() => { setAvatarMenu(false); fileInputRef?.click(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.8"/></svg>
                {t('profile.upload_photo')}
              </button>
              <button class={styles.avatarMenuDanger} onClick={handleRemoveAvatar}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                {t('profile.remove_photo')}
              </button>
            </div>
          </Show>
        </div>

        <Show when={error()}><div class={styles.error}>{error()}</div></Show>

        <Show when={!editMode()}>
          <div class={styles.name}>{displayName(user())}</div>
          <div class={styles.username}>@{user()?.nickname}</div>

          <div class={styles.infoSection}>
            <Show when={user()?.bio}>
              <div class={styles.infoRow}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="1.8"/></svg>
                <div class={styles.infoContent}>
                  <div class={styles.infoLabel}>{t('profile.about')}</div>
                  <div class={styles.infoValue}>{user()?.bio}</div>
                </div>
              </div>
            </Show>
            <Show when={user()?.email}>
              <div class={styles.infoRow}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" stroke-width="1.8"/><polyline points="22,6 12,13 2,6" stroke="currentColor" stroke-width="1.8"/></svg>
                <div class={styles.infoContent}>
                  <div class={styles.infoLabel}>{t('profile.email')}</div>
                  <div class={styles.infoValue}>{user()?.email}</div>
                </div>
              </div>
            </Show>
            <div class={styles.infoRow}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/></svg>
              <div class={styles.infoContent}>
                <div class={styles.infoLabel}>{t('profile.username')}</div>
                <div class={styles.infoValue}>@{user()?.nickname}</div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={editMode()}>
          <form onSubmit={handleSave} class={styles.form}>
            <div class={styles.fieldGroup}>
              <label class={styles.fieldLabel}>{t('profile.first_name')}</label>
              <input class={styles.fieldInput} value={firstName()} onInput={(e) => setFirstName(e.currentTarget.value)} maxLength={64} placeholder={t('profile.first_name')} />
            </div>
            <div class={styles.fieldGroup}>
              <label class={styles.fieldLabel}>{t('profile.last_name')}</label>
              <input class={styles.fieldInput} value={lastName()} onInput={(e) => setLastName(e.currentTarget.value)} maxLength={64} placeholder={t('profile.last_name')} />
            </div>
            <div class={styles.fieldGroup}>
              <label class={styles.fieldLabel}>{t('profile.username')}</label>
              <div class={styles.usernameWrap}>
                <span class={styles.usernameAt}>@</span>
                <input class={`${styles.fieldInput} ${styles.usernameInput}`} value={nickname()} onInput={(e) => setNickname(e.currentTarget.value.toLowerCase())} maxLength={32} placeholder="username" />
              </div>
              <span class={styles.fieldHint}>{t('profile.username_hint')}</span>
            </div>
            <div class={styles.fieldGroup}>
              <label class={styles.fieldLabel}>{t('profile.about')}</label>
              <textarea
                class={styles.fieldTextarea}
                value={bio()}
                onInput={(e) => setBio(e.currentTarget.value)}
                maxLength={BIO_MAX}
                rows={2}
                placeholder={t('profile.bio_placeholder')}
              />
              <span class={`${styles.fieldHint} ${bio().length >= BIO_MAX ? styles.fieldHintWarn : ''}`}>
                {bio().length}/{BIO_MAX}
              </span>
            </div>

            <button class={styles.saveBtn} type="submit" disabled={saving()}>
              {saving() ? t('profile.saving') : success() ? t('profile.saved') : t('profile.save')}
            </button>
          </form>
        </Show>
      </div>
    </div>
  );
};

export default ProfilePanel;
