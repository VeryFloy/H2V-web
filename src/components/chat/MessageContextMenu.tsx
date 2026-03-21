import {
  type Component, createSignal, createMemo, For, Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { e2eStore } from '../../stores/e2e.store';
import { api, mediaUrl } from '../../api/client';
import { displayName } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import styles from './MessageContextMenu.module.css';
import type { Chat, Message, User } from '../../types';

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

const MessageContextMenu: Component<MessageContextMenuProps> = (props) => {
  const [fwdSearch, setFwdSearch] = createSignal('');

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
            style={{ top: Math.max(8, props.menuPos().y - 52) + 'px', left: props.menuPos().x + 'px' }}
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
                  <div class={styles.msgCtxMenu}>
                  <Show when={!msg.isDeleted}>
                    <button onClick={() => { props.setMenuMsgId(null); props.onReply(msg); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-7a4 4 0 00-4-4H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.reply')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.menuSelection()}>
                    <button onClick={() => { props.setMenuMsgId(null); props.onQuote(msg, props.menuSelection()); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" fill="currentColor" opacity="0.6"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" fill="currentColor" opacity="0.6"/></svg>
                      {i18n.t('msg.quote')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.chat()?.type !== 'SECRET'}>
                    <button onClick={() => { props.setMenuMsgId(null); props.setForwardMsg(msg); setFwdSearch(''); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M15 14L20 9l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20v-7a4 4 0 014-4h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.forward')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.chat()?.type !== 'SECRET'}>
                    <button onClick={() => { props.setMenuMsgId(null); navigator.clipboard?.writeText(msg.text ?? e2eStore.getDecryptedText(msg.id) ?? ''); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>
                      {i18n.t('msg.copy')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.chat()?.type !== 'SECRET'}>
                    <button onClick={() => {
                      props.setMenuMsgId(null);
                      const isPinned = props.chat()?.pinnedMessageId === msg.id;
                      const pinCid = props.chatId(); if (pinCid) api.pinMessage(pinCid, isPinned ? null : msg.id).catch(() => {});
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2v8m0 0l-3-3m3 3l3-3M12 18v4m-4-4h8l-1-4H9l-1 4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {props.chat()?.pinnedMessageId === msg.id ? i18n.t('msg.unpin') : i18n.t('msg.pin')}
                    </button>
                  </Show>
                  <Show when={isMine && !msg.isDeleted}>
                    <button onClick={() => {
                      props.setMenuMsgId(null);
                      props.onEdit(msg.id, msg.text ?? e2eStore.getDecryptedText(msg.id) ?? '');
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.edit')}
                    </button>
                  </Show>
                  <Show when={!msg.isDeleted && props.onStartSelect}>
                    <button onClick={() => { props.setMenuMsgId(null); props.onStartSelect?.(msg.id); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.select')}
                    </button>
                  </Show>
                  <div class={styles.msgCtxDivider} />
                  <button class={styles.msgCtxDanger} onClick={() => { props.setMenuMsgId(null); props.setDeleteModalId(msg.id); }}>
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
            <div class={styles.modalBox} onClick={(e) => e.stopPropagation()}>
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
            <div class={styles.modalBox} onClick={(e) => e.stopPropagation()}>
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
    </>
  );
};

export default MessageContextMenu;
