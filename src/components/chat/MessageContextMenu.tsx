import {
  type Component, createSignal, createMemo, For, Show, batch,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { e2eStore } from '../../stores/e2e.store';
import { api, mediaUrl } from '../../api/client';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import { uiStore } from '../../stores/ui.store';
import { focusTrap } from '../../utils/focusTrap';
import styles from './MessageContextMenu.module.css';
import type { Chat, Message, User } from '../../types';

false && focusTrap;

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

interface MessageContextMenuProps {
  menuMsgId: () => string | null;
  setMenuMsgId: (id: string | null) => void;
  menuPos: () => { x: number; y: number };
  menuSelection: () => string;

  forwardMsg: () => Message | null;
  setForwardMsg: (msg: Message | null) => void;

  deleteModalId: () => string | null;
  setDeleteModalId: (id: string | null) => void;

  chatId: () => string | null | undefined;
  me: () => User | null | undefined;
  chat: () => Chat | undefined;
  onReply: (msg: Message) => void;
  onQuote: (msg: Message, selectedText: string) => void;
  onEdit: (msgId: string, text: string) => void;
  onReaction: (msgId: string, emoji: string) => void;
  onDelete: (msgId: string, forEveryone: boolean) => void;
  onForwardTo: (targetChatId: string, msg: Message) => void;
  onStartSelect?: (msgId: string) => void;
}

const REPORT_REASONS = ['SPAM', 'ABUSE', 'VIOLENCE', 'NSFW', 'OTHER'] as const;
const REPORT_I18N: Record<string, string> = {
  SPAM: 'report.spam', ABUSE: 'report.abuse', VIOLENCE: 'report.violence',
  NSFW: 'report.nsfw', OTHER: 'report.other',
};

const MessageContextMenu: Component<MessageContextMenuProps> = (props) => {
  const [fwdSearch, setFwdSearch] = createSignal('');
  const [reportTarget, setReportTarget] = createSignal<{ targetMessageId?: string; targetUserId?: string } | null>(null);
  const [reportReason, setReportReason] = createSignal<string>('SPAM');
  const [reportDetails, setReportDetails] = createSignal('');
  const [reportSending, setReportSending] = createSignal(false);
  const [reportDone, setReportDone] = createSignal(false);

  async function submitReport() {
    const target = reportTarget();
    if (!target) return;
    setReportSending(true);
    try {
      await api.submitReport({ ...target, reason: reportReason(), details: reportDetails() || undefined });
      setReportDone(true);
      setTimeout(() => { setReportTarget(null); setReportDone(false); setReportDetails(''); }, 1500);
    } catch {
      setReportDone(false);
      uiStore.showActionToast(i18n.t('error.generic'));
    } finally {
      setReportSending(false);
    }
  }

  const filteredChatsForFwd = createMemo(() => {
    const q = fwdSearch().toLowerCase().trim();
    const all = chatStore.chats.filter((c: Chat) => c.type !== 'SECRET');
    if (!q) return all;
    return all.filter((c: Chat) => {
      const n = c.name ?? c.members?.filter((m) => m.user.id !== props.me()?.id).map((m) => displayName(m.user)).join(', ');
      return n?.toLowerCase().includes(q);
    });
  });

  return (
    <>
      {/* Context menu — Portal so it's never clipped by bubble overflow */}
      <Show when={props.menuMsgId()}>
        <Portal>
          <div
            class={styles.ctxOverlay}
            onClick={() => props.setMenuMsgId(null)}
            onContextMenu={(e) => { e.preventDefault(); props.setMenuMsgId(null); }}
          />
          <div
            class={styles.msgCtxWrap}
            style={{ top: props.menuPos().y + 'px', left: props.menuPos().x + 'px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const cid = props.chatId();
              if (!cid) return null;
              const msg = (chatStore.messages[cid] ?? []).find((m) => m.id === props.menuMsgId());
              if (!msg) return null;
              const isMine = msg.sender?.id === props.me()?.id;
              return (
                <>
                  <Show when={!msg.isDeleted}>
                    <div class={styles.msgCtxReactions}>
                      <For each={ALLOWED_REACTIONS}>
                        {(emoji) => (
                          <button class={styles.msgCtxReactionBtn} onClick={() => { props.setMenuMsgId(null); props.onReaction(msg.id, emoji); }}>
                            {emoji}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class={styles.msgCtxMenu} role="menu">
                  <Show when={!msg.isDeleted}>
                    <button role="menuitem" onClick={() => { props.setMenuMsgId(null); props.onReply(msg); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-7a4 4 0 00-4-4H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.reply')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.menuSelection()}>
                    <button role="menuitem" onClick={() => { props.setMenuMsgId(null); props.onQuote(msg, props.menuSelection()); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" fill="currentColor" opacity="0.6"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" fill="currentColor" opacity="0.6"/></svg>
                      {i18n.t('msg.quote')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.chat()?.type !== 'SECRET'}>
                    <button role="menuitem" onClick={() => { props.setMenuMsgId(null); props.setForwardMsg(msg); setFwdSearch(''); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M15 14L20 9l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20v-7a4 4 0 014-4h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.forward')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.chat()?.type !== 'SECRET'}>
                    <button role="menuitem" onClick={() => { props.setMenuMsgId(null); navigator.clipboard?.writeText(msg.text ?? e2eStore.getDecryptedText(msg.id) ?? ''); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>
                      {i18n.t('msg.copy')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.chat()?.type !== 'SECRET'}>
                    <button role="menuitem" onClick={() => {
                      props.setMenuMsgId(null);
                      const isPinned = props.chat()?.pinnedMessageId === msg.id;
                      const pinCid = props.chatId(); if (pinCid) api.pinMessage(pinCid, isPinned ? null : msg.id).catch(() => {
                        uiStore.showActionToast(i18n.t('error.generic'));
                      });
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2v8m0 0l-3-3m3 3l3-3M12 18v4m-4-4h8l-1-4H9l-1 4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {props.chat()?.pinnedMessageId === msg.id ? i18n.t('msg.unpin') : i18n.t('msg.pin')}
                    </button>
                  </Show>
                  <Show when={isMine && !msg.isDeleted}>
                    <button role="menuitem" onClick={() => {
                      props.setMenuMsgId(null);
                      props.onEdit(msg.id, msg.text ?? e2eStore.getDecryptedText(msg.id) ?? '');
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.edit')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.onStartSelect}>
                    <button role="menuitem" onClick={() => { props.setMenuMsgId(null); props.onStartSelect?.(msg.id); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.select')}
                    </button>
                  </Show>
                  <Show when={!isMine && !msg.isDeleted && props.chat()?.type === 'GROUP'}>
                    <button role="menuitem" onClick={() => {
                      props.setMenuMsgId(null);
                      setReportTarget({ targetMessageId: msg.id, targetUserId: msg.sender?.id });
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      {i18n.t('report.title')}
                    </button>
                  </Show>
                  <div class={styles.msgCtxDivider} />
                  <button role="menuitem" class={styles.msgCtxDanger} onClick={() => { props.setMenuMsgId(null); props.setDeleteModalId(msg.id); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    {i18n.t('msg.delete')}
                  </button>
                  </div>
                </>
              );
            })()}
          </div>
        </Portal>
      </Show>

      {/* Forward modal */}
      <Show when={props.forwardMsg()}>
        <Portal>
          <div class={styles.modalOverlay} onClick={() => props.setForwardMsg(null)}>
            <div class={styles.modalBox} onClick={(e) => e.stopPropagation()} use:focusTrap role="dialog" aria-modal="true">
              <div class={styles.modalHeader}>{i18n.t('msg.forward_title')}</div>
              <div class={styles.modalSearchWrap}>
                <input
                  class={styles.modalSearchInput}
                  placeholder={i18n.t('msg.search') + '...'}
                  value={fwdSearch()}
                  onInput={(e) => setFwdSearch(e.currentTarget.value)}
                  autofocus
                />
              </div>
              <div class={styles.modalChatList}>
                <Show when={filteredChatsForFwd().length > 0} fallback={
                  <div class={styles.modalEmpty}>{i18n.t('msg.not_found')}</div>
                }>
                  <For each={filteredChatsForFwd()}>
                    {(c) => {
                      const chatName = () => c.name ?? c.members?.filter((m) => m.user.id !== props.me()?.id).map((m) => displayName(m.user)).join(', ') ?? '';
                      const avatar = () => c.avatar ?? c.members?.find((m) => m.user.id !== props.me()?.id)?.user?.avatar;
                      const initial = () => chatName()?.[0]?.toUpperCase() ?? '?';
                      return (
                        <div class={styles.modalChatItem} onClick={() => props.onForwardTo(c.id, props.forwardMsg()!)}>
                          <div class={styles.modalChatAvatar}>
                            <Show when={avatar()} fallback={<span>{initial()}</span>}>
                              <img src={mediaUrl(avatar())} alt="" />
                            </Show>
                          </div>
                          <div class={styles.modalChatName}>{chatName()}</div>
                        </div>
                      );
                    }}
                  </For>
                </Show>
              </div>
              <div class={styles.modalCancel}>
                <button onClick={() => props.setForwardMsg(null)}>{i18n.t('sidebar.cancel')}</button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      {/* Delete confirmation modal */}
      <Show when={props.deleteModalId()}>
        <Portal>
          <div class={styles.modalOverlay} onClick={() => props.setDeleteModalId(null)}>
            <div class={styles.modalBox} onClick={(e) => e.stopPropagation()} use:focusTrap role="dialog" aria-modal="true">
              <div class={styles.modalHeader}>{i18n.t('msg.delete')}</div>
              <div class={styles.modalActions}>
                {(() => {
                  const msgId = props.deleteModalId()!;
                  const delCid = props.chatId();
                  const msg = delCid ? (chatStore.messages[delCid] ?? []).find((m) => m.id === msgId) : undefined;
                  const isMine = msg?.sender?.id === props.me()?.id;
                  return (
                    <>
                      <Show when={isMine}>
                        <button class={styles.msgCtxDanger} onClick={() => props.onDelete(msgId, true)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                          {i18n.t('msg.delete_for_all')}
                        </button>
                      </Show>
                      <button onClick={() => props.onDelete(msgId, false)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                        {i18n.t('msg.delete_for_me')}
                      </button>
                    </>
                  );
                })()}
              </div>
              <div class={styles.modalCancel}>
                <button onClick={() => props.setDeleteModalId(null)}>{i18n.t('sidebar.cancel')}</button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      {/* Report modal */}
      <Show when={reportTarget()}>
        <Portal>
          <div class={styles.modalOverlay} onClick={() => setReportTarget(null)}>
            <div class={styles.modalBox} onClick={(e) => e.stopPropagation()} use:focusTrap role="dialog" aria-modal="true">
              <div class={styles.modalHeader}>{i18n.t('report.title')}</div>
              <Show when={reportDone()} fallback={
                <div class={styles.modalActions} style={{ 'flex-direction': 'column', gap: '10px', padding: '12px 16px' }}>
                  <label style={{ 'font-size': '13px', color: 'var(--text-secondary)' }}>{i18n.t('report.reason')}</label>
                  <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '6px' }}>
                    <For each={REPORT_REASONS}>
                      {(r) => (
                        <button
                          style={{
                            padding: '5px 12px', 'border-radius': '8px', border: 'none', cursor: 'pointer',
                            'font-size': '13px', background: reportReason() === r ? 'var(--accent)' : 'var(--bg-input)',
                            color: reportReason() === r ? '#fff' : 'var(--text-primary)',
                          }}
                          onClick={() => setReportReason(r)}
                        >
                          {i18n.t(REPORT_I18N[r])}
                        </button>
                      )}
                    </For>
                  </div>
                  <textarea
                    rows={3}
                    placeholder={i18n.t('report.details_placeholder')}
                    value={reportDetails()}
                    onInput={(e) => setReportDetails(e.currentTarget.value)}
                    style={{ width: '100%', resize: 'none', background: 'var(--bg-input)', border: '1px solid var(--border-input)', 'border-radius': '8px', padding: '8px 10px', color: 'var(--text-primary)', 'font-size': '13px', 'font-family': 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', 'justify-content': 'flex-end' }}>
                    <button
                      onClick={() => setReportTarget(null)}
                      style={{ padding: '6px 14px', background: 'var(--bg-input)', border: 'none', 'border-radius': '8px', cursor: 'pointer', color: 'var(--text-primary)', 'font-size': '13px' }}
                    >{i18n.t('common.cancel')}</button>
                    <button
                      onClick={submitReport}
                      disabled={reportSending()}
                      style={{ padding: '6px 14px', background: 'var(--accent)', border: 'none', 'border-radius': '8px', cursor: 'pointer', color: '#fff', 'font-size': '13px', opacity: reportSending() ? '0.6' : '1' }}
                    >{reportSending() ? i18n.t('report.sending') : i18n.t('report.send')}</button>
                  </div>
                </div>
              }>
                <div style={{ padding: '24px 16px', 'text-align': 'center', color: 'var(--success)', 'font-size': '14px' }}>
                  {i18n.t('report.success')}
                </div>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
};

export default MessageContextMenu;
