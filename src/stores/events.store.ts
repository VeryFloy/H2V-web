import { createEffect, untrack } from 'solid-js';
import { wsStore } from './ws.store';
import { chatStore } from './chat.store';
import { authStore } from './auth.store';
import { settingsStore } from './settings.store';
import { e2eStore } from './e2e.store';
import { mutedStore } from './muted.store';
import type { WsEvent } from '../types';

import { displayName } from '../utils/format';
import { i18n } from './i18n.store';

let audioCtx: AudioContext | null = null;

function playNotification() {
  if (!settingsStore.settings().notifSound) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;
    const play = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.05);
    };
    play(880, 0, 0.1);
    play(1100, 0.12, 0.1);
  } catch { /* ignore if AudioContext not available */ }
}

function showPushNotification(sender: { nickname: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null, text: string | null, chatId: string) {
  if (!settingsStore.settings().notifDesktop) return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (isTabVisible()) return;

  const name = displayName(sender);
  const body = text || `📎 ${i18n.t('common.media')}`;

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'show-notification',
      title: name,
      body,
      icon: sender?.avatar || undefined,
      tag: chatId,
      chatId,
    });
  } else {
    const notif = new Notification(name, {
      body,
      icon: sender?.avatar || undefined,
      tag: chatId,
      silent: false,
    });
    notif.onclick = () => {
      window.focus();
      chatStore.openChat(chatId);
      notif.close();
    };
    setTimeout(() => notif.close(), 5000);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTabVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

const lastReadIds = new Map<string, string>();

function markActiveChatRead() {
  if (!isTabVisible()) return;

  const chatId = chatStore.activeChatId();
  if (!chatId) return;

  const me = authStore.user();
  if (!me) return;

  if (settingsStore.settings().showReadReceipts) {
    const msgs = chatStore.messages[chatId] ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.sender?.id !== me.id && !msg.isDeleted) {
        if (msg.id === lastReadIds.get(chatId)) break;
        lastReadIds.set(chatId, msg.id);
        wsStore.send({
          event: 'message:read',
          payload: { messageId: msg.id, chatId },
        });
        break;
      }
    }
  }

  chatStore.clearUnread(chatId);
}

// ── Main init ─────────────────────────────────────────────────────────────────

export function initWsEvents() {
  const unsub = wsStore.subscribe(async (event: WsEvent) => {
    switch (event.event) {
      case 'chat:new': {
        const exists = chatStore.chats.find((c) => c.id === event.payload.id);
        if (!exists) {
          chatStore.addChat(event.payload);
        }
        break;
      }

      case 'presence:snapshot':
        chatStore.applyPresenceSnapshot(event.payload.onlineUserIds);
        break;

      case 'user:online':
        chatStore.setOnline(event.payload.userId, true);
        break;

      case 'user:offline':
        chatStore.setOnline(event.payload.userId, false);
        if (event.payload.lastOnline) {
          chatStore.setUserLastOnline(event.payload.userId, event.payload.lastOnline);
        }
        break;

      case 'user:updated': {
        chatStore.updateChatUser(event.payload);
        const me = authStore.user();
        if (me && me.id === event.payload.id) {
          authStore.updateUserLocally(event.payload);
        }
        break;
      }

      case 'message:new': {
        const chatId = event.payload.chatId;
        const me = authStore.user();

        const knownChat = chatStore.chats.find((c) => c.id === chatId);
        if (!knownChat) {
          chatStore.loadSingleChat(chatId);
        }

        chatStore.addMessage(event.payload);

        const msg = event.payload;
        const isMyMessage = me && msg.sender?.id === me.id;
        const isChatActive = chatStore.activeChatId() === chatId;

        let decryptedText: string | null = null;
        if (msg.ciphertext && msg.signalType) {
          if (isMyMessage) {
            e2eStore.claimPendingPlaintext(msg.chatId, msg.id);
          } else if (msg.sender?.id) {
            decryptedText = await e2eStore.decrypt(msg.id, msg.sender.id, msg.ciphertext, msg.signalType).catch(() => null);
          }
        }

        if (isMyMessage && isChatActive) {
          chatStore.clearUnread(chatId);
          if (!settingsStore.settings().showReadReceipts) {
            const allMsgs = chatStore.messages[chatId] ?? [];
            for (let i = allMsgs.length - 1; i >= 0; i--) {
              const m = allMsgs[i];
              if (m.sender?.id !== me!.id && !m.isDeleted) {
                if (m.id !== lastReadIds.get(chatId)) {
                  lastReadIds.set(chatId, m.id);
                  wsStore.send({
                    event: 'message:read',
                    payload: { messageId: m.id, chatId },
                  });
                }
                break;
              }
            }
          }
        }

        if (!isMyMessage) {
          if (isChatActive && isTabVisible()) {
            if (settingsStore.settings().showReadReceipts) {
              lastReadIds.set(chatId, event.payload.id);
              wsStore.send({
                event: 'message:read',
                payload: { messageId: event.payload.id, chatId },
              });
            }
            chatStore.clearUnread(chatId);
          } else {
            chatStore.incrementUnread(chatId);
            if (!mutedStore.isMuted(chatId)) {
              playNotification();
              const notifText =
                event.payload.text ??
                (event.payload.ciphertext ? (decryptedText ?? e2eStore.getDecryptedText(event.payload.id) ?? i18n.t('chats.encrypted')) : null);
              showPushNotification(event.payload.sender, notifText, chatId);
            }
          }
        }
        break;
      }

      case 'message:delivered':
        chatStore.markDelivered(event.payload.chatId, event.payload.messageId);
        break;

      case 'message:edited': {
        chatStore.updateMessage(event.payload);
        // If the edit was E2E-encrypted, decrypt the new ciphertext for the recipient.
        // The sender already updated their decryptedTexts cache inside encryptEdit().
        const me = authStore.user();
        const edited = event.payload;
        if (edited.ciphertext && edited.signalType && edited.sender?.id && edited.sender.id !== me?.id) {
          e2eStore.decrypt(edited.id, edited.sender.id, edited.ciphertext, edited.signalType).catch(() => {});
        }
        break;
      }

      case 'message:deleted':
        chatStore.deleteMessage(event.payload.chatId, event.payload.messageId);
        break;

      case 'message:read':
        chatStore.markRead(event.payload.chatId, event.payload.messageId, event.payload.readBy);
        break;

      case 'reaction:added': {
        const { reaction, chatId } = event.payload;
        chatStore.addReaction(chatId, reaction.messageId, reaction);
        break;
      }

      case 'reaction:removed': {
        const { messageId, userId, emoji, chatId } = event.payload;
        chatStore.removeReaction(chatId, messageId, userId, emoji);
        break;
      }

      case 'typing:started':
        chatStore.setTypingUser(event.payload.chatId, event.payload.userId, true);
        break;

      case 'typing:stopped':
        chatStore.setTypingUser(event.payload.chatId, event.payload.userId, false);
        break;

      case 'chat:deleted':
        chatStore.removeChat(event.payload.chatId);
        lastReadIds.delete(event.payload.chatId);
        break;

      case 'chat:updated':
        if (event.payload?.id) {
          chatStore.updateChat(event.payload.id, {
            ...(event.payload.name !== undefined ? { name: event.payload.name } : {}),
            ...(event.payload.avatar !== undefined ? { avatar: event.payload.avatar } : {}),
            ...(event.payload.members ? { members: event.payload.members } : {}),
            ...('pinnedMessageId' in event.payload ? { pinnedMessageId: (event.payload as any).pinnedMessageId } : {}),
          });
        }
        break;

      case 'chat:member-left':
        chatStore.removeMember(event.payload.chatId, event.payload.userId);
        break;
    }
  });

  // ── Read tracking ───────────────────────────────────────────────────────────
  // Reactive effect: fires when the active chat changes OR when messages
  // for that chat are loaded/updated (new message arrives).
  // Calls markActiveChatRead() which only acts when the tab is visible.
  createEffect(() => {
    const chatId = chatStore.activeChatId();
    if (!chatId) return;
    const msgs = chatStore.messages[chatId];
    if (msgs && msgs.length > 0) {
      untrack(() => markActiveChatRead());
    }
  });

  // When the user switches back to this tab, mark any accumulated
  // messages in the active chat as read.
  const onVisChange = () => {
    if (document.visibilityState === 'visible') {
      markActiveChatRead();
    }
  };
  document.addEventListener('visibilitychange', onVisChange);

  // iOS standalone PWA: pageshow fires more reliably than focus
  const onPageShow = () => markActiveChatRead();
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('focus', onPageShow);

  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onVisChange);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('focus', onPageShow);
  };
}
