import {
  type Component, createSignal, createEffect, createMemo, For, Show,
  onMount, onCleanup, batch,
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


import { uiStore } from '../../stores/ui.store';

const SS_SCROLL_PREFIX = 'h2v_scroll_';

// ────────────────── Main Component ──────────────────
const MessageArea: Component = () => {
  const [text, setText] = createSignal('');
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editText, setEditText] = createSignal('');
  const [menuMsgId, setMenuMsgId] = createSignal<string | null>(null);
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [menuSelection, setMenuSelection] = createSignal('');
  const [replyTo, setReplyTo] = createSignal<Message | null>(null);
  const searchOpen = uiStore.chatSearchOpen;
  const setSearchOpen = uiStore.setChatSearchOpen;
  const searchQ = uiStore.chatSearchQ;
  const setSearchQ = uiStore.setChatSearchQ;
  const searchResults = uiStore.chatSearchResults;
  const setSearchResults = uiStore.setChatSearchResults;
  const searchLoading = uiStore.chatSearchLoading;
  const setSearchLoading = uiStore.setChatSearchLoading;
  const searchIdx = uiStore.chatSearchIdx;
  const setSearchIdx = uiStore.setChatSearchIdx;
  const [showFilters, setShowFilters] = createSignal(false);
  const [filterFrom, setFilterFrom] = createSignal('');
  const [filterTo, setFilterTo] = createSignal('');
  const [filterSenderId, setFilterSenderId] = createSignal('');
  const [filterType, setFilterType] = createSignal('');
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
  const [previewMedia, setPreviewMedia] = createSignal<MediaPreviewFile[]>([]);
  let _dragCounter = 0;
  let _unreadBarTimer: ReturnType<typeof setTimeout> | null = null;
  let _draftTimer: ReturnType<typeof setTimeout> | null = null;
  // Per-chat scroll state — reset on every chat switch
  let _initialScrollStarted = false;
  let _initialScrollDone = false;
  let _lastProcessedMsgId = '';
  const showProfile = () => !!uiStore.viewingUserId();
  const setShowProfile = (v: boolean) => {
    if (v) {
      const pu = profileUser();
      if (pu) uiStore.openUserProfile(pu.id);
    } else {
      uiStore.closeUserProfile();
    }
  };
  const [lbMsgId, setLbMsgId] = createSignal<string | null>(null);
  let lbOriginRect: DOMRect | null = null;
  const [actionError, setActionError] = createSignal('');
  const [showSafetyNumber, setShowSafetyNumber] = createSignal(false);
  const [safetyNumber, setSafetyNumber] = createSignal<string | null>(null);

  // ── Multi-select ──
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const selectionActive = () => selectedIds().size > 0;
  let _selectDragging = false;
  let _selectStartY = 0;
  const [multiForward, setMultiForward] = createSignal(false);
  const [multiFwdSearch, setMultiFwdSearch] = createSignal('');

  function toggleSelect(msgId: string) {
    const s = new Set(selectedIds());
    if (s.has(msgId)) s.delete(msgId); else s.add(msgId);
    setSelectedIds(s);
  }
  function clearSelection() { setSelectedIds(new Set<string>()); setMultiForward(false); }

  let _selectAnchorId: string | null = null;
  let _selectMoved = false;

  function handleSelectMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const row = (e.target as HTMLElement).closest('[data-msg-id]') as HTMLElement | null;
    if (!row) return;
    const msgId = row.dataset.msgId!;

    if (selectionActive()) {
      e.preventDefault();
      toggleSelect(msgId);
      _selectDragging = true;
      _selectAnchorId = msgId;
      _selectMoved = false;
      return;
    }

    _selectDragging = true;
    _selectAnchorId = msgId;
    _selectStartY = e.clientY;
    _selectMoved = false;
  }

  function handleSelectMouseMove(e: MouseEvent) {
    if (!_selectDragging || !_selectAnchorId) return;
    const dy = Math.abs(e.clientY - _selectStartY);
    if (!selectionActive() && dy < 12) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const row = (el as HTMLElement).closest('[data-msg-id]') as HTMLElement | null;
    if (!row) return;
    const msgId = row.dataset.msgId!;

    e.preventDefault();
    window.getSelection()?.removeAllRanges();

    if (!selectionActive()) {
      const s = new Set<string>();
      s.add(_selectAnchorId);
      if (msgId !== _selectAnchorId) s.add(msgId);
      setSelectedIds(s);
      _selectMoved = true;
      return;
    }

    const s = new Set(selectedIds());
    if (!s.has(msgId)) { s.add(msgId); setSelectedIds(s); }
    _selectMoved = true;
  }

  function handleSelectMouseUp() {
    _selectDragging = false;
    _selectAnchorId = null;
  }

  function handleMultiDelete() {
    const ids = Array.from(selectedIds());
    clearSelection();
    ids.forEach(id => {
      api.deleteMessage(id, true).then(() => {
        const cid = chatId();
        if (cid) chatStore.hideMessage(cid, id);
      }).catch(() => {});
    });
  }

  function handleMultiForwardTo(targetChatId: string) {
    const ids = Array.from(selectedIds());
    const allMsgs = msgs();
    setMultiForward(false);
    clearSelection();
    ids.forEach(id => {
      const msg = allMsgs.find(m => m.id === id);
      if (!msg) return;
      handleForwardTo(targetChatId, msg);
    });
  }

  let msgsRef!: HTMLDivElement;
  let bottomSentinelRef!: HTMLDivElement;
  let searchTimer: ReturnType<typeof setTimeout>;
  let typingTimer: ReturnType<typeof setTimeout>;
  let actionErrorTimer: ReturnType<typeof setTimeout>;
  let _scrollSaveTimer: ReturnType<typeof setTimeout>;
  let isTyping = false;
  let _loadingMore = false;
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

  function scrollDist(): number {
    if (!msgsRef) return 0;
    return msgsRef.scrollHeight - msgsRef.scrollTop - msgsRef.clientHeight;
  }

  function getVisibleMsgId(): string | null {
    if (!msgsRef) return null;
    const rect = msgsRef.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let el = document.elementFromPoint(centerX, centerY) as HTMLElement | null;
    while (el && el !== msgsRef) {
      if (el.dataset?.msgId) return el.dataset.msgId;
      el = el.parentElement;
    }
    return null;
  }


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
    const list = msgs();
    const map = new Map<string, { withBelow: boolean; withAbove: boolean; showAvatar: boolean }>();
    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      const above = i > 0 ? list[i - 1] : null;
      const below = i < list.length - 1 ? list[i + 1] : null;
      const withBelow = !!below && sameGroup(msg, below);
      const withAbove = !!above && sameGroup(msg, above);
      map.set(msg.id, { withBelow, withAbove, showAvatar: msg.sender?.id !== myId && !withBelow });
    }
    return map;
  });

  type MediaGroupEntry = { isLeader: boolean; items: Message[] };
  const mediaGroupInfo = createMemo(() => {
    const list = msgs();
    const map = new Map<string, MediaGroupEntry>();
    const groupBuckets = new Map<string, Message[]>();
    for (const msg of list) {
      if (msg.mediaGroupId && (msg.type === 'IMAGE' || msg.type === 'VIDEO') && !msg.isDeleted) {
        const bucket = groupBuckets.get(msg.mediaGroupId) ?? [];
        bucket.push(msg);
        groupBuckets.set(msg.mediaGroupId, bucket);
      }
    }
    for (const [, bucket] of groupBuckets) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i++) {
        map.set(bucket[i].id, { isLeader: i === 0, items: bucket });
      }
    }
    return map;
  });

  createEffect((prevId) => {
    const id = chatId();
    if (id !== prevId) {
      _initialScrollStarted = false;
      _initialScrollDone = false;
      _lastProcessedMsgId = '';
      clearTimeout(_scrollSaveTimer);
      setAtBottom(true);
      setNewMsgsBadge(0);
      setShowUnreadBar(true);
      clearSelection();
      if (_unreadBarTimer) clearTimeout(_unreadBarTimer);
      _unreadBarTimer = setTimeout(() => setShowUnreadBar(false), 8000);
      if (prevId) {
        isTyping = false;
        clearTimeout(typingTimer);
        wsStore.send({ event: 'typing:stop', payload: { chatId: prevId as string } });
      }
      // Save draft for previous chat before switching
      if (prevId) {
        if (_draftTimer) clearTimeout(_draftTimer);
        const prevText = text().trim();
        if (prevText) {
          api.upsertDraft(prevId as string, prevText, replyTo()?.id).catch(() => {});
        } else {
          const prevChat = chatStore.chats.find((c) => c.id === prevId);
          if (prevChat?.draft) {
            api.deleteDraft(prevId as string).catch(() => {});
            chatStore.updateDraft(prevId as string, null);
          }
        }
      }
      // Load draft for the new chat
      const newChat = chatStore.chats.find((c) => c.id === id);
      const draft = newChat?.draft;
      batch(() => {
        setText(draft?.text ?? '');
        setEditingId(null);
        setEditText('');
        setReplyTo(null);
        setSearchOpen(false);
        setSearchQ('');
        setSearchResults([]);
        setSearchIdx(-1);
        setMenuMsgId(null);
        setDeleteModalId(null);
        setForwardMsg(null);
      });
    }
    return id;
  }, chatId());

  function _scrollToBottom() {
    if (!msgsRef) { _initialScrollDone = true; return; }
    if (msgs().length === 0) { _initialScrollDone = true; return; }
    msgsRef.scrollTop = msgsRef.scrollHeight;
    requestAnimationFrame(() => {
      if (msgsRef) msgsRef.scrollTop = msgsRef.scrollHeight;
      _initialScrollDone = true;
    });
  }

  // ── Effect 1: initial scroll when messages first load for a chat ─────────────
  createEffect(() => {
    const list = msgs();
    if (_initialScrollStarted || !msgsRef || list.length === 0) return;

    _initialScrollStarted = true;
    const cid = chatId() ?? '';

    const savedMsgId = sessionStorage.getItem(SS_SCROLL_PREFIX + cid);
    if (savedMsgId) {
      const idx = list.findIndex(m => m.id === savedMsgId);
      if (idx >= 0) {
        requestAnimationFrame(() => {
          scrollToMessage(savedMsgId, false);
          _initialScrollDone = true;
        });
      } else {
        sessionStorage.removeItem(SS_SCROLL_PREFIX + cid);
        _scrollToBottom();
      }
      return;
    }

    const unreadAtOpen = chatStore.openUnreadMap[cid] ?? 0;
    if (unreadAtOpen > 0) {
      const firstUnreadMsg = list[Math.max(0, list.length - unreadAtOpen)];
      if (firstUnreadMsg) {
        requestAnimationFrame(() => {
          scrollToMessage(firstUnreadMsg.id, false);
          _initialScrollDone = true;
        });
      } else {
        _scrollToBottom();
      }
      return;
    }

    _scrollToBottom();
  });

  // ── Effect 2: real-time message arrived via WebSocket ─────────────────────────
  createEffect(() => {
    const msg = chatStore.latestRealtimeMsg();
    if (!msg || !msgsRef) return;
    if (msg.id === _lastProcessedMsgId) return;
    if (msg.chatId !== chatId()) return;

    _lastProcessedMsgId = msg.id;

    const closeToBottom = msgsRef ? scrollDist() < 150 : false;

    if (closeToBottom) {
      requestAnimationFrame(() => {
        if (msgsRef) msgsRef.scrollTop = msgsRef.scrollHeight;
      });
    } else {
      setNewMsgsBadge((n) => n + 1);
    }
  });

  // ESC: cascading close
  createEffect(() => {
    const id = chatId();
    if (!id) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (selectionActive()) { clearSelection(); return; }
      if (multiForward()) { setMultiForward(false); return; }
      if (previewMedia().length > 0) { handlePreviewCancel(); return; }
      if (lbMsgId()) { setLbMsgId(null); return; }
      if (forwardMsg()) { setForwardMsg(null); return; }
      if (deleteModalId()) { setDeleteModalId(null); return; }
      if (menuMsgId()) { setMenuMsgId(null); return; }
      if (showHeaderMenu()) { setShowHeaderMenu(false); return; }
      if (searchOpen()) { closeSearch(); return; }
      if (editingId()) { setEditingId(null); return; }
      if (uiStore.viewingGroupId()) { uiStore.closeGroupProfile(); return; }
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
          if (file) addMediaPreviews([file]);
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
    setSearchIdx(-1);
    setShowFilters(false);
    setFilterFrom('');
    setFilterTo('');
    setFilterSenderId('');
    setFilterType('');
  }

  function onScroll() {
    if (!msgsRef || _loadingMore || !_initialScrollDone) return;
    setShowScrollBtn(scrollDist() > 300);
    const cid = chatId();
    if (!cid) return;
    clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
      if (scrollDist() < 100) {
        sessionStorage.removeItem(SS_SCROLL_PREFIX + cid);
      } else {
        const msgId = getVisibleMsgId();
        if (msgId) sessionStorage.setItem(SS_SCROLL_PREFIX + cid, msgId);
      }
    }, 150);
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
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) addMediaPreviews(Array.from(files));
  }

  onMount(() => {
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
  });
  onCleanup(() => {
    document.removeEventListener('dragenter', onDragEnter);
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('dragleave', onDragLeave);
    document.removeEventListener('drop', onDrop);
  });

  function scrollToBottom() {
    if (msgsRef) msgsRef.scrollTo({ top: msgsRef.scrollHeight, behavior: 'smooth' });
    setNewMsgsBadge(0);
    chatStore.clearOpenUnread(chatId() ?? '');
  }

  function scrollToMessage(msgId: string, highlight = true, _retries = 0) {
    if (!msgsRef) return;
    const el = msgsRef.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
    if (!el) {
      if (_retries < 10) {
        setTimeout(() => scrollToMessage(msgId, highlight, _retries + 1), _retries < 3 ? 30 : 60);
      }
      return;
    }
    el.scrollIntoView({ behavior: highlight ? 'smooth' : 'instant', block: 'center' });
    if (highlight) {
      el.classList.remove(styles.msgHighlight);
      void el.offsetWidth;
      el.classList.add(styles.msgHighlight);
      const cleanup = () => { el.classList.remove(styles.msgHighlight); el.removeEventListener('animationend', cleanup); };
      el.addEventListener('animationend', cleanup);
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

    // Debounced draft auto-save
    if (_draftTimer) clearTimeout(_draftTimer);
    _draftTimer = setTimeout(() => {
      const t = text().trim();
      const cid = chatId();
      if (!cid) return;
      if (t) {
        api.upsertDraft(cid, t, replyTo()?.id).catch(() => {});
      } else {
        api.deleteDraft(cid).catch(() => {});
        chatStore.updateDraft(cid, null);
      }
    }, 1500);
  }

  async function handleSend(e?: Event) {
    e?.preventDefault();
    const t = text().trim();
    const id = chatId();
    if (!t || !id) return;
    if (!wsStore.connected()) {
      showActionError(i18n.t('msg.no_connection'));
      wsStore.connect();
      return;
    }
    const reply = replyTo();
    batch(() => { setText(''); setReplyTo(null); });
    isTyping = false; clearTimeout(typingTimer);
    if (_draftTimer) clearTimeout(_draftTimer);
    wsStore.send({ event: 'typing:stop', payload: { chatId: id } });
    api.deleteDraft(id).catch(() => {});
    chatStore.updateDraft(id, null);

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
      const secTempId = chatStore.addPendingMessage(id, {
        ciphertext: enc.ciphertext,
        signalType: enc.signalType,
        replyToId: reply?.id ?? null,
      });
      const secSent = wsStore.send({
        event: 'message:send',
        payload: { chatId: id, ciphertext: enc.ciphertext, signalType: enc.signalType,
          ...(reply ? { replyToId: reply.id } : {}) },
      });
      if (!secSent) chatStore.failPendingMessage(id, secTempId);
      const myId = me()?.id;
      if (myId) setTimeout(() => e2eStore.checkReplenish(myId), 3000);
      return;
    }

    const tempId = chatStore.addPendingMessage(id, {
      text: t,
      replyToId: reply?.id ?? null,
    });
    const sent = wsStore.send({
      event: 'message:send',
      payload: { chatId: id, text: t, ...(reply ? { replyToId: reply.id } : {}) },
    });
    if (!sent) chatStore.failPendingMessage(id, tempId);
  }

  function handleRetry(msg: Message) {
    const id = msg.chatId;
    chatStore.removeMessage(id, msg.id);
    if (msg.ciphertext) {
      const retryTempId = chatStore.addPendingMessage(id, {
        ciphertext: msg.ciphertext,
        signalType: msg.signalType,
        replyToId: msg.replyToId ?? null,
      });
      const ok = wsStore.send({
        event: 'message:send',
        payload: { chatId: id, ciphertext: msg.ciphertext, signalType: msg.signalType,
          ...(msg.replyToId ? { replyToId: msg.replyToId } : {}) },
      });
      if (!ok) chatStore.failPendingMessage(id, retryTempId);
    } else {
      const retryTempId = chatStore.addPendingMessage(id, {
        text: msg.text ?? '',
        replyToId: msg.replyToId ?? null,
      });
      const ok = wsStore.send({
        event: 'message:send',
        payload: { chatId: id, text: msg.text ?? '', ...(msg.replyToId ? { replyToId: msg.replyToId } : {}) },
      });
      if (!ok) chatStore.failPendingMessage(id, retryTempId);
    }
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
      const cid = chatId();
      if (!cid) return;
      if (!forEveryone) {
        await api.hideMessage(msgId);
        chatStore.hideMessage(cid, msgId);
      } else {
        await api.deleteMessage(msgId, true);
        chatStore.hideMessage(cid, msgId);
      }
    } catch { showActionError(i18n.t('msg.delete_failed') || 'Failed to delete message'); }
  }

  function handleForwardTo(targetChatId: string, msg: Message) {
    setForwardMsg(null);
    if (!wsStore.connected()) return;
    const senderName = displayName(msg.sender);
    chatStore.addPendingMessage(targetChatId, {
      text: msg.text ?? e2eStore.getDecryptedText(msg.id) ?? null,
      type: msg.type,
      mediaUrl: msg.mediaUrl,
      forwardedFromId: msg.id,
      forwardSenderName: senderName,
    });
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

  function addMediaPreviews(files: File[]) {
    const newItems: MediaPreviewFile[] = files.map((f) => ({
      file: f,
      blobUrl: URL.createObjectURL(f),
      fileType: classifyFile(f),
    }));
    setPreviewMedia((prev) => [...prev, ...newItems]);
  }

  function handlePreviewSend(items: { file: File; caption: string; asDocument: boolean }[]) {
    for (const m of previewMedia()) URL.revokeObjectURL(m.blobUrl);
    setPreviewMedia([]);
    const mediaItems = items.filter(i => !i.asDocument);
    const groupId = mediaItems.length > 1 ? `mg_${Date.now()}_${Math.random().toString(36).slice(2)}` : undefined;
    for (const item of items) {
      const gid = !item.asDocument && groupId ? groupId : undefined;
      doUploadAndSend(item.file, item.caption || null, item.asDocument, gid);
    }
  }

  function handlePreviewCancel() {
    for (const m of previewMedia()) URL.revokeObjectURL(m.blobUrl);
    setPreviewMedia([]);
  }

  function handlePreviewAddMore(files: File[]) {
    addMediaPreviews(files);
  }

  function handlePreviewRemove(index: number) {
    setPreviewMedia((prev) => {
      const item = prev[index];
      if (item) URL.revokeObjectURL(item.blobUrl);
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    if (previewMedia().length === 0) handlePreviewCancel();
  }

  const MAX_FILE_SIZE = 20 * 1024 * 1024;

  function handleFileUpload(files: File[]) {
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      showActionError(i18n.t('msg.file_too_large') || `File exceeds 20 MB limit`);
      const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
      if (valid.length === 0) return;
      addMediaPreviews(valid);
      return;
    }
    addMediaPreviews(files);
  }

  function handleVoiceRecord(file: File) {
    doUploadAndSend(file, null, false);
  }

  function doUploadAndSend(file: File, caption: string | null, asDocument: boolean, mediaGroupId?: string) {
    const id = chatId();
    if (!id || !wsStore.connected()) return;
    if (file.size > MAX_FILE_SIZE) {
      showActionError(i18n.t('msg.file_too_large') || `File exceeds 20 MB limit`);
      return;
    }
    const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const blobUrl = URL.createObjectURL(file);
    let fileType = classifyFile(file);
    if (asDocument) fileType = 'FILE';

    const [progress, setProgress] = createSignal(0);
    const reply = replyTo();
    setReplyTo(null);

    const isSecret = chat()?.type === 'SECRET';

    if (isSecret) {
      const p = partner();
      if (!p) return;
      setPendingUploads(prev => [...prev, { tempId, blobUrl, type: fileType, fileName: file.name, progress, setProgress, abort: () => {} }]);
      setUploading(true);

      (async () => {
        try {
          const arrayBuf = await file.arrayBuffer();
          const { encrypted, mediaKey } = await e2eStore.encryptMedia(arrayBuf);
          setProgress(40);

          const encBlob = new Blob([encrypted], { type: 'application/octet-stream' });
          const uploadRes = await api.uploadEncrypted(encBlob, file.name + '.enc');
          setProgress(80);

          const enc = await e2eStore.encrypt(id, p.id, mediaKey);
          if (!enc) { showActionError('E2E: session failed'); return; }
          setProgress(100);

          let sendType = fileType;
          if (asDocument) sendType = 'FILE';

          chatStore.addPendingMessage(id, {
            text: caption || null,
            mediaUrl: uploadRes.data!.url,
            type: sendType as Message['type'],
            mediaName: file.name,
            mediaSize: file.size,
            replyToId: reply?.id ?? null,
          });
          wsStore.send({
            event: 'message:send',
            payload: {
              chatId: id, text: caption || null,
              mediaUrl: uploadRes.data!.url, type: sendType,
              mediaName: file.name, mediaSize: file.size,
              ciphertext: enc.ciphertext, signalType: enc.signalType,
              ...(reply ? { replyToId: reply.id } : {}),
              ...(mediaGroupId ? { mediaGroupId } : {}),
            },
          });
        } catch {
          showActionError(i18n.t('msg.upload_failed') || 'Failed to upload file');
        } finally {
          URL.revokeObjectURL(blobUrl);
          setPendingUploads(prev => prev.filter(p => p.tempId !== tempId));
          if (pendingUploads().length === 0) setUploading(false);
        }
      })();
      return;
    }

    const { promise, abort } = api.uploadWithProgress(file, (pct) => {
      setProgress(pct);
    });

    setPendingUploads(prev => [...prev, { tempId, blobUrl, type: fileType, fileName: file.name, progress, setProgress, abort }]);
    setUploading(true);

    promise.then(res => {
      let sendType = res.data.type;
      if (asDocument) sendType = 'FILE';
      chatStore.addPendingMessage(id, {
        text: caption || null,
        mediaUrl: res.data.url,
        type: sendType as Message['type'],
        mediaName: file.name,
        mediaSize: file.size,
        replyToId: reply?.id ?? null,
      });
      wsStore.send({
        event: 'message:send',
        payload: { chatId: id, text: caption || null, mediaUrl: res.data.url, type: sendType,
          mediaName: file.name, mediaSize: file.size,
          ...(reply ? { replyToId: reply.id } : {}),
          ...(mediaGroupId ? { mediaGroupId } : {}) },
      });
    }).catch(() => {
      showActionError(i18n.t('msg.upload_failed') || 'Failed to upload file');
    }).finally(() => {
      URL.revokeObjectURL(blobUrl);
      setPendingUploads(prev => prev.filter(p => p.tempId !== tempId));
      if (pendingUploads().length === 0) setUploading(false);
    });
  }

  async function handleSearch(q: string) {
    setSearchQ(q);
    clearTimeout(searchTimer);
    const currentChatId = chatId();
    if ((!q.trim() && !filterFrom() && !filterTo() && !filterSenderId() && !filterType()) || !currentChatId) {
      setSearchResults([]);
      setSearchIdx(0);
      return;
    }

    if (chat()?.type === 'SECRET') {
      searchTimer = setTimeout(() => {
        const lower = q.trim().toLowerCase();
        const all = chatStore.messages[currentChatId] ?? [];
        const found = all.filter((m) => {
          if (m.isDeleted) return false;
          const text = m.text ?? e2eStore.getDecryptedText(m.id);
          return text?.toLowerCase().includes(lower);
        });
        if (chatId() === currentChatId) {
          setSearchResults(found);
          setSearchIdx(-1);
        }
      }, 200);
      return;
    }

    searchTimer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const filters: { from?: string; to?: string; senderId?: string; type?: string } = {};
        if (filterFrom()) filters.from = new Date(filterFrom()).toISOString();
        if (filterTo()) filters.to = new Date(filterTo() + 'T23:59:59').toISOString();
        if (filterSenderId()) filters.senderId = filterSenderId();
        if (filterType()) filters.type = filterType();
        const hasFilters = Object.keys(filters).length > 0;
        const res = await api.getMessages(currentChatId, undefined, q.trim() || undefined, hasFilters ? filters : undefined);
        if (chatId() === currentChatId) {
          const results = res.data?.messages ?? [];
          setSearchResults(results);
          setSearchIdx(-1);
        }
      } catch {
        if (chatId() === currentChatId) setSearchResults([]);
      } finally {
        if (chatId() === currentChatId) setSearchLoading(false);
      }
    }, 400);
  }

  async function navigateToSearchResult(msg: Message) {
    const cid = chatId();
    if (!cid || !msg) return;
    const el = msgsRef?.querySelector(`[data-msg-id="${msg.id}"]`) as HTMLElement | null;
    if (el) {
      scrollToMessage(msg.id, true);
    } else {
      await chatStore.loadMessagesAroundDate(cid, msg.createdAt);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToMessage(msg.id, true));
      });
    }
  }

  function selectSearchResult(idx: number) {
    const results = searchResults();
    if (idx < 0 || idx >= results.length) return;
    setSearchIdx(idx);
    navigateToSearchResult(results[idx]);
  }

  uiStore.registerSearchResultHandler(selectSearchResult);

  function onSearchPrev() {
    const idx = searchIdx();
    if (idx > 0) selectSearchResult(idx - 1);
    else if (idx === -1 && searchResults().length > 0) selectSearchResult(searchResults().length - 1);
  }

  function onSearchNext() {
    const idx = searchIdx();
    if (idx < searchResults().length - 1) selectSearchResult(idx + 1);
    else if (idx === -1 && searchResults().length > 0) selectSearchResult(0);
  }

  function handleJumpToDate() {
    const date = filterFrom();
    const cid = chatId();
    if (!date || !cid) return;
    closeSearch();
    chatStore.loadMessagesAroundDate(cid, new Date(date).toISOString()).then(() => {
      requestAnimationFrame(() => { if (msgsRef) msgsRef.scrollTop = 0; });
    });
  }

  function applyFilters() {
    handleSearch(searchQ());
  }

  function clearFilters() {
    setFilterFrom('');
    setFilterTo('');
    setFilterSenderId('');
    setFilterType('');
    setShowFilters(false);
    handleSearch(searchQ());
  }

  async function handleLeaveChat() {
    const id = chatId(); if (!id) return;
    try {
      await api.leaveChat(id);
      chatStore.removeChat(id);
      if (uiStore.viewingGroupId() === id) uiStore.closeGroupProfile();
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
    const list = msgs();
    const msg = list[idx];
    const prev = list[idx - 1];
    if (!prev) return true;
    const d1 = new Date(msg.createdAt);
    const d2 = new Date(prev.createdAt);
    return d1.getFullYear() !== d2.getFullYear() || d1.getMonth() !== d2.getMonth() || d1.getDate() !== d2.getDate();
  }

  createEffect(() => {
    if (chat()?.type !== 'SECRET') return;
    const el = msgsRef;
    if (!el) return;
    const onCtx = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', onCtx);

    const onVis = () => {
      if (!el) return;
      el.style.filter = document.visibilityState === 'hidden' ? 'blur(20px)' : '';
    };
    document.addEventListener('visibilitychange', onVis);

    onCleanup(() => {
      el.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('visibilitychange', onVis);
      el.style.filter = '';
    });
  });

  onCleanup(() => {
    clearTimeout(searchTimer);
    clearTimeout(actionErrorTimer);
    clearTimeout(_scrollSaveTimer);
    if (_draftTimer) clearTimeout(_draftTimer);
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

  async function openSafetyNumber() {
    const p = partner();
    if (!p) return;
    setSafetyNumber(null);
    setShowSafetyNumber(true);
    const num = await e2eStore.getSafetyNumber(p.id);
    setSafetyNumber(num);
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
      <div class={styles.wrap} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
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
        <Show when={selectionActive()}>
          <div class={styles.selectToolbar}>
            <button class={styles.selectToolbarBtn} onClick={() => setMultiForward(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 14L20 9l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20v-7a4 4 0 014-4h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {i18n.t('msg.forward')} {selectedIds().size}
            </button>
            <button class={styles.selectToolbarBtn} onClick={handleMultiDelete}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {i18n.t('msg.delete_msg')} {selectedIds().size}
            </button>
            <button class={styles.selectToolbarCancel} onClick={clearSelection}>
              {i18n.t('common.cancel')}
            </button>
          </div>
        </Show>
        <Show when={!selectionActive()}>
        <ChatHeader
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchQ={searchQ}
          setSearchQ={setSearchQ}
          searchResults={searchResults}
          setSearchResults={setSearchResults}
          searchLoading={searchLoading}
          searchIdx={searchIdx}
          showHeaderMenu={showHeaderMenu}
          setShowHeaderMenu={setShowHeaderMenu}
          setShowProfile={setShowProfile}
          onCloseSearch={closeSearch}
          onHandleSearch={handleSearch}
          onLeaveChat={handleLeaveChat}
          onToggleFilters={() => setShowFilters(!showFilters())}
          onSearchPrev={onSearchPrev}
          onSearchNext={onSearchNext}
        />
        </Show>

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

        {/* Search filter panel */}
        <Show when={searchOpen() && showFilters()}>
          <div class={styles.filterPanel}>
            <div class={styles.filterRow}>
              <label class={styles.filterLabel}>{i18n.t('msg.from_date') || 'From'}</label>
              <input type="date" class={styles.filterInput} value={filterFrom()} onInput={(e) => setFilterFrom(e.currentTarget.value)} />
              <label class={styles.filterLabel}>{i18n.t('msg.to_date') || 'To'}</label>
              <input type="date" class={styles.filterInput} value={filterTo()} onInput={(e) => setFilterTo(e.currentTarget.value)} />
            </div>
            <div class={styles.filterRow}>
              <Show when={chat()?.type === 'GROUP'}>
                <label class={styles.filterLabel}>{i18n.t('msg.sender') || 'Sender'}</label>
                <select class={styles.filterInput} value={filterSenderId()} onChange={(e) => setFilterSenderId(e.currentTarget.value)}>
                  <option value="">{i18n.t('common.all') || 'All'}</option>
                  <For each={chat()?.members ?? []}>
                    {(m) => <option value={m.user.id}>{displayName(m.user)}</option>}
                  </For>
                </select>
              </Show>
              <label class={styles.filterLabel}>{i18n.t('msg.type') || 'Type'}</label>
              <select class={styles.filterInput} value={filterType()} onChange={(e) => setFilterType(e.currentTarget.value)}>
                <option value="">{i18n.t('common.all') || 'All'}</option>
                <option value="TEXT">Text</option>
                <option value="IMAGE">Photo</option>
                <option value="VIDEO">Video</option>
                <option value="FILE">File</option>
                <option value="AUDIO">Voice</option>
              </select>
            </div>
            <div class={styles.filterActions}>
              <button class={styles.filterBtn} onClick={applyFilters}>{i18n.t('common.apply') || 'Apply'}</button>
              <Show when={filterFrom()}>
                <button class={styles.filterBtnAccent} onClick={handleJumpToDate}>{i18n.t('msg.jump_to_date') || 'Jump to date'}</button>
              </Show>
              <button class={styles.filterBtnClear} onClick={clearFilters}>{i18n.t('common.clear') || 'Clear'}</button>
            </div>
          </div>
        </Show>

        {/* E2E banner for SECRET chats */}
        <Show when={chat()?.type === 'SECRET'}>
          <div class={styles.secretBanner}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            {i18n.t('chat.secret_banner')}
            <button class={styles.verifyBtn} onClick={openSafetyNumber}>
              {i18n.t('e2e.verify') || 'Verify'}
            </button>
          </div>
        </Show>

        {/* Safety number modal */}
        <Show when={showSafetyNumber()}>
          <Portal>
            <div class={styles.safetyOverlay} onClick={() => setShowSafetyNumber(false)}>
              <div class={styles.safetyModal} onClick={(e) => e.stopPropagation()}>
                <div class={styles.safetyHeader}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  <span>{i18n.t('e2e.safety_title') || 'Safety Number'}</span>
                  <button class={styles.safetyClose} onClick={() => setShowSafetyNumber(false)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                  </button>
                </div>
                <p class={styles.safetyHint}>{i18n.t('e2e.safety_hint') || 'Compare this number with your contact to verify encryption.'}</p>
                <Show when={safetyNumber()} fallback={<div class={styles.safetyLoading}>...</div>}>
                  <pre class={styles.safetyCode}>{safetyNumber()}</pre>
                </Show>
              </div>
            </div>
          </Portal>
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
                        {pm().isDeleted ? i18n.t('common.msg_deleted') : (pm().text ?? e2eStore.getDecryptedText(pm().id) ?? i18n.t('common.media'))}
                      </div>
                    </div>
                    <button
                      class={styles.pinnedBannerClose}
                      onClick={(e) => { e.stopPropagation(); const cid = chatId(); if (cid) api.pinMessage(cid, null).catch(() => {}); }}
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

        {/* ── Messages ── */}
        <div
          class={`${styles.messages} ${styles['wp_' + (settingsStore.settings().chatWallpaper || 'default')] || ''} ${chat()?.type === 'SECRET' ? styles.secretProtect : ''}`}
          ref={msgsRef!}
          onScroll={onScroll}
          onMouseDown={handleSelectMouseDown}
          onMouseMove={handleSelectMouseMove}
          onMouseUp={handleSelectMouseUp}
          style={{ '--msg-font-size': settingsStore.settings().fontSize === 'small' ? '13px' : settingsStore.settings().fontSize === 'large' ? '16px' : '14px' }}
        >
        <div class={styles.messagesInner}>

          {/* Sentinel for auto-loading older messages (at the top) */}
          <Show when={chatId() && chatStore.cursors[chatId()!] !== null && chatStore.cursors[chatId()!] !== undefined && !chatStore.loadingMsgs(chatId()!)}>
            <div ref={(el) => {
              const observer = new IntersectionObserver(async (entries) => {
                if (entries[0]?.isIntersecting) {
                  if (!_initialScrollDone) return;
                  const cid = chatId();
                  if (cid && !_loadingMore && chatStore.cursors[cid] !== null && chatStore.cursors[cid] !== undefined) {
                    _loadingMore = true;
                    const oldScrollHeight = msgsRef.scrollHeight;
                    const oldScrollTop = msgsRef.scrollTop;
                    await chatStore.loadMessages(cid, true);
                    if (msgsRef) {
                      const delta = msgsRef.scrollHeight - oldScrollHeight;
                      msgsRef.scrollTop = oldScrollTop + delta;
                    }
                    _loadingMore = false;
                  }
                }
              }, { root: msgsRef, rootMargin: '400px' });
              observer.observe(el);
              onCleanup(() => observer.disconnect());
            }} style="height:1px;width:100%;flex-shrink:0;" />
          </Show>

          <Show when={chatId() && chatStore.loadingMsgs(chatId()!)}>
            <div class={styles.loadingDots}>
              <span /><span /><span />
            </div>
          </Show>

          <Show when={msgs().length === 0 && chatId() && !chatStore.loadingMsgs(chatId()!)}>
            <div class={styles.emptyChat}>{i18n.t('msg.empty_chat')}</div>
          </Show>

          <For each={msgs()}>
            {(msg, idx) => {
              const mgInfo = () => mediaGroupInfo().get(msg.id);
              const isGroupMember = () => !!mgInfo();
              const isGroupLeader = () => mgInfo()?.isLeader === true;
              const isGroupFollower = () => isGroupMember() && !isGroupLeader();

              const g = createMemo(() => groupingMap().get(msg.id) ?? { withBelow: false, withAbove: false, showAvatar: false });
              const mine = () => me()?.id === msg.sender?.id;
              const openUnread = () => chatStore.openUnreadMap[chatId() ?? ''] ?? 0;
              const shouldShowDivider = () => showUnreadBar() && openUnread() > 0 && idx() === msgs().length - openUnread();

              const isSystem = () => msg.type === 'SYSTEM';
              const systemText = () => {
                if (!isSystem()) return '';
                const t = i18n.t;
                const name = displayName(msg.sender);
                if (msg.text === 'member_left') return t('grp.member_left').replace('{{name}}', name);
                if (msg.text?.startsWith('member_kicked:')) {
                  const targetId = msg.text.slice('member_kicked:'.length);
                  const allMembers = chatStore.chats.flatMap((c) => c.members);
                  const target = chat()?.members.find((mb) => mb.user.id === targetId)?.user ?? allMembers.find((mb) => mb.user.id === targetId)?.user;
                  return t('grp.member_kicked').replace('{{name}}', target ? displayName(target) : targetId);
                }
                if (msg.text?.startsWith('role_changed:')) {
                  const parts = msg.text.split(':');
                  const targetId = parts[1];
                  const newRole = parts[2];
                  const allMembers = chatStore.chats.flatMap((c) => c.members);
                  const target = chat()?.members.find((mb) => mb.user.id === targetId)?.user ?? allMembers.find((mb) => mb.user.id === targetId)?.user;
                  const targetName = target ? displayName(target) : targetId;
                  const roleLabel = newRole === 'ADMIN' ? t('grp.admin') : t('grp.member');
                  return `${targetName} → ${roleLabel}`;
                }
                return msg.text ?? '';
              };

              return (
                <>
                  <Show when={isSystem()}>
                    <div class={styles.systemRow} data-msg-id={msg.id}>
                      <Show when={shouldShowDateSep(idx())}>
                        <div class={styles.dateSeparator}>
                          <span class={styles.dateSeparatorPill}>{dateLabelFor(msg.createdAt)}</span>
                        </div>
                      </Show>
                      <div class={styles.systemMsg}>{systemText()}</div>
                    </div>
                  </Show>
                  <Show when={isGroupFollower()}>
                    <div data-msg-id={msg.id} style="display:none" />
                  </Show>
                  <Show when={isGroupLeader() && !isSystem()}>
                    <div
                      class={mine() ? styles.mediaGroupRowMine : styles.mediaGroupRowTheirs}
                      data-msg-id={msg.id}
                    >
                      <Show when={shouldShowDateSep(idx())}>
                        <div class={styles.dateSeparator}>
                          <span class={styles.dateSeparatorPill}>{dateLabelFor(msg.createdAt)}</span>
                        </div>
                      </Show>
                      <div class={`${styles.mediaGrid} ${styles['mediaGrid' + Math.min(mgInfo()!.items.length, 10)]}`}>
                        <For each={mgInfo()!.items.slice(0, 10)}>
                          {(item, gIdx) => (
                            <div
                              class={styles.mediaGridItem}
                              onClick={(e) => { e.stopPropagation(); openLightbox(item.id, e.currentTarget as HTMLElement); }}
                            >
                              <Show when={item.type === 'IMAGE'}>
                                <img src={mediaUrl(item.mediaUrl)!} alt="" loading="lazy" />
                              </Show>
                              <Show when={item.type === 'VIDEO'}>
                                <video src={mediaUrl(item.mediaUrl)!} />
                                <div class={styles.mediaGridVideoIcon}>
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21" /></svg>
                                </div>
                              </Show>
                              <Show when={gIdx() === 9 && mgInfo()!.items.length > 10}>
                                <div class={styles.mediaGridMore}>+{mgInfo()!.items.length - 10}</div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                      <div class={styles.mediaGroupMeta}>
                        <span class={styles.mediaGroupTime}>{fmt(msg.createdAt)}</span>
                        <Show when={mine()}>
                          <Show when={msg.pending} fallback={
                            <Show when={isRead(msg)} fallback={
                              <Show when={isDelivered(msg)}>
                                <svg class={styles.mediaGroupCheck} width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                              </Show>
                            }>
                              <svg class={styles.mediaGroupCheck} width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 7l-8 8-3-3" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 7l-8 8" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            </Show>
                          }>
                            <svg class={styles.mediaGroupCheck} width="12" height="12" viewBox="0 0 24 24" fill="none" style="opacity:0.5"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </Show>
                  <Show when={!isGroupMember() && !isSystem()}>
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
                      onContextMenu={(msgId, pos) => { setMenuPos(pos); setMenuMsgId(msgId); setMenuSelection(window.getSelection()?.toString().trim() || ''); }}
                      onScrollToMessage={scrollToMessage}
                      onReaction={handleReaction}
                      onOpenLightbox={openLightbox}
                      fmt={fmt}
                      isRead={isRead}
                      isDelivered={isDelivered}
                      isPending={(m) => !!m.pending}
                      isFailed={(m) => !!m.failed}
                      onRetry={handleRetry}
                      onReply={(m) => setReplyTo(m)}
                      isSelected={selectedIds().has(msg.id)}
                      selectionActive={selectionActive()}
                      onSelect={toggleSelect}
                    />
                  </Show>
                </>
              );
            }}
          </For>

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

          {/* Bottom sentinel — IntersectionObserver detects if user sees newest messages */}
          <div ref={setupBottomSentinel} style="height:1px;width:100%;flex-shrink:0;pointer-events:none;" />
        </div>
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
        <Show when={previewMedia().length > 0}>
          <Portal>
            <MediaPreviewModal
              mediaList={previewMedia()}
              onSend={handlePreviewSend}
              onCancel={handlePreviewCancel}
              onAddMore={handlePreviewAddMore}
              onRemove={handlePreviewRemove}
            />
          </Portal>
        </Show>

        {/* Profile panels (user + group) are rendered in App.tsx right panel via uiStore */}
      </div>

      <MessageContextMenu
        menuMsgId={menuMsgId}
        setMenuMsgId={setMenuMsgId}
        menuPos={menuPos}
        menuSelection={menuSelection}
        forwardMsg={forwardMsg}
        setForwardMsg={setForwardMsg}
        deleteModalId={deleteModalId}
        setDeleteModalId={setDeleteModalId}
        chatId={chatId}
        me={me}
        chat={() => chat() ?? undefined}
        onReply={(msg) => setReplyTo(msg)}
        onQuote={(msg, sel) => {
          const nick = msg.sender?.nickname || msg.sender?.firstName || '';
          const quoted = sel.split('\n').map((l: string) => `> ${l}`).join('\n');
          setText(quoted + `\n> — @${nick}\n\n`);
        }}
        onEdit={(msgId, text) => { setEditingId(msgId); setEditText(text); }}
        onReaction={handleReaction}
        onDelete={handleDelete}
        onForwardTo={handleForwardTo}
        onStartSelect={(msgId) => { setSelectedIds(new Set([msgId])); }}
      />

      {/* Multi-forward modal */}
      <Show when={multiForward()}>
        <Portal>
          <div class={styles.modalOverlay} onClick={() => setMultiForward(false)}>
            <div class={styles.modalBox} onClick={(e: MouseEvent) => e.stopPropagation()}>
              <div class={styles.modalHeader}>{i18n.t('msg.forward_title')}</div>
              <div class={styles.modalSearchWrap}>
                <input
                  class={styles.modalSearchInput}
                  placeholder={i18n.t('sidebar.search')}
                  value={multiFwdSearch()}
                  onInput={(e) => setMultiFwdSearch(e.currentTarget.value)}
                />
              </div>
              <div class={styles.modalChatList}>
                <For each={chatStore.chats.filter(c => {
                  const q = multiFwdSearch().toLowerCase();
                  if (!q) return true;
                  const n = c.name?.toLowerCase() ?? '';
                  const m = c.members.map(mb => mb.user.nickname?.toLowerCase() ?? '').join(' ');
                  return n.includes(q) || m.includes(q);
                })}>
                  {(c) => {
                    const chatName = () => c.name || c.members.filter(m => m.user.id !== me()?.id).map(m => displayName(m.user)).join(', ') || '?';
                    const avatar = () => c.avatar ? mediaUrl(c.avatar) : (c.type === 'DIRECT' || c.type === 'SECRET' ? (() => { const p = c.members.find(m => m.user.id !== me()?.id)?.user; return p?.avatar ? mediaUrl(p.avatar) : null; })() : null);
                    const initial = () => chatName()?.[0]?.toUpperCase() ?? '?';
                    return (
                      <div class={styles.modalChatItem} onClick={() => handleMultiForwardTo(c.id)}>
                        <div class={styles.modalChatAvatar}>
                          <Show when={avatar()} fallback={<span>{initial()}</span>}>
                            <img src={avatar()!} alt="" />
                          </Show>
                        </div>
                        <span class={styles.modalChatName}>{chatName()}</span>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

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
