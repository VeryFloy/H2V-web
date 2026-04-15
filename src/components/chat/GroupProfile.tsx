import {
  type Component,
  createSignal,
  For,
  Show,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { api, mediaUrl, mediaMediumUrl } from '../../api/client';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { mutedStore } from '../../stores/muted.store';
import type { Chat, ChatMember, User } from '../../types';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import { uiStore } from '../../stores/ui.store';
import { useSwipeBack } from '../../utils/useSwipeBack';
import styles from './GroupProfile.module.css';

interface Props {
  chat: Chat;
  onClose: () => void;
  onOpenUserProfile?: (userId: string) => void;
  inline?: boolean;
}

const GroupProfile: Component<Props> = (props) => {
  const t = i18n.t;
  const me = () => authStore.user();

  const myMember = createMemo(() =>
    props.chat.members.find((m) => m.userId === me()?.id),
  );
  const isOwner = () => myMember()?.role === 'OWNER';
  const isAdmin = () => myMember()?.role === 'ADMIN' || isOwner();

  // ── Escape to close ──
  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(actionErrorTimer);
      clearTimeout(addDebounce);
    });
  });

  // ── Avatar upload ──
  let avatarInput!: HTMLInputElement;
  const [avatarUploading, setAvatarUploading] = createSignal(false);

  async function handleAvatarChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !isOwner()) return;
    setAvatarUploading(true);
    const localUrl = URL.createObjectURL(file);
    chatStore.updateChat(props.chat.id, { avatar: localUrl });
    try {
      const uploadRes = await api.upload(file);
      const url = uploadRes.data?.url;
      if (url) {
        chatStore.updateChat(props.chat.id, { avatar: url });
        await api.updateGroupAvatar(props.chat.id, url).catch(() => showActionError(i18n.t('error.generic')));
      }
    } catch {
      // Keep blob URL displayed if upload fails
    } finally {
      URL.revokeObjectURL(localUrl);
      setAvatarUploading(false);
      (e.target as HTMLInputElement).value = '';
    }
  }

  // ── Rename ──
  const [renaming, setRenaming] = createSignal(false);
  const [newName, setNewName] = createSignal(props.chat.name ?? '');
  const [renameSaving, setRenameSaving] = createSignal(false);
  const [renameError, setRenameError] = createSignal('');

  async function saveRename() {
    const n = newName().trim();
    if (!n || n === props.chat.name) { setRenaming(false); return; }
    setRenameSaving(true);
    setRenameError('');
    try {
      const res = await api.renameGroup(props.chat.id, n);
      chatStore.updateChat(props.chat.id, { name: res.data?.name ?? n });
      setRenaming(false);
    } catch {
      setRenameError(t('grp.rename_error'));
    } finally {
      setRenameSaving(false);
    }
  }

  // ── Description ──
  const [editingDesc, setEditingDesc] = createSignal(false);
  const [newDesc, setNewDesc] = createSignal(props.chat.description ?? '');
  const [descSaving, setDescSaving] = createSignal(false);

  async function saveDescription() {
    const d = newDesc().trim();
    if (d === (props.chat.description ?? '')) { setEditingDesc(false); return; }
    setDescSaving(true);
    try {
      const res = await api.updateGroupDescription(props.chat.id, d);
      chatStore.updateChat(props.chat.id, { description: (res.data?.description ?? d) || null });
      setEditingDesc(false);
    } catch {
      showActionError(t('error.generic') || 'Error');
    } finally {
      setDescSaving(false);
    }
  }

  // ── Confirm modal ──
  const [confirmModal, setConfirmModal] = createSignal<{ title: string; text: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [actionError, setActionError] = createSignal('');
  const [showReport, setShowReport] = createSignal(false);
  const [reportReason, setReportReason] = createSignal<string>('SPAM');
  const [reportDetails, setReportDetails] = createSignal('');
  const [reportSending, setReportSending] = createSignal(false);
  const [reportDone, setReportDone] = createSignal(false);

  async function submitGroupReport() {
    setReportSending(true);
    try {
      await api.submitReport({ targetChatId: props.chat.id, reason: reportReason(), details: reportDetails() || undefined });
      setReportDone(true);
      setTimeout(() => { setShowReport(false); setReportDone(false); setReportDetails(''); }, 1500);
    } catch {} finally { setReportSending(false); }
  }
  let actionErrorTimer: ReturnType<typeof setTimeout>;
  function showActionError(msg: string) {
    clearTimeout(actionErrorTimer);
    setActionError(msg);
    actionErrorTimer = setTimeout(() => setActionError(''), 3500);
  }

  // ── Member context menu ──
  const [memberMenu, setMemberMenu] = createSignal<{ memberId: string; x: number; y: number } | null>(null);
  const [kickingId, setKickingId] = createSignal<string | null>(null);

  function openMemberMenu(e: MouseEvent, userId: string) {
    if (memberMenu()?.memberId === userId) {
      setMemberMenu(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuWidth = 180;
    const x = rect.right + menuWidth > window.innerWidth ? rect.left - menuWidth : rect.right;
    setMemberMenu({ memberId: userId, x, y: rect.bottom + 6 });
  }

  onMount(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(`.${styles.memberMenuBtn}`) || t.closest(`.${styles.memberContextMenu}`)) return;
      setMemberMenu(null);
    };
    document.addEventListener('click', close);
    onCleanup(() => document.removeEventListener('click', close));
  });

  function handleKick(member: ChatMember) {
    setMemberMenu(null);
    setConfirmModal({
      title: t('grp.kick_confirm'),
      text: displayName(member.user),
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setKickingId(member.userId);
        try {
          await api.kickMember(props.chat.id, member.userId);
          chatStore.removeMember(props.chat.id, member.userId);
        } catch {
          showActionError(t('grp.kick_error'));
        } finally {
          setKickingId(null);
        }
      },
    });
  }

  function handleSendMessage(userId: string) {
    setMemberMenu(null);
    props.onClose();
    chatStore.startDirectChat(userId).catch(() => {
      uiStore.showActionToast(i18n.t('error.generic'));
    });
  }

  async function handleChangeRole(member: ChatMember, newRole: 'ADMIN' | 'MEMBER') {
    setMemberMenu(null);
    try {
      const res = await api.changeMemberRole(props.chat.id, member.userId, newRole);
      if (res.data?.members) {
        chatStore.updateChat(props.chat.id, { members: res.data.members });
      }
    } catch {
      showActionError(t('grp.role_error'));
    }
  }

  // ── Add members modal ──
  const [addingMode, setAddingMode] = createSignal(false);
  const [addSearch, setAddSearch] = createSignal('');
  const [addResults, setAddResults] = createSignal<User[]>([]);
  const [addSelected, setAddSelected] = createSignal<User[]>([]);
  const [addSearching, setAddSearching] = createSignal(false);
  const [addSaving, setAddSaving] = createSignal(false);
  const [addError, setAddError] = createSignal('');

  let addDebounce: ReturnType<typeof setTimeout>;

  async function handleAddSearch(q: string) {
    setAddSearch(q);
    clearTimeout(addDebounce);
    if (!q.trim()) { setAddResults([]); return; }
    addDebounce = setTimeout(async () => {
      setAddSearching(true);
      try {
        const res = await api.searchUsers(q.trim());
        const existingIds = new Set(props.chat.members.map((m) => m.userId));
        existingIds.add(me()?.id ?? '');
        const selIds = new Set(addSelected().map((u) => u.id));
        setAddResults(
          (res.data ?? []).filter((u) => !existingIds.has(u.id) && !selIds.has(u.id)),
        );
      } finally {
        setAddSearching(false);
      }
    }, 300);
  }

  function toggleAddUser(user: User) {
    const already = addSelected().find((u) => u.id === user.id);
    if (already) {
      setAddSelected((p) => p.filter((u) => u.id !== user.id));
      setAddResults((p) => [user, ...p]);
    } else {
      setAddSelected((p) => [...p, user]);
      setAddResults((p) => p.filter((u) => u.id !== user.id));
    }
  }

  async function confirmAddMembers() {
    if (!addSelected().length) return;
    setAddSaving(true);
    setAddError('');
    try {
      const res = await api.addMembers(props.chat.id, addSelected().map((u) => u.id));
      if (res.data?.members) {
        chatStore.updateChat(props.chat.id, { members: res.data.members });
      }
      setAddingMode(false);
      setAddSelected([]);
      setAddSearch('');
    } catch {
      setAddError(t('grp.add_error'));
    } finally {
      setAddSaving(false);
    }
  }

  function cancelAdding() {
    setAddingMode(false);
    setAddSelected([]);
    setAddSearch('');
    setAddResults([]);
    setAddError('');
  }

  // ── Invite link ──
  const [inviteLink, setInviteLink] = createSignal<string | null>(null);
  const [inviteLinkLoading, setInviteLinkLoading] = createSignal(false);
  const [inviteCopied, setInviteCopied] = createSignal(false);

  async function generateInviteLink() {
    setInviteLinkLoading(true);
    try {
      const res = await api.createInviteLink(props.chat.id);
      if (res.data?.code) {
        const baseUrl = window.location.origin;
        setInviteLink(`${baseUrl}/join/${res.data.code}`);
      }
    } catch {
      showActionError(t('error.generic') || 'Error');
    } finally {
      setInviteLinkLoading(false);
    }
  }

  async function copyInviteLink() {
    const link = inviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch { /* fallback ignored */ }
  }

  // ── Leave / Delete — remove chat immediately ──
  function handleLeave() {
    setConfirmModal({
      title: t('grp.leave_confirm'),
      text: props.chat.name ?? '',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.leaveChat(props.chat.id);
          chatStore.removeChat(props.chat.id);
          props.onClose();
        } catch {
          setActionError(t('error.generic') || 'Error');
        }
      },
    });
  }

  function handleDelete() {
    setConfirmModal({
      title: t('grp.delete_confirm'),
      text: props.chat.name ?? '',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.deleteGroup(props.chat.id);
          chatStore.removeChat(props.chat.id);
          props.onClose();
        } catch {
          showActionError(t('error.generic') || 'Error');
        }
      },
    });
  }

  function roleLabel(role: string) {
    if (role === 'OWNER') return t('grp.owner');
    if (role === 'ADMIN') return t('grp.admin');
    return '';
  }

  const sortedMembers = createMemo(() =>
    [...props.chat.members].sort((a, b) => {
      const order = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
      return (order[a.role as keyof typeof order] ?? 2) - (order[b.role as keyof typeof order] ?? 2);
    }),
  );

  const activeMember = createMemo(() =>
    memberMenu() ? props.chat.members.find((m) => m.userId === memberMenu()!.memberId) ?? null : null,
  );

  // ── Mute toggle ──
  const isMuted = () => mutedStore.isMuted(props.chat.id);
  function toggleMute() {
    mutedStore.toggle(props.chat.id);
  }

  // ── Media gallery ──
  type GalleryTab = 'media' | 'files' | 'links' | 'voice';
  const [galleryTab, setGalleryTab] = createSignal<GalleryTab>('media');
  const [galleryItems, setGalleryItems] = createSignal<any[]>([]);
  const [galleryLoading, setGalleryLoading] = createSignal(false);
  let _gallerySeq = 0;
  let _galleryCursor: string | null = null;
  createEffect(() => {
    const tab = galleryTab();
    const seq = ++_gallerySeq;
    _galleryCursor = null;
    setGalleryLoading(true);
    api.getSharedMedia(props.chat.id, tab)
      .then((r) => {
        if (seq === _gallerySeq) {
          setGalleryItems(r.data?.items ?? []);
          _galleryCursor = r.data?.nextCursor ?? null;
        }
      })
      .catch(() => { if (seq === _gallerySeq) setGalleryItems([]); })
      .finally(() => { if (seq === _gallerySeq) setGalleryLoading(false); });
  });

  async function loadMoreGallery() {
    if (!_galleryCursor || galleryLoading()) return;
    setGalleryLoading(true);
    try {
      const res = await api.getSharedMedia(props.chat.id, galleryTab(), _galleryCursor);
      const more = res.data?.items ?? [];
      setGalleryItems((prev) => [...prev, ...more]);
      _galleryCursor = res.data?.nextCursor ?? null;
    } catch { /* ignore */ } finally {
      setGalleryLoading(false);
    }
  }

  const swipe = useSwipeBack(() => props.onClose());
  onCleanup(swipe.cleanup);

  const content = (
    <>
    <div
      class={props.inline ? styles.inlineWrap : styles.overlay}
      onClick={props.inline ? undefined : props.onClose}
      onTouchStart={props.inline ? swipe.onTouchStart : undefined}
      onTouchMove={props.inline ? swipe.onTouchMove : undefined}
      onTouchEnd={props.inline ? swipe.onTouchEnd : undefined}
    >
      <div class={props.inline ? styles.inlinePanel : styles.panel} onClick={props.inline ? undefined : (e) => e.stopPropagation()}>

        {/* Header */}
        <div class={styles.header}>
          <button class={styles.closeBtn} onClick={props.onClose} aria-label={t('grp.close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </button>
          <span class={styles.headerTitle}>{t('grp.title')}</span>
          <div style="width:34px" />
        </div>

        <div class={styles.body}>
            {/* Avatar */}
            <div class={styles.avatarSection}>
              <div
                class={`${styles.avatarWrap} ${isOwner() ? styles.avatarWrapEditable : ''}`}
                onClick={() => isOwner() && avatarInput.click()}
              >
                <div class={styles.avatar}>
                  <Show when={props.chat.avatar} fallback={
                    <span class={styles.avatarLetter}>
                      {props.chat.name?.[0]?.toUpperCase() ?? i18n.t('common.group')[0]?.toUpperCase()}
                    </span>
                  }>
                    <img src={mediaUrl(props.chat.avatar)} alt="" />
                  </Show>
                </div>
                <Show when={isOwner()}>
                  <div class={`${styles.avatarOverlay} ${avatarUploading() ? styles.avatarOverlayActive : ''}`}>
                    <Show when={!avatarUploading()} fallback={<div class={styles.avatarSpinner} />}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>
                        <circle cx="12" cy="13" r="4" stroke="white" stroke-width="1.8"/>
                      </svg>
                      <span class={styles.avatarOverlayText}>{t('grp.change_avatar')}</span>
                    </Show>
                  </div>
                </Show>
              </div>
              <input ref={avatarInput} type="file" accept="image/*" style="display:none" onChange={handleAvatarChange} />
            </div>

            {/* Name */}
            <Show when={!renaming()} fallback={
              <div class={styles.renameWrap}>
                <input
                  class={styles.renameInput} value={newName()} maxLength={64}
                  onInput={(e) => setNewName(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false); }}
                  autofocus
                />
                <Show when={renameError()}><p class={styles.renameError}>{renameError()}</p></Show>
                <div class={styles.renameBtns}>
                  <button class={styles.cancelBtn} onClick={() => setRenaming(false)}>{t('grp.cancel')}</button>
                  <button class={styles.saveBtn} onClick={saveRename} disabled={renameSaving() || !newName().trim()}>
                    {renameSaving() ? t('grp.rename_saving') : t('grp.rename_save')}
                  </button>
                </div>
              </div>
            }>
              <div class={styles.groupName}>
                {props.chat.name ?? i18n.t('common.group')}
                <Show when={isOwner()}>
                  <button class={styles.editNameBtn} onClick={() => { setNewName(props.chat.name ?? ''); setRenaming(true); }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </button>
                </Show>
              </div>
            </Show>

            {/* Description */}
            <Show when={!editingDesc()} fallback={
              <div class={styles.renameWrap}>
                <textarea
                  class={styles.renameInput}
                  value={newDesc()}
                  maxLength={512}
                  rows={3}
                  onInput={(e) => setNewDesc(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingDesc(false); }}
                  autofocus
                  style={{ resize: 'vertical', 'min-height': '60px' }}
                />
                <div class={styles.renameBtns}>
                  <button class={styles.cancelBtn} onClick={() => setEditingDesc(false)}>{t('grp.cancel')}</button>
                  <button class={styles.saveBtn} onClick={saveDescription} disabled={descSaving()}>
                    {descSaving() ? '...' : t('grp.rename_save')}
                  </button>
                </div>
              </div>
            }>
              <Show when={props.chat.description} fallback={
                <Show when={isAdmin()}>
                  <button
                    class={styles.addDescBtn}
                    onClick={() => { setNewDesc(''); setEditingDesc(true); }}
                  >
                    {t('grp.add_description') || 'Add description'}
                  </button>
                </Show>
              }>
                <div class={styles.descriptionBlock} onClick={() => { if (isAdmin()) { setNewDesc(props.chat.description ?? ''); setEditingDesc(true); } }}>
                  <p class={styles.descriptionText}>{props.chat.description}</p>
                  <Show when={isAdmin()}>
                    <svg class={styles.descEditIcon} width="11" height="11" viewBox="0 0 24 24" fill="none">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </Show>
                </div>
              </Show>
            </Show>

            {/* Meta chip */}
            <div class={styles.metaRow}>
              <span class={styles.metaChip}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                {props.chat.members.length} {t('grp.members')}
              </span>
            </div>

            {/* Invite link */}
            <Show when={isAdmin()}>
              <div class={styles.inviteSection}>
                <Show when={inviteLink()} fallback={
                  <button class={styles.inviteBtn} onClick={generateInviteLink} disabled={inviteLinkLoading()}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    {inviteLinkLoading() ? '...' : (t('grp.create_invite') || 'Create invite link')}
                  </button>
                }>
                  <div class={styles.inviteLinkRow}>
                    <input class={styles.inviteLinkInput} value={inviteLink()!} readonly onClick={(e) => (e.target as HTMLInputElement).select()} />
                    <button class={styles.inviteCopyBtn} onClick={copyInviteLink}>
                      {inviteCopied() ? (t('grp.copied') || 'Copied!') : (t('grp.copy') || 'Copy')}
                    </button>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Member list section label */}
            <div class={styles.sectionLabel}>
              {t('grp.members')}
              <span class={styles.sectionCount}>{props.chat.members.length}</span>
            </div>

            <div class={styles.memberList}>
              {/* Add members row (style) */}
              <Show when={isAdmin()}>
                <div class={styles.addMemberRow} onClick={() => setAddingMode(true)}>
                  <div class={styles.addMemberIcon}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
                    </svg>
                  </div>
                  <div class={styles.addMemberText}>
                    <div class={styles.addMemberLabel}>{t('grp.add_members')}</div>
                    <div class={styles.addMemberSub}>{t('grp.invite_hint')}</div>
                  </div>
                </div>
              </Show>

              {/* Members */}
              <For each={sortedMembers()}>
                {(member) => {
                  const isMe = () => member.userId === me()?.id;
                  const canKick = () => isOwner() && !isMe() && member.role !== 'OWNER';
                  const online = () => chatStore.onlineIds().has(member.userId);
                  const menuOpen = () => memberMenu()?.memberId === member.userId;

                  return (
                    <div class={`${styles.memberRow} ${menuOpen() ? styles.memberRowActive : ''}`}>
                      <div class={styles.memberAvatarWrap}>
                        <div class={styles.memberAvatar}>
                          <Show when={member.user?.avatar} fallback={
                            <span>{displayName(member.user)[0]?.toUpperCase() ?? '?'}</span>
                          }>
                            <img src={mediaUrl(member.user.avatar)} alt="" />
                          </Show>
                        </div>
                        <Show when={online()}>
                          <div class={styles.onlineDot} />
                        </Show>
                      </div>

                      <div class={styles.memberInfo}>
                        <div class={styles.memberName}>
                          {displayName(member.user)}
                          <Show when={isMe()}>
                            <span class={styles.youBadge}>{t('grp.you')}</span>
                          </Show>
                          <Show when={member.role === 'OWNER'}>
                            <span class={styles.ownerBadge}>👑</span>
                          </Show>
                        </div>
                        <div class={styles.memberSub}>
                          <Show when={roleLabel(member.role)} fallback={
                            <span class={online() ? styles.memberOnline : styles.memberOffline}>
                              {online() ? t('grp.online') : `@${member.user?.nickname ?? ''}`}
                            </span>
                          }>
                            <span class={styles.roleBadge}>{roleLabel(member.role)}</span>
                          </Show>
                        </div>
                      </div>

                      <Show when={!isMe()}>
                        <button
                          class={`${styles.memberMenuBtn} ${menuOpen() ? styles.memberMenuBtnActive : ''}`}
                          onClick={(e) => openMemberMenu(e, member.userId)}
                          title={i18n.t('common.actions')}
                          disabled={kickingId() === member.userId}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                          </svg>
                        </button>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>

            {/* ── Group settings (Telegram-style) ── */}
            <div class={styles.settingsSection}>
              <div class={styles.settingsSectionTitle}>{t('grp.settings')}</div>
              <div class={styles.settingsRow} onClick={toggleMute}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span class={styles.settingsLabel}>{isMuted() ? t('chats.unmute') : t('chats.mute')}</span>
                <div class={`${styles.settingsToggle} ${isMuted() ? styles.settingsToggleOn : ''}`}>
                  <div class={styles.settingsToggleKnob} />
                </div>
              </div>
            </div>

            {/* ── Media gallery ── */}
            <div class={styles.gallery}>
              <div class={styles.galleryTabs}>
                {(['media', 'files', 'links', 'voice'] as GalleryTab[]).map((tab) => (
                  <button
                    class={`${styles.galleryTab} ${galleryTab() === tab ? styles.galleryTabActive : ''}`}
                    onClick={() => setGalleryTab(tab)}
                  >
                    {t(`gallery.${tab}`)}
                  </button>
                ))}
              </div>
              <div class={styles.galleryContent}>
                <Show when={galleryLoading()}>
                  <div class={styles.galleryEmpty}>...</div>
                </Show>
                <Show when={!galleryLoading() && galleryItems().length === 0}>
                  <div class={styles.galleryEmpty}>{t('gallery.empty')}</div>
                </Show>
                <Show when={!galleryLoading() && galleryItems().length > 0}>
                  <Show when={galleryTab() === 'media'}>
                    <div class={styles.mediaGrid}>
                      <For each={galleryItems()}>
                        {(item) => (
                          <a class={styles.mediaThumb} href={mediaUrl(item.mediaUrl)} target="_blank" rel="noopener">
                            <Show when={item.type === 'VIDEO'} fallback={
                              <img src={mediaMediumUrl(item.mediaUrl)} alt="" loading="lazy" />
                            }>
                              <video src={mediaUrl(item.mediaUrl)} preload="metadata" />
                              <div class={styles.mediaPlay}>▶</div>
                            </Show>
                          </a>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={galleryTab() === 'files'}>
                    <div class={styles.fileList}>
                      <For each={galleryItems()}>
                        {(item) => (
                          <a class={styles.fileRow} href={mediaUrl(item.mediaUrl)} target="_blank" rel="noopener">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/></svg>
                            <span class={styles.fileName}>{item.mediaName || item.mediaUrl?.split('/').pop()}</span>
                          </a>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={galleryTab() === 'links'}>
                    <div class={styles.fileList}>
                      <For each={galleryItems()}>
                        {(item) => {
                          const url = () => item.text?.match(/https?:\/\/[^\s]+/)?.[0] ?? '#';
                          return (
                            <a class={styles.linkRow} href={url()} target="_blank" rel="noopener">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                              <span class={styles.linkText}>{url()}</span>
                            </a>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                  <Show when={galleryTab() === 'voice'}>
                    <div class={styles.fileList}>
                      <For each={galleryItems()}>
                        {(item) => (
                          <a class={styles.fileRow} href={mediaUrl(item.mediaUrl)} target="_blank" rel="noopener">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" stroke-width="1.8"/><path d="M19 10v2a7 7 0 01-14 0v-2" stroke="currentColor" stroke-width="1.8"/></svg>
                            <span class={styles.fileName}>{displayName(item.sender)} · {new Date(item.createdAt).toLocaleDateString()}</span>
                          </a>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={_galleryCursor}>
                    <button class={styles.loadMoreBtn} onClick={loadMoreGallery} disabled={galleryLoading()}>
                      {galleryLoading() ? '...' : t('common.load_more')}
                    </button>
                  </Show>
                </Show>
              </div>
            </div>

            {/* Danger zone */}
            <div class={styles.dangerZone}>
              <button class={styles.leaveBtn} onClick={() => setShowReport(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                {t('report.title')}
              </button>
              <button class={styles.leaveBtn} onClick={handleLeave}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {t('grp.leave')}
              </button>
              <Show when={isOwner()}>
                <button class={styles.deleteBtn} onClick={handleDelete}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  {t('grp.delete')}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>

      {/* ─── "Add Members" full-screen modal (style) ─── */}
      <Show when={addingMode()}>
        <div class={styles.addOverlay} onClick={cancelAdding}>
          <div class={styles.addSheet} onClick={(e) => e.stopPropagation()}>
            {/* Add sheet header */}
            <div class={styles.addSheetHeader}>
              <button class={styles.addSheetBack} onClick={cancelAdding}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div class={styles.addSheetTitleWrap}>
                <span class={styles.addSheetTitle}>{t('grp.add_members')}</span>
                <Show when={addSelected().length > 0}>
                  <span class={styles.addSheetCount}>{addSelected().length}</span>
                </Show>
              </div>
              <Show when={addSelected().length > 0}>
                <button
                  class={styles.addSheetDone}
                  onClick={confirmAddMembers}
                  disabled={addSaving()}
                >
                  {addSaving() ? '...' : t('grp.done')}
                </button>
              </Show>
            </div>

            {/* Search bar */}
            <div class={styles.addSheetSearch}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class={styles.addSheetSearchIcon}>
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <input
                class={styles.addSheetInput}
                type="text"
                placeholder={t('grp.add_search')}
                value={addSearch()}
                onInput={(e) => handleAddSearch(e.currentTarget.value)}
                autofocus
              />
              <Show when={addSearch()}>
                <button class={styles.addSheetClear} onClick={() => { setAddSearch(''); setAddResults([]); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                  </svg>
                </button>
              </Show>
            </div>

            {/* Selected chips strip */}
            <Show when={addSelected().length > 0}>
              <div class={styles.addSheetChips}>
                <For each={addSelected()}>
                  {(user) => (
                    <div class={styles.addSheetChip} onClick={() => toggleAddUser(user)}>
                      <div class={styles.addSheetChipAvatar}>
                        <Show when={user.avatar} fallback={
                          <span>{displayName(user)[0]?.toUpperCase()}</span>
                        }>
                          <img src={mediaUrl(user.avatar)} alt="" />
                        </Show>
                        <div class={styles.addSheetChipX}>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="3" stroke-linecap="round"/>
                          </svg>
                        </div>
                      </div>
                      <span class={styles.addSheetChipName}>{displayName(user).split(' ')[0]}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Results list */}
            <div class={styles.addSheetList}>
              <Show when={addSearching()}>
                <div class={styles.addSheetHint}>{t('grp.searching')}</div>
              </Show>
              <Show when={!addSearching() && !addSearch().trim()}>
                <div class={styles.addSheetHint}>{t('grp.type_hint')}</div>
              </Show>
              <Show when={!addSearching() && addSearch().trim() && !addResults().length}>
                <div class={styles.addSheetHint}>{t('grp.not_found')}</div>
              </Show>
              <For each={addResults()}>
                {(user) => {
                  const isSelected = () => !!addSelected().find((u) => u.id === user.id);
                  return (
                    <div
                      class={`${styles.addSheetRow} ${isSelected() ? styles.addSheetRowSelected : ''}`}
                      onClick={() => toggleAddUser(user)}
                    >
                      <div class={styles.addSheetRowAvatar}>
                        <Show when={user.avatar} fallback={
                          <span>{displayName(user)[0]?.toUpperCase()}</span>
                        }>
                          <img src={mediaUrl(user.avatar)} alt="" />
                        </Show>
                        <Show when={chatStore.onlineIds().has(user.id)}>
                          <div class={styles.addSheetOnlineDot} />
                        </Show>
                      </div>
                      <div class={styles.addSheetRowInfo}>
                        <div class={styles.addSheetRowName}>{displayName(user)}</div>
                        <div class={styles.addSheetRowNick}>@{user.nickname}</div>
                      </div>
                      <div class={`${styles.addSheetCheckbox} ${isSelected() ? styles.addSheetCheckboxChecked : ''}`}>
                        <Show when={isSelected()}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>

            <Show when={addError()}>
              <div class={styles.addSheetError}>{addError()}</div>
            </Show>

            {/* Floating Done button */}
            <Show when={addSelected().length > 0}>
              <div class={styles.addSheetFooter}>
                <button class={styles.addSheetDoneBtn} onClick={confirmAddMembers} disabled={addSaving()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  {addSaving() ? `${t('grp.adding')}` : `${t('grp.add_count')} · ${addSelected().length}`}
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* ─── Action error toast ─── */}
      <Show when={actionError()}>
        <div class={styles.actionError}>{actionError()}</div>
      </Show>

      {/* ─── Confirm modal ─── */}
      <Show when={confirmModal()}>
        {(modal) => (
          <div class={styles.confirmOverlay} onClick={() => setConfirmModal(null)}>
            <div class={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
              <div class={styles.confirmTitle}>{modal().title}</div>
              <Show when={modal().text}>
                <div class={styles.confirmText}>{modal().text}</div>
              </Show>
              <div class={styles.confirmActions}>
                <button class={styles.confirmCancel} onClick={() => setConfirmModal(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  class={modal().danger ? styles.confirmDanger : styles.confirmOk}
                  onClick={modal().onConfirm}
                >
                  {t('common.confirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* ─── Member context menu ─── */}
      <Show when={memberMenu() && activeMember()}>
        <div
          class={styles.memberContextMenu}
          style={{ top: `${memberMenu()!.y}px`, left: `${memberMenu()!.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button class={styles.ctxItem} onClick={() => { setMemberMenu(null); props.onOpenUserProfile?.(activeMember()!.userId); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
            </svg>
            {t('grp.profile')}
          </button>
          <button class={styles.ctxItem} onClick={() => handleSendMessage(activeMember()!.userId)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            {t('grp.message')}
          </button>
          <Show when={isOwner() && activeMember()!.role === 'MEMBER'}>
            <button class={styles.ctxItem} onClick={() => handleChangeRole(activeMember()!, 'ADMIN')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 15l-2 5-1-3-3-1 5-2 3-11 3 11 5 2-3 1-1 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              {t('grp.make_admin')}
            </button>
          </Show>
          <Show when={isOwner() && activeMember()!.role === 'ADMIN'}>
            <button class={styles.ctxItem} onClick={() => handleChangeRole(activeMember()!, 'MEMBER')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
              </svg>
              {t('grp.remove_admin')}
            </button>
          </Show>
          <Show when={isOwner() && activeMember()!.role !== 'OWNER'}>
            <div class={styles.ctxDivider} />
            <button
              class={`${styles.ctxItem} ${styles.ctxItemDanger}`}
              onClick={() => handleKick(activeMember()!)}
              disabled={kickingId() === activeMember()!.userId}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              {t('grp.kick')}
            </button>
          </Show>
        </div>
      </Show>
      {/* Report modal */}
      <Show when={showReport()}>
        <Portal>
          <div style="position:fixed;inset:0;z-index:9100;background:var(--bg-overlay);display:flex;align-items:center;justify-content:center" onClick={() => setShowReport(false)}>
            <div style="background:var(--bg-dialog);border-radius:14px;width:min(360px,90vw);overflow:hidden" onClick={(e: MouseEvent) => e.stopPropagation()}>
              <div style="padding:16px;font-weight:600;font-size:15px;text-align:center;border-bottom:1px solid var(--border-primary)">{t('report.title')}</div>
              <Show when={reportDone()} fallback={
                <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
                  <label style="font-size:13px;color:var(--text-secondary)">{t('report.reason')}</label>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    {(['SPAM', 'ABUSE', 'VIOLENCE', 'NSFW', 'OTHER'] as const).map(r => (
                      <button
                        style={{
                          padding: '5px 12px', 'border-radius': '8px', border: 'none', cursor: 'pointer',
                          'font-size': '13px', background: reportReason() === r ? 'var(--accent)' : 'var(--bg-input)',
                          color: reportReason() === r ? '#fff' : 'var(--text-primary)',
                        }}
                        onClick={() => setReportReason(r)}
                      >{t(`report.${r.toLowerCase()}`)}</button>
                    ))}
                  </div>
                  <textarea rows={3} placeholder={t('report.details_placeholder')} value={reportDetails()} onInput={(e) => setReportDetails(e.currentTarget.value)}
                    style="width:100%;resize:none;background:var(--bg-input);border:1px solid var(--border-input);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;font-family:inherit" />
                  <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button onClick={() => setShowReport(false)} style="padding:6px 14px;background:var(--bg-input);border:none;border-radius:8px;cursor:pointer;color:var(--text-primary);font-size:13px">{t('common.cancel')}</button>
                    <button onClick={submitGroupReport} disabled={reportSending()} style={`padding:6px 14px;background:var(--accent);border:none;border-radius:8px;cursor:pointer;color:#fff;font-size:13px;opacity:${reportSending() ? '0.6' : '1'}`}>{reportSending() ? t('report.sending') : t('report.send')}</button>
                  </div>
                </div>
              }>
                <div style="padding:24px 16px;text-align:center;color:var(--success);font-size:14px">{t('report.success')}</div>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
  return props.inline ? content : <Portal>{content}</Portal>;
};

export default GroupProfile;
