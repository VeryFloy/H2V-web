import { type Component, For, Show, createSignal } from 'solid-js';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { mutedStore } from '../../stores/muted.store';
import { uiStore } from '../../stores/ui.store';
import { mediaUrl } from '../../api/client';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import { avatarColor } from '../../utils/avatar';
import type { Chat, User } from '../../types';
import styles from './ArchivePanel.module.css';

function getChatPartner(chat: Chat): User | null {
  const me = authStore.user();
  return chat.members.find((m) => m.user.id !== me?.id)?.user ?? null;
}
function getChatName(chat: Chat): string {
  if (chat.type === 'SELF') return i18n.t('sidebar.saved_messages');
  if (chat.type === 'DIRECT' || chat.type === 'SECRET') return displayName(getChatPartner(chat));
  return chat.name ?? i18n.t('common.group');
}
function getChatAvatar(chat: Chat): string | null {
  if (chat.type === 'SELF') return null;
  if (chat.type === 'DIRECT' || chat.type === 'SECRET') return getChatPartner(chat)?.avatar ?? null;
  return chat.avatar;
}
function getChatColorId(chat: Chat): string {
  if (chat.type === 'DIRECT' || chat.type === 'SECRET') return getChatPartner(chat)?.id ?? chat.id;
  return chat.id;
}
function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diff = now.getTime() - d.getTime();
  if (diff < 7 * 86400000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

interface Props { onClose: () => void; }

const ArchivePanel: Component<Props> = (props) => {
  const t = i18n.t;
  const [menuOpen, setMenuOpen] = createSignal(false);

  function markAllRead() {
    for (const c of chatStore.archivedChats) chatStore.clearUnread(c.id);
    setMenuOpen(false);
  }
  function toggleListVisibility() {
    uiStore.setArchiveVisibleInList(!uiStore.archiveVisibleInList());
    setMenuOpen(false);
  }
  function handleOpen(chatId: string) {
    chatStore.openChat(chatId);
    props.onClose();
  }

  return (
    <div class={styles.panel}>
      <div class={styles.header}>
        <button class={styles.backBtn} onClick={props.onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class={styles.headerTitle}>{t('sidebar.archive')}</div>
        <span class={styles.headerCount}>{chatStore.archivedChats.length}</span>
        <div style="position:relative">
          <button class={styles.menuBtn} onClick={() => setMenuOpen((v) => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
              <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
            </svg>
          </button>
          <Show when={menuOpen()}>
            <div class={styles.menuDrop} onClick={(e) => e.stopPropagation()}>
              <button onClick={toggleListVisibility}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <Show when={uiStore.archiveVisibleInList()} fallback={
                    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></>
                  }>
                    <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></>
                  </Show>
                </svg>
                {uiStore.archiveVisibleInList() ? t('archive.hide_from_list') : t('archive.show_in_list')}
              </button>
              <button onClick={markAllRead}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {t('archive.mark_all_read')}
              </button>
            </div>
          </Show>
        </div>
      </div>
      <div class={styles.list} onClick={() => setMenuOpen(false)}>
        <Show when={chatStore.archivedChats.length > 0} fallback={
          <div class={styles.empty}>{t('chats.archive_empty')}</div>
        }>
          <For each={chatStore.archivedChats}>
            {(chat) => {
              const me = () => authStore.user();
              const msg = () => chat.lastMessage;
              const mine = () => msg()?.sender?.id === me()?.id;
              const previewText = () => {
                const m = msg();
                if (!m) return '';
                if (m.isDeleted) return t('chats.deleted');
                const prefix = mine() ? `${t('chats.you')}: ` : '';
                return prefix + (m.text || (m.type === 'FILE' ? '📎 ' + t('chats.file') : m.type === 'AUDIO' ? '🎤 ' + t('chats.voice') : ''));
              };
              const unread = () => chatStore.unreadCounts[chat.id] ?? 0;
              const isMuted = () => mutedStore.isMuted(chat.id);
              return (
                <div
                  style="display:flex;align-items:center;gap:12px;padding:10px 12px;cursor:pointer;transition:background 0.12s"
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-input)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  onClick={() => handleOpen(chat.id)}
                >
                  <div style={`width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;overflow:hidden;flex-shrink:0;${getChatAvatar(chat) ? '' : `background:${chat.type === 'SELF' ? 'linear-gradient(135deg,var(--accent),#06b6d4)' : avatarColor(getChatColorId(chat))}`}`}>
                    <Show when={getChatAvatar(chat)} fallback={
                      <span>{initials(getChatName(chat))}</span>
                    }>
                      <img src={mediaUrl(getChatAvatar(chat))} alt="" style="width:100%;height:100%;object-fit:cover" />
                    </Show>
                  </div>
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;justify-content:space-between">
                      <span style="font-size:14px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{getChatName(chat)}</span>
                      <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0;margin-left:8px">{formatTime(msg()?.createdAt)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
                      <span style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1">{previewText()}</span>
                      <Show when={unread() > 0}>
                        <span style={`flex-shrink:0;min-width:20px;height:20px;padding:0 5px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;background:${isMuted() ? 'var(--bg-toggle)' : 'var(--accent)'};${isMuted() ? 'color:var(--text-secondary)' : ''}`}>{unread() > 99 ? '99+' : unread()}</span>
                      </Show>
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
};

export default ArchivePanel;
