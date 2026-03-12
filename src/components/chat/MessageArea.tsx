import {
  type Component, createSignal, createEffect, createMemo, For, Show,
  onCleanup, batch, untrack,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { wsStore } from '../../stores/ws.store';
import { api, mediaUrl } from '../../api/client';
import styles from './MessageArea.module.css';
import type { Message, User } from '../../types';
import { displayName } from '../../utils/format';
import { settingsStore } from '../../stores/settings.store';
import { mutedStore } from '../../stores/muted.store';
import { e2eStore } from '../../stores/e2e.store';
import { i18n } from '../../stores/i18n.store';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import MessageContextMenu from './MessageContextMenu';
import MediaPreviewModal, { type MediaPreviewFile } from './MediaPreviewModal';
import MessageBubble, {
  vpSrc, vpPlaying, vpProgress, vpCurrentTime, vpSpeedIdx,
  vpSender, vpMsgTime, vpPlay, vpClose, vpSeekRel, vpCycleSpeed,
  VOICE_SPEEDS, fmtVoice, setVpPlaylist, fallbackWaveform,
} from './MessageBubble';

const GROUP_GAP_MS = 5 * 60 * 1000;

function sameGroup(a: Message, b: Message): boolean {
  if (a.sender?.id !== b.sender?.id) return false;
  return Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < GROUP_GAP_MS;
}


import UserProfile from '../ui/UserProfile';
import GroupProfile from './GroupProfile';

// ────────────────── Profile Panel (inline, for chat header) ──────────────────
const ProfilePanel: Component<{ user: User | null; onClose: () => void }> = (props) => {
  return (
    <Show when={props.user}>
      <UserProfile
        userId={props.user!.id}
        onClose={props.onClose}
        onStartChat={async (uid) => { props.onClose(); await chatStore.startDirectChat(uid); }}
        onStartSecretChat={async (uid) => {
          try { props.onClose(); await chatStore.startSecretChat(uid); }
          catch (err: any) { console.error('[ProfilePanel] startSecretChat failed:', err); }
        }}
      />
    </Show>
  );
};

// ────────────────── Main Component ──────────────────
const MessageArea: Component = () => {
  const [text, setText] = createSignal('');
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editText, setEditText] = createSignal('');
  const [menuMsgId, setMenuMsgId] = createSignal<string | null>(null);
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [replyTo, setReplyTo] = createSignal<Message | null>(null);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQ, setSearchQ] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<Message[]>([]);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);

  interface PendingUpload {
    tempId: string;
    blobUrl: string;
    type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE';
    fileName: string;
    progress: () => number;
    setProgress: (v: number) => void;
    abort: () => void;
  }
  const [pendingUploads, setPendingUploads] = createSignal<PendingUpload[]>([]);
  const [showHeaderMenu, setShowHeaderMenu] = createSignal(false);
  const [showScrollBtn, setShowScrollBtn] = createSignal(false);
  const [newMsgsBadge, setNewMsgsBadge] = createSignal(0);
  const [showUnreadBar, setShowUnreadBar] = createSignal(true);
  const [dragging, setDragging] = createSignal(false);
  const [previewMedia, setPreviewMedia] = createSignal<MediaPreviewFile | null>(null);
  let _dragCounter = 0;
  let _unreadBarTimer: ReturnType<typeof setTimeout> | null = null;
  // Per-chat scroll state — reset on every chat switch
  let _initialScrollDone = false;
  let _lastProcessedMsgId = '';
  const [showProfile, setShowProfile] = createSignal(false);
  const [showGroupProfile, setShowGroupProfile] = createSignal(false);
  const [lbMsgId, setLbMsgId] = createSignal<string | null>(null);
  let lbOriginRect: DOMRect | null = null;
  const [actionError, setActionError] = createSignal('');

  let msgsRef!: HTMLDivElement;
  let bottomSentinelRef!: HTMLDivElement;
  let searchTimer: ReturnType<typeof setTimeout>;
  let typingTimer: ReturnType<typeof setTimeout>;
  let actionErrorTimer: ReturnType<typeof setTimeout>;
  let isTyping = false;
  // atBottom is updated by IntersectionObserver on the bottom sentinel —
  // more reliable than reading scrollTop inside effects (timing issues with
  // overflow-anchor adjustments and SolidJS synchronous effect runs).
  const [atBottom, setAtBottom] = createSignal(true);

  const chatId = () => chatStore.activeChatId();
  const msgs = () => chatStore.messages[chatId() ?? ''] ?? [];
  const me = () => authStore.user();
  const chat = () => chatStore.activeChat();
  const imageMessages = createMemo(() => msgs().filter(m => m.type === 'IMAGE' && m.mediaUrl));
  const lbIdx = createMemo(() => { const id = lbMsgId(); if (!id) return -1; return imageMessages().findIndex(m => m.id === id); });
  function openLightbox(msgId: string, thumbEl?: HTMLElement) { lbOriginRect = thumbEl?.getBoundingClientRect() ?? null; setLbMsgId(msgId); }

  const partner = createMemo(() => {
    const c = chat();
    if (!c || (c.type !== 'DIRECT' && c.type !== 'SECRET')) return null;
    return c.members.find((m) => m.user.id !== me()?.id)?.user ?? null;
  });

  const reversedMsgs = createMemo(() => [...msgs()].reverse());

  // Set up IntersectionObserver via ref callback on the sentinel element.
  // This avoids the onMount timing issue where the sentinel doesn't exist
  // yet (it's inside a conditional Show block).
  let _bottomObserver: IntersectionObserver | null = null;
  function setupBottomSentinel(el: HTMLDivElement) {
    bottomSentinelRef = el;
    _bottomObserver?.disconnect();
    _bottomObserver = new IntersectionObserver(
      ([entry]) => {
        const nowAtBottom = entry.isIntersecting;
        setAtBottom(nowAtBottom);
        if (nowAtBottom) {
          setNewMsgsBadge(0);
          chatStore.clearOpenUnread(chatId() ?? '');
        }
      },
      { root: msgsRef, threshold: 0 },
    );
    _bottomObserver.observe(el);
  }
  onCleanup(() => _bottomObserver?.disconnect());

  // In column-reverse, scrollTop=0 is the bottom, and goes NEGATIVE when scrolled up.
  function scrollDist(): number {
    return msgsRef ? Math.abs(msgsRef.scrollTop) : 0;
  }

  // Find the message element currently visible near the CENTER of the viewport.
  // Returns its data-msg-id so we can reliably restore position later.
  function getVisibleMsgId(): string | null {
    if (!msgsRef) return null;
    const containerRect = msgsRef.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    const msgEls = msgsRef.querySelectorAll('[data-msg-id]');
    let closest: Element | null = null;
    let closestDist = Infinity;
    for (const el of msgEls) {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - centerY);
      if (dist < closestDist) { closestDist = dist; closest = el; }
    }
    return closest?.getAttribute('data-msg-id') ?? null;
  }

  // Save the visible message ID for the current chat
  function saveScrollMsgId(cid: string) {
    if (!msgsRef || scrollDist() < 100) {
      localStorage.removeItem(`h2v_msg_${cid}`);
      return;
    }
    const msgId = getVisibleMsgId();
    if (msgId) {
      localStorage.setItem(`h2v_msg_${cid}`, msgId);
    }
  }

  const _saveOnUnload = () => { const cid = chatId(); if (cid) saveScrollMsgId(cid); };
  window.addEventListener('beforeunload', _saveOnUnload);
  onCleanup(() => window.removeEventListener('beforeunload', _saveOnUnload));

  createEffect(() => {
    const all = msgs();
    setVpPlaylist(all
      .filter(m => m.type === 'AUDIO' && m.mediaUrl)
      .map(m => ({ src: mediaUrl(m.mediaUrl)!, sender: displayName(m.sender), time: fmt(m.createdAt) })));
  });

  // Grouping computed once for ALL messages — single memo instead of per-bubble.
  // Returns a Map so each bubble's g() call is O(1).
  const groupingMap = createMemo(() => {
    const myId = me()?.id;
    const list = reversedMsgs();
    const map = new Map<string, { withBelow: boolean; withAbove: boolean; showAvatar: boolean }>();
    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      const below = i > 0 ? list[i - 1] : null;
      const above = i < list.length - 1 ? list[i + 1] : null;
      const withBelow = !!below && sameGroup(msg, below);
      const withAbove = !!above && sameGroup(msg, above);
      map.set(msg.id, { withBelow, withAbove, showAvatar: msg.sender?.id !== myId && !withBelow });
    }
    return map;
  });

  // Reset all local state when switching chats so nothing leaks between conversations.
  // Also saves the current scroll position to localStorage before switching.
  createEffect((prevId) => {
    const id = chatId();
    if (id !== prevId) {
      // Save visible message ID for the chat we're leaving
      if (prevId) saveScrollMsgId(prevId as string);

      // Reset per-chat scroll state so Effect 1 fires fresh for the new chat
      _initialScrollDone = false;
      _lastProcessedMsgId = '';
      setAtBottom(true);
      setNewMsgsBadge(0);
      // Show unread divider for the new chat, auto-hide after 8 seconds
      setShowUnreadBar(true);
      if (_unreadBarTimer) clearTimeout(_unreadBarTimer);
      _unreadBarTimer = setTimeout(() => setShowUnreadBar(false), 8000);
      // Stop typing indicator for the previous chat before switching
      if (prevId) {
        isTyping = false;
        clearTimeout(typingTimer);
        wsStore.send({ event: 'typing:stop', payload: { chatId: prevId as string } });
      }
      batch(() => {
        setText('');
        setEditingId(null);
        setEditText('');
        setReplyTo(null);
        setSearchOpen(false);
        setSearchQ('');
        setSearchResults([]);
        setMenuMsgId(null);
        setDeleteModalId(null);
        setForwardMsg(null);
      });
    }
    return id;
  }, chatId());

  // ── Effect 1: initial scroll when messages first load for a chat ─────────────
  // Fires once per chat open (guarded by _initialScrollDone).
  // Priority: 1) saved message ID, 2) unread divider, 3) bottom.
  createEffect(() => {
    const list = msgs();
    if (_initialScrollDone || !msgsRef || list.length === 0) return;

    _initialScrollDone = true;
    const cid = chatId() ?? '';

    // 1) Restore position by saved message ID (user was browsing history)
    const savedMsgKey = `h2v_msg_${cid}`;
    const savedMsgId = localStorage.getItem(savedMsgKey);
    if (savedMsgId) {
      localStorage.removeItem(savedMsgKey);
      requestAnimationFrame(() => scrollToMessage(savedMsgId, false));
      return;
    }

    // 2) Scroll to unread divider so user sees "Непрочитанные сообщения" at the top
    //    with new messages below it.
    const unreadAtOpen = chatStore.openUnreadMap[cid] ?? 0;
    if (unreadAtOpen > 0) {
      requestAnimationFrame(() => {
        if (!msgsRef) return;
        const dividerEl = msgsRef.querySelector('[data-unread-divider]') as HTMLElement | null;
        if (dividerEl) {
          dividerEl.scrollIntoView({ block: 'start' });
        } else {
          // Fallback: scroll to the oldest unread message
          const firstUnreadIdx = list.length - unreadAtOpen;
          const firstUnread = list[firstUnreadIdx >= 0 ? firstUnreadIdx : 0];
          if (firstUnread) scrollToMessage(firstUnread.id, false);
        }
      });
      return;
    }

    // 3) No saved position, no unreads → go to bottom (newest)
    msgsRef.scrollTo({ top: 0 });
  });

  // ── Effect 2: real-time message arrived via WebSocket ─────────────────────────
  // NEVER auto-scrolls unless the user is at the very bottom AND actively chatting.
  // If the user is scrolled up at all, they get a badge on the scroll-to-bottom
  // arrow and NO scroll movement happens.
  createEffect(() => {
    const msg = chatStore.latestRealtimeMsg();
    if (!msg || !msgsRef) return;
    if (msg.id === _lastProcessedMsgId) return;
    if (msg.chatId !== chatId()) return;

    _lastProcessedMsgId = msg.id;

    const isAtBottomNow = untrack(atBottom);

    if (isAtBottomNow) {
      // User is at the very bottom — messages naturally push up (column-reverse),
      // no explicit scrollTo needed. The browser keeps the scroll anchored.
    } else {
      // User is reading history — increment badge, DO NOT scroll
      setNewMsgsBadge((n) => n + 1);
    }
  });

  // ESC: cascading close
  createEffect(() => {
    const id = chatId();
    if (!id) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (previewMedia()) { handlePreviewCancel(); return; }
      if (lbMsgId()) { setLbMsgId(null); return; }
      if (forwardMsg()) { setForwardMsg(null); return; }
      if (deleteModalId()) { setDeleteModalId(null); return; }
      if (menuMsgId()) { setMenuMsgId(null); return; }
      if (showHeaderMenu()) { setShowHeaderMenu(false); return; }
      if (searchOpen()) { closeSearch(); return; }
      if (editingId()) { setEditingId(null); return; }
      if (showGroupProfile()) { setShowGroupProfile(false); return; }
      if (showProfile()) { setShowProfile(false); return; }
      chatStore.setActiveChatId(null);
    }
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // Ctrl+V: paste image from clipboard
  createEffect(() => {
    const id = chatId();
    if (!id) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) showMediaPreview(file);
          return;
        }
      }
    }
    document.addEventListener('paste', onPaste);
    onCleanup(() => document.removeEventListener('paste', onPaste));
  });

  function closeSearch() {
    setSearchOpen(false);
    setSearchQ('');
    setSearchResults([]);
  }

  function onScroll() {
    if (!msgsRef) return;
    setShowScrollBtn(scrollDist() > 300);
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    _dragCounter++;
    if (e.dataTransfer?.types.includes('Files')) setDragging(true);
  }
  function onDragOver(e: DragEvent) { e.preventDefault(); }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    _dragCounter--;
    if (_dragCounter <= 0) { _dragCounter = 0; setDragging(false); }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    _dragCounter = 0;
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) showMediaPreview(file);
  }

  function scrollToBottom() {
    msgsRef?.scrollTo({ top: 0, behavior: 'smooth' });
    setNewMsgsBadge(0);
    chatStore.clearOpenUnread(chatId() ?? '');
  }

  function scrollToMessage(msgId: string, highlight = true) {
    if (!msgsRef) return;
    const el = msgsRef.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: highlight ? 'smooth' : 'instant', block: 'center' });
    if (highlight) {
      el.classList.remove(styles.msgHighlight);
      void el.offsetWidth;
      el.classList.add(styles.msgHighlight);
    }
  }

  function handleTyping() {
    const id = chatId();
    if (!id || !wsStore.connected()) return;
    if (!isTyping) {
      isTyping = true;
      wsStore.send({ event: 'typing:start', payload: { chatId: id } });
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      isTyping = false;
      wsStore.send({ event: 'typing:stop', payload: { chatId: id } });
    }, 2000);
  }

  async function handleSend(e?: Event) {
    e?.preventDefault();
    const t = text().trim();
    const id = chatId();
    if (!t || !id) return;
    if (!wsStore.connected()) {
      showActionError(i18n.t('msg.no_connection'));
      const token = localStorage.getItem('accessToken');
      if (token) wsStore.connect(token);
      return;
    }
    const reply = replyTo();
    batch(() => { setText(''); setReplyTo(null); });
    isTyping = false; clearTimeout(typingTimer);
    wsStore.send({ event: 'typing:stop', payload: { chatId: id } });

    const p = partner();
    if (chat()?.type === 'SECRET') {
      if (e2eStore.status() !== 'ready') {
        const myId = me()?.id;
        if (myId && (e2eStore.status() === 'unavailable' || e2eStore.status() === 'error')) {
          await e2eStore.initE2EStore(myId);
        }
        if (e2eStore.status() === 'initializing') {
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (e2eStore.status() !== 'ready') {
          console.error('[Secret] E2E status:', e2eStore.status());
          showActionError(`E2E: ${e2eStore.status()} — reload page`);
          batch(() => { setText(t); setReplyTo(reply); });
          return;
        }
      }
      if (!p) {
        showActionError(i18n.t('error.generic') || 'Error');
        batch(() => { setText(t); setReplyTo(reply); });
        return;
      }
      const enc = await e2eStore.encrypt(id, p.id, t);
      if (!enc) {
        showActionError('E2E: session failed — partner may not have keys');
        batch(() => { setText(t); setReplyTo(reply); });
        return;
      }
      wsStore.send({
        event: 'message:send',
        payload: { chatId: id, ciphertext: enc.ciphertext, signalType: enc.signalType,
          ...(reply ? { replyToId: reply.id } : {}) },
      });
      const myId = me()?.id;
      if (myId) setTimeout(() => e2eStore.checkReplenish(myId), 3000);
      return;
    }

    wsStore.send({
      event: 'message:send',
      payload: { chatId: id, text: t, ...(reply ? { replyToId: reply.id } : {}) },
    });
  }

  async function handleEdit(e?: Event) {
    e?.preventDefault();
    const id = editingId(); const t = editText().trim();
    if (!id || !t) return;
    try {
      const msg = msgs().find((m) => m.id === id);
      const p = partner();
      // Encrypt the edit if the original message was E2E encrypted
      if (msg?.ciphertext && p && chat()?.type === 'SECRET' && e2eStore.status() === 'ready') {
        const enc = await e2eStore.encryptEdit(id, p.id, t);
        if (!enc) { showActionError(i18n.t('msg.encrypt_failed')); return; }
        await api.editMessage(id, { ciphertext: enc.ciphertext, signalType: enc.signalType });
      } else {
        await api.editMessage(id, { text: t });
      }
      setEditingId(null);
    } catch {
      showActionError(i18n.t('msg.edit_failed') || 'Failed to edit message');
    }
  }

  const [deleteModalId, setDeleteModalId] = createSignal<string | null>(null);
  const [forwardMsg, setForwardMsg] = createSignal<Message | null>(null);

  async function handleDelete(msgId: string, forEveryone: boolean) {
    setDeleteModalId(null);
    setMenuMsgId(null);
    try {
      if (!forEveryone) {
        const hidden: string[] = JSON.parse(localStorage.getItem('h2v:hidden_msgs') || '[]');
        hidden.push(msgId);
        if (hidden.length > 1000) hidden.splice(0, hidden.length - 1000);
        localStorage.setItem('h2v:hidden_msgs', JSON.stringify(hidden));
        chatStore.hideMessage(chatId()!, msgId);
      } else {
        await api.deleteMessage(msgId, true);
        chatStore.hideMessage(chatId()!, msgId);
      }
    } catch { showActionError(i18n.t('msg.delete_failed') || 'Failed to delete message'); }
  }

  function handleForwardTo(targetChatId: string, msg: Message) {
    setForwardMsg(null);
    if (!wsStore.connected()) return;
    const senderName = displayName(msg.sender);
    wsStore.send({
      event: 'message:send',
      payload: {
        chatId: targetChatId,
        text: msg.text ?? e2eStore.getDecryptedText(msg.id) ?? null,
        type: msg.type,
        mediaUrl: msg.mediaUrl,
        forwardedFromId: msg.id,
        forwardSenderName: senderName,
      },
    });
  }

  async function handleReaction(msgId: string, emoji: string) {
    const msg = msgs().find((m) => m.id === msgId);
    const isMine = msg?.reactions?.find((r) => r.userId === me()?.id && r.emoji === emoji);
    try {
      if (isMine) await api.removeReaction(msgId, emoji);
      else await api.addReaction(msgId, emoji);
    } catch {
      showActionError(i18n.t('msg.reaction_failed') || 'Failed');
    }
  }

  function classifyFile(file: File): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' {
    if (file.type.startsWith('image/')) return 'IMAGE';
    if (file.type.startsWith('video/')) return 'VIDEO';
    if (file.type.startsWith('audio/')) return 'AUDIO';
    return 'FILE';
  }

  function showMediaPreview(file: File) {
    if (chat()?.type === 'SECRET') {
      showActionError(i18n.t('msg.media_secret_blocked') || 'Media is not encrypted in secret chats');
      return;
    }
    const prev = previewMedia();
    if (prev) URL.revokeObjectURL(prev.blobUrl);
    setPreviewMedia({
      file,
      blobUrl: URL.createObjectURL(file),
      fileType: classifyFile(file),
    });
  }

  function handlePreviewSend(file: File, caption: string, asDocument: boolean) {
    const prev = previewMedia();
    if (prev) URL.revokeObjectURL(prev.blobUrl);
    setPreviewMedia(null);
    doUploadAndSend(file, caption || null, asDocument);
  }

  function handlePreviewCancel() {
    const prev = previewMedia();
    if (prev) URL.revokeObjectURL(prev.blobUrl);
    setPreviewMedia(null);
  }

  function handleFileUpload(file: File) {
    showMediaPreview(file);
  }

  function handleVoiceRecord(file: File) {
    doUploadAndSend(file, null, false);
  }

  function doUploadAndSend(file: File, caption: string | null, asDocument: boolean) {
    const id = chatId();
    if (!id || !wsStore.connected()) return;
    if (chat()?.type === 'SECRET') {
      showActionError(i18n.t('msg.media_secret_blocked') || 'Media is not encrypted in secret chats');
      return;
    }

    const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const blobUrl = URL.createObjectURL(file);
    let fileType = classifyFile(file);
    if (asDocument) fileType = 'FILE';

    const [progress, setProgress] = createSignal(0);
    const reply = replyTo();
    setReplyTo(null);

    const { promise, abort } = api.uploadWithProgress(file, (pct) => {
      setProgress(pct);
    });

    setPendingUploads(prev => [...prev, { tempId, blobUrl, type: fileType, fileName: file.name, progress, setProgress, abort }]);
    setUploading(true);

    promise.then(res => {
      let sendType = res.data.type;
      if (asDocument) sendType = 'FILE';
      wsStore.send({
        event: 'message:send',
        payload: { chatId: id, text: caption || null, mediaUrl: res.data.url, type: sendType,
          mediaName: file.name, mediaSize: file.size,
          ...(reply ? { replyToId: reply.id } : {}) },
      });
    }).catch(() => {
      showActionError(i18n.t('msg.upload_failed') || 'Failed to upload file');
    }).finally(() => {
      URL.revokeObjectURL(blobUrl);
      setPendingUploads(prev => prev.filter(p => p.tempId !== tempId));
      if (pendingUploads().length <= 1) setUploading(false);
    });
  }

  async function handleSearch(q: string) {
    setSearchQ(q);
    clearTimeout(searchTimer);
    const currentChatId = chatId();
    if (!q.trim() || !currentChatId) { setSearchResults([]); return; }

    if (chat()?.type === 'SECRET') {
      searchTimer = setTimeout(() => {
        const lower = q.trim().toLowerCase();
        const all = chatStore.messages[currentChatId] ?? [];
        const found = all.filter((m) => {
          if (m.isDeleted) return false;
          const text = m.text ?? e2eStore.getDecryptedText(m.id);
          return text?.toLowerCase().includes(lower);
        });
        if (chatId() === currentChatId) setSearchResults(found);
      }, 200);
      return;
    }

    searchTimer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.getMessages(currentChatId, undefined, q.trim());
        if (chatId() === currentChatId) setSearchResults(res.data?.messages ?? []);
      } catch {
        if (chatId() === currentChatId) setSearchResults([]);
      } finally {
        if (chatId() === currentChatId) setSearchLoading(false);
      }
    }, 400);
  }

  async function handleLeaveChat() {
    const id = chatId(); if (!id) return;
    try {
      await api.leaveChat(id);
      chatStore.removeChat(id);
    } catch { showActionError(i18n.t('error.generic') || 'Error'); }
  }

  // Watermark: timestamp of the latest message that has a read receipt from
  // someone other than me.  All messages at or before this time are also read.
  // This avoids the problem where the server stores a read receipt for only the
  // LAST read message, but after reload earlier messages lose their "read" status.
  const readWatermark = createMemo<number>(() => {
    const id = chatId();
    if (!id) return 0;
    const msgs = chatStore.messages[id] ?? [];
    const meId = me()?.id;
    if (!meId) return 0;

    let best = 0;
    for (const m of msgs) {
      const t = new Date(m.createdAt).getTime();
      if (t <= best) continue;
      const read =
        (m.readReceipts ?? []).some((r) => r.userId !== meId) ||
        (m.readBy ?? []).some((uid) => uid !== meId);
      if (read) best = t;
    }
    return best;
  });

  const deliveredWatermark = createMemo<number>(() => {
    const id = chatId();
    if (!id) return 0;
    const msgs = chatStore.messages[id] ?? [];
    let best = 0;
    for (const m of msgs) {
      const t = new Date(m.createdAt).getTime();
      if (t <= best) continue;
      if (m.isDelivered) best = t;
    }
    return best;
  });

  function isRead(msg: Message): boolean {
    const meId = me()?.id;
    if (!meId) return false;
    const wm = readWatermark();
    if (wm > 0 && new Date(msg.createdAt).getTime() <= wm) return true;
    if ((msg.readReceipts ?? []).some((r) => r.userId !== meId)) return true;
    return (msg.readBy ?? []).some((uid) => uid !== meId);
  }

  function isDelivered(msg: Message): boolean {
    const wm = deliveredWatermark();
    if (wm > 0 && new Date(msg.createdAt).getTime() <= wm) return true;
    return !!msg.isDelivered;
  }

  function fmt(iso: string): string {
    return new Date(iso).toLocaleTimeString(i18n.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  function dateLabelFor(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = (today.getTime() - msgDay.getTime()) / 86400000;
    if (diff === 0) return i18n.t('date.today');
    if (diff === 1) return i18n.t('date.yesterday');
    return d.toLocaleDateString(i18n.locale(), { day: 'numeric', month: 'long', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function shouldShowDateSep(idx: number): boolean {
    const list = reversedMsgs();
    const msg = list[idx];
    const next = list[idx + 1];
    if (!next) return true;
    const d1 = new Date(msg.createdAt);
    const d2 = new Date(next.createdAt);
    return d1.getFullYear() !== d2.getFullYear() || d1.getMonth() !== d2.getMonth() || d1.getDate() !== d2.getDate();
  }

  onCleanup(() => {
    clearTimeout(searchTimer);
    clearTimeout(actionErrorTimer);
    // Stop typing indicator before unmount so the server doesn't keep us as "typing"
    clearTimeout(typingTimer);
    if (isTyping) {
      const id = chatId();
      if (id && wsStore.connected()) wsStore.send({ event: 'typing:stop', payload: { chatId: id } });
      isTyping = false;
    }
  });

  function showActionError(msg: string) {
    clearTimeout(actionErrorTimer);
    setActionError(msg);
    actionErrorTimer = setTimeout(() => setActionError(''), 3500);
  }

  // ── Mobile swipe-right-to-back gesture ──
  let touchStartX = 0;
  let touchStartY = 0;
  let swiping = false;

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (t.clientX < 40) {
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      swiping = true;
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (!swiping) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartX;
    const dy = Math.abs(t.clientY - touchStartY);
    if (dy > 60) { swiping = false; return; }
    if (dx > 100) {
      swiping = false;
      if (history.state?.h2vChat) history.back();
      else chatStore.setActiveChatId(null);
    }
  }
  function onTouchEnd() { swiping = false; }

  const profileUser = createMemo<User | null>(() => {
    const t = chat()?.type;
    if (t === 'DIRECT' || t === 'SECRET') return partner();
    return null;
  });

  return (
    <Show
      when={chatId()}
      fallback={
        <div class={styles.empty}>
          <div class={styles.emptyIcon}>💬</div>
          <p>{i18n.t('msg.select_chat_hint')}</p>
        </div>
      }
    >
      <div class={styles.wrap} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <Show when={dragging()}>
          <div class={styles.dropOverlay}>
            <div class={styles.dropIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <span>{i18n.t('msg.drop_file')}</span>
          </div>
        </Show>
        <ChatHeader
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchQ={searchQ}
          setSearchQ={setSearchQ}
          searchResults={searchResults}
          setSearchResults={setSearchResults}
          searchLoading={searchLoading}
          showHeaderMenu={showHeaderMenu}
          setShowHeaderMenu={setShowHeaderMenu}
          setShowProfile={setShowProfile}
          setShowGroupProfile={setShowGroupProfile}
          onCloseSearch={closeSearch}
          onHandleSearch={handleSearch}
          onLeaveChat={handleLeaveChat}
        />

        {/* Voice player top bar (style) */}
        <Show when={vpSrc()}>
          <div class={styles.voiceTopBar}>
            <button class={styles.vtbBtn} onClick={() => vpSeekRel(-5)} title="-5s">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 19l-7-7 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 19l-7-7 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class={styles.vtbBtn} onClick={() => vpPlay(vpSrc()!, vpSender(), vpMsgTime())}>
              <Show when={vpPlaying()} fallback={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              }>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              </Show>
            </button>
            <button class={styles.vtbBtn} onClick={() => vpSeekRel(5)} title="+5s">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class={styles.vtbInfo}>
              <span class={styles.vtbSender}>{vpSender()}</span>
              <span class={styles.vtbTime}>{fmtVoice(vpCurrentTime())} • {vpMsgTime()}</span>
            </div>
            <button class={styles.vtbSpeedBtn} onClick={vpCycleSpeed}>{VOICE_SPEEDS[vpSpeedIdx()]}X</button>
            <button class={styles.vtbBtn} onClick={vpClose} title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            </button>
            <div class={styles.vtbProgress} style={{ width: `${vpProgress() * 100}%` }} />
          </div>
        </Show>

        {/* Search results dropdown (absolute, below header) */}
        <Show when={searchOpen() && searchResults().length > 0}>
          <div class={styles.searchResultsList}>
            <For each={searchResults()}>
              {(msg) => (
                <div class={styles.searchResult} onClick={() => { closeSearch(); setTimeout(() => scrollToMessage(msg.id), 100); }}>
                    <span class={styles.searchResultSender}>{msg.sender?.nickname}</span>
                    <span class={styles.searchResultText}>
                      {msg.text ?? e2eStore.getDecryptedText(msg.id) ?? i18n.t('common.media')}
                    </span>
                    <span class={styles.searchResultTime}>{fmt(msg.createdAt)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

        {/* E2E banner for SECRET chats */}
        <Show when={chat()?.type === 'SECRET'}>
          <div class={styles.secretBanner}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            {i18n.t('chat.secret_banner')}
          </div>
        </Show>

        {/* Pinned message banner */}
        <Show when={chat()?.pinnedMessageId}>
          {(pinnedId) => {
            const pinnedMsg = createMemo(() => msgs().find(m => m.id === pinnedId()));
            return (
              <Show when={pinnedMsg()}>
                {(pm) => (
                  <div class={styles.pinnedBanner} onClick={() => scrollToMessage(pm().id)}>
                    <svg class={styles.pinnedBannerIcon} width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2v8m0 0l-3-3m3 3l3-3M12 18v4m-4-4h8l-1-4H9l-1 4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <div class={styles.pinnedBannerContent}>
                      <div class={styles.pinnedBannerLabel}>{i18n.t('msg.pinned')}</div>
                      <div class={styles.pinnedBannerText}>
                        {pm().isDeleted ? i18n.t('common.msg_deleted') : (pm().text ?? i18n.t('common.media'))}
                      </div>
                    </div>
                    <button
                      class={styles.pinnedBannerClose}
                      onClick={(e) => { e.stopPropagation(); api.pinMessage(chatId()!, null).catch(() => {}); }}
                      title={i18n.t('msg.unpin')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>
                )}
              </Show>
            );
          }}
        </Show>

        {/* ── Messages (column-reverse: scrollTop=0 = bottom = newest) ── */}
        <div
          class={`${styles.messages} ${styles['wp_' + (settingsStore.settings().chatWallpaper || 'default')] || ''}`}
          ref={msgsRef!}
          onScroll={onScroll}
          style={{ '--msg-font-size': settingsStore.settings().fontSize === 'small' ? '13px' : settingsStore.settings().fontSize === 'large' ? '16px' : '14px' }}
        >

          {/* Bottom sentinel — first DOM child = visual bottom in column-reverse.
              IntersectionObserver watches it to detect if the user sees newest messages. */}
          <div ref={setupBottomSentinel} style="height:1px;width:100%;flex-shrink:0;pointer-events:none;" />

          {/* Typing indicator moved to header status area — no longer in message list */}

          {/* Pending uploads — optimistic preview with progress */}
          <For each={pendingUploads()}>
            {(pending) => {
              const C = `${2 * Math.PI * 20}`;
              const offset = () => `${parseFloat(C) * (1 - pending.progress() / 100)}px`;
              return (
                <div class={`${styles.rowMine}`}>
                  <div class={`${styles.bubble} ${styles.bubbleMine}`}>
                    <Show when={pending.type === 'IMAGE'}>
                      <div class={styles.mediaImgWrap}>
                        <img class={styles.mediaImg} src={pending.blobUrl} alt="" />
                        <div class={styles.uploadOverlay}>
                          <svg class={styles.uploadCircle} viewBox="0 0 48 48">
                            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="3" />
                            <circle class={styles.uploadArc} cx="24" cy="24" r="20" fill="none" stroke="#fff" stroke-width="3"
                              stroke-dasharray={C}
                              style={{ 'stroke-dashoffset': offset() }}
                              stroke-linecap="round"
                              transform="rotate(-90 24 24)" />
                          </svg>
                          <button class={styles.uploadCancel} onClick={() => pending.abort()} title="Cancel">
                            <svg width="14" height="14" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>
                          </button>
                        </div>
                      </div>
                    </Show>
                    <Show when={pending.type === 'VIDEO'}>
                      <div class={styles.mediaImgWrap}>
                        <video class={styles.mediaVideo} src={pending.blobUrl} />
                        <div class={styles.uploadOverlay}>
                          <svg class={styles.uploadCircle} viewBox="0 0 48 48">
                            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="3" />
                            <circle class={styles.uploadArc} cx="24" cy="24" r="20" fill="none" stroke="#fff" stroke-width="3"
                              stroke-dasharray={C}
                              style={{ 'stroke-dashoffset': offset() }}
                              stroke-linecap="round"
                              transform="rotate(-90 24 24)" />
                          </svg>
                          <button class={styles.uploadCancel} onClick={() => pending.abort()} title="Cancel">
                            <svg width="14" height="14" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>
                          </button>
                        </div>
                      </div>
                    </Show>
                    <Show when={pending.type === 'AUDIO'}>
                      <div class={styles.voicePlayer}>
                        <div class={styles.uploadVoiceCircle}>
                          <svg viewBox="0 0 38 38" width="38" height="38">
                            <circle cx="19" cy="19" r="16" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
                            <circle class={styles.uploadArc} cx="19" cy="19" r="16" fill="none" stroke="#fff" stroke-width="2"
                              stroke-dasharray={`${2 * Math.PI * 16}`}
                              style={{ 'stroke-dashoffset': `${2 * Math.PI * 16 * (1 - pending.progress() / 100)}px` }}
                              stroke-linecap="round"
                              transform="rotate(-90 19 19)" />
                          </svg>
                          <button class={styles.uploadVoiceCancelBtn} onClick={() => pending.abort()}>
                            <svg width="12" height="12" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                          </button>
                        </div>
                        <div class={styles.voiceWaveWrap}>
                          <div class={styles.voiceWaveBars}>
                            {fallbackWaveform(pending.tempId).map(h => (
                              <div class={styles.waveBarItem} style={{ height: `${h * 100}%`, opacity: '0.35' }} />
                            ))}
                          </div>
                          <div class={styles.voiceTimeLine}>
                            <span class={styles.voiceTime}>{pending.progress()}%</span>
                          </div>
                        </div>
                      </div>
                    </Show>
                    <Show when={pending.type === 'FILE'}>
                      <div class={styles.uploadFileRow}>
                        <div class={styles.uploadFileProgress} style={{ width: `${pending.progress()}%` }} />
                        <span class={styles.uploadFileName}>{pending.fileName}</span>
                        <span class={styles.uploadFilePct}>{pending.progress()}%</span>
                        <button class={styles.uploadCancelSmall} onClick={() => pending.abort()}>✕</button>
                      </div>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>

          <For each={reversedMsgs()}>
            {(msg, idx) => {
              const g = createMemo(() => groupingMap().get(msg.id) ?? { withBelow: false, withAbove: false, showAvatar: false });
              const mine = () => me()?.id === msg.sender?.id;
              const openUnread = () => chatStore.openUnreadMap[chatId() ?? ''] ?? 0;
              const shouldShowDivider = () => showUnreadBar() && openUnread() > 0 && idx() === openUnread();

              return (
                <MessageBubble
                  msg={msg}
                  mine={mine()}
                  grouping={g()}
                  shouldShowDivider={shouldShowDivider()}
                  shouldShowDate={shouldShowDateSep(idx())}
                  dateLabel={dateLabelFor(msg.createdAt)}
                  isActive={menuMsgId() === msg.id}
                  chatType={chat()?.type ?? 'DIRECT'}
                  currentUserId={me()?.id}
                  onContextMenu={(msgId, pos) => { setMenuPos(pos); setMenuMsgId(msgId); }}
                  onScrollToMessage={scrollToMessage}
                  onReaction={handleReaction}
                  onOpenLightbox={openLightbox}
                  fmt={fmt}
                  isRead={isRead}
                  isDelivered={isDelivered}
                />
              );
            }}
          </For>

          {/* Sentinel for auto-loading older messages */}
          <Show when={chatStore.cursors[chatId()!] !== null && chatStore.cursors[chatId()!] !== undefined && !chatStore.loadingMsgs(chatId()!)}>
            <div ref={(el) => {
              const observer = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting) {
                  const cid = chatId();
                  if (cid && chatStore.cursors[cid] !== null && chatStore.cursors[cid] !== undefined && !chatStore.loadingMsgs(cid)) {
                    chatStore.loadMessages(cid, true);
                  }
                }
              }, { root: msgsRef, rootMargin: '400px' });
              observer.observe(el);
              onCleanup(() => observer.disconnect());
            }} style="height:1px;width:100%;flex-shrink:0;" />
          </Show>

          <Show when={chatStore.loadingMsgs(chatId()!)}>
            <div class={styles.loadingDots}>
              <span /><span /><span />
            </div>
          </Show>

          <Show when={msgs().length === 0 && !chatStore.loadingMsgs(chatId()!)}>
            <div class={styles.emptyChat}>{i18n.t('msg.empty_chat')}</div>
          </Show>
        </div>

        {/* Scroll-to-bottom button */}
        <Show when={showScrollBtn() || newMsgsBadge() > 0}>
          <button class={styles.scrollBtn} onClick={scrollToBottom} title={i18n.t('common.scroll_down')}>
            <Show when={newMsgsBadge() > 0}>
              <span class={styles.scrollBadge}>{newMsgsBadge() > 99 ? '99+' : newMsgsBadge()}</span>
            </Show>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </Show>

        <ChatInput
          text={text}
          setText={setText}
          editingId={editingId}
          setEditingId={setEditingId}
          editText={editText}
          setEditText={setEditText}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          uploading={uploading}
          actionError={actionError}
          blockedByThem={() => !!partner()?.blockedByThem}
          onSend={handleSend}
          onEdit={handleEdit}
          onFileUpload={handleFileUpload}
          onVoiceRecord={handleVoiceRecord}
          onTyping={handleTyping}
          onActionError={showActionError}
        />

        {/* Media preview modal */}
        <Show when={previewMedia()}>
          <Portal>
            <MediaPreviewModal
              media={previewMedia()!}
              onSend={handlePreviewSend}
              onCancel={handlePreviewCancel}
              onAddMore={() => {
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt';
                inp.onchange = () => {
                  const f = inp.files?.[0];
                  if (f) showMediaPreview(f);
                };
                inp.click();
              }}
            />
          </Portal>
        </Show>

        {/* Profile panel overlay */}
        <Show when={showProfile() && profileUser()}>
          <ProfilePanel user={profileUser()} onClose={() => setShowProfile(false)} />
        </Show>

        {/* Group profile panel overlay */}
        <Show when={showGroupProfile() && chat()?.type === 'GROUP'}>
          <GroupProfile
            chat={chat()!}
            onClose={() => setShowGroupProfile(false)}
            onOpenUserProfile={(uid) => {
              setShowGroupProfile(false);
              chatStore.startDirectChat(uid).catch(() => {});
            }}
          />
        </Show>
      </div>

      <MessageContextMenu
        menuMsgId={menuMsgId}
        setMenuMsgId={setMenuMsgId}
        menuPos={menuPos}
        forwardMsg={forwardMsg}
        setForwardMsg={setForwardMsg}
        deleteModalId={deleteModalId}
        setDeleteModalId={setDeleteModalId}
        chatId={chatId}
        me={me}
        chat={() => chat() ?? undefined}
        onReply={(msg) => setReplyTo(msg)}
        onEdit={(msgId, text) => { setEditingId(msgId); setEditText(text); }}
        onReaction={handleReaction}
        onDelete={handleDelete}
        onForwardTo={handleForwardTo}
      />

      {/* Lightbox — style image viewer with navigation */}
      <Show when={lbMsgId()}>
        <Portal>
          {(() => {
            const imgs = () => imageMessages();
            const idx = () => lbIdx();
            const item = () => imgs()[idx()];
            const hasPrev = () => idx() > 0;
            const hasNext = () => idx() < imgs().length - 1;
            const total = () => imgs().length;

            let lbImgRef: HTMLImageElement | undefined;
            let lbOverlayRef: HTMLDivElement | undefined;
            let touchStartX = 0;
            let touchStartY = 0;
            let swipeDx = 0;
            let swipeDy = 0;
            let swipeAxis: 'none' | 'x' | 'y' = 'none';
            const [closing, setClosing] = createSignal(false);

            const originStyle = () => {
              const r = lbOriginRect;
              if (!r) return '';
              const cx = r.left + r.width / 2;
              const cy = r.top + r.height / 2;
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const scaleX = r.width / Math.min(vw * 0.9, 800);
              const scale = Math.max(scaleX, 0.08);
              const dx = cx - vw / 2;
              const dy = cy - vh / 2;
              return `translate(${dx}px, ${dy}px) scale(${scale})`;
            };

            function closeLb() {
              if (closing()) return;
              setClosing(true);
              if (lbImgRef) {
                const o = originStyle();
                if (o) {
                  lbImgRef.style.transition = 'transform 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease';
                  lbImgRef.style.transform = o;
                  lbImgRef.style.opacity = '0';
                } else {
                  lbImgRef.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
                  lbImgRef.style.transform = 'scale(0.85)';
                  lbImgRef.style.opacity = '0';
                }
              }
              if (lbOverlayRef) {
                lbOverlayRef.style.transition = 'background 0.25s ease';
                lbOverlayRef.style.background = 'rgba(0,0,0,0)';
              }
              setTimeout(() => setLbMsgId(null), 280);
            }

            function onTouchStart(e: TouchEvent) {
              if (e.touches.length !== 1) return;
              touchStartX = e.touches[0].clientX;
              touchStartY = e.touches[0].clientY;
              swipeDx = 0; swipeDy = 0; swipeAxis = 'none';
            }
            function onTouchMove(e: TouchEvent) {
              if (e.touches.length !== 1) return;
              swipeDx = e.touches[0].clientX - touchStartX;
              swipeDy = e.touches[0].clientY - touchStartY;
              if (swipeAxis === 'none' && (Math.abs(swipeDx) > 8 || Math.abs(swipeDy) > 8)) {
                swipeAxis = Math.abs(swipeDx) > Math.abs(swipeDy) ? 'x' : 'y';
              }
              if (lbImgRef) {
                if (swipeAxis === 'y') {
                  lbImgRef.style.transition = 'none';
                  lbImgRef.style.transform = `translateY(${swipeDy}px) scale(${Math.max(0.85, 1 - Math.abs(swipeDy) / 600)})`;
                  if (lbOverlayRef) lbOverlayRef.style.background = `rgba(0,0,0,${Math.max(0.15, 0.92 - Math.abs(swipeDy) / 400)})`;
                } else if (swipeAxis === 'x') {
                  lbImgRef.style.transition = 'none';
                  lbImgRef.style.transform = `translateX(${swipeDx}px)`;
                }
              }
            }
            function onTouchEnd() {
              if (swipeAxis === 'y' && Math.abs(swipeDy) > 100) {
                closeLb();
              } else if (swipeAxis === 'x') {
                if (swipeDx > 80 && hasPrev()) setLbMsgId(imgs()[idx() - 1].id);
                else if (swipeDx < -80 && hasNext()) setLbMsgId(imgs()[idx() + 1].id);
                if (lbImgRef) { lbImgRef.style.transition = 'transform 0.25s ease'; lbImgRef.style.transform = ''; }
              } else if (lbImgRef) {
                lbImgRef.style.transition = 'transform 0.25s ease, opacity 0.2s ease';
                lbImgRef.style.transform = '';
                lbImgRef.style.opacity = '';
                if (lbOverlayRef) { lbOverlayRef.style.transition = 'background 0.25s ease'; lbOverlayRef.style.background = ''; }
              }
              swipeAxis = 'none';
            }

            function onKeyDown(e: KeyboardEvent) {
              if (e.key === 'Escape') closeLb();
              if (e.key === 'ArrowLeft' && hasPrev()) setLbMsgId(imgs()[idx() - 1].id);
              if (e.key === 'ArrowRight' && hasNext()) setLbMsgId(imgs()[idx() + 1].id);
            }
            document.addEventListener('keydown', onKeyDown);
            onCleanup(() => document.removeEventListener('keydown', onKeyDown));

            return (
              <div
                ref={lbOverlayRef}
                class={styles.lightbox}
                onClick={() => closeLb()}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
              >
                <button class={styles.lightboxClose} onClick={(e) => { e.stopPropagation(); closeLb(); }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                  </svg>
                </button>
                <Show when={hasPrev()}>
                  <button class={styles.lightboxNav + ' ' + styles.lightboxNavPrev} onClick={(e) => { e.stopPropagation(); setLbMsgId(imgs()[idx() - 1].id); }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </Show>
                <Show when={hasNext()}>
                  <button class={styles.lightboxNav + ' ' + styles.lightboxNavNext} onClick={(e) => { e.stopPropagation(); setLbMsgId(imgs()[idx() + 1].id); }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </Show>
                <Show when={total() > 1}>
                  <div class={styles.lightboxCounter}>{idx() + 1} / {total()}</div>
                </Show>
                <Show when={item()}>
                  <img
                    ref={(el) => {
                      lbImgRef = el;
                      const o = originStyle();
                      if (o) {
                        el.style.transform = o;
                        el.style.opacity = '0';
                        requestAnimationFrame(() => {
                          el.style.transition = 'transform 0.32s cubic-bezier(0.2,0.9,0.3,1), opacity 0.2s ease';
                          el.style.transform = 'none';
                          el.style.opacity = '1';
                        });
                      }
                    }}
                    class={styles.lightboxImg}
                    src={mediaUrl(item()!.mediaUrl)!}
                    alt=""
                    onClick={(e) => e.stopPropagation()}
                  />
                </Show>
              </div>
            );
          })()}
        </Portal>
      </Show>
    </Show>
  );
};

export default MessageArea;
