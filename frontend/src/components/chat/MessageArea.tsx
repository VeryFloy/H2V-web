import {
  type Component, createSignal, createEffect, createMemo, For, Show,
  onMount, onCleanup, batch,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { wsStore } from '../../stores/ws.store';
import { api } from '../../api/client';
import styles from './MessageArea.module.css';
import type { Message, User } from '../../types';
import { formatLastSeen, displayName } from '../../utils/format';
import { settingsStore } from '../../stores/settings.store';
import { i18n } from '../../stores/i18n.store';

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const GROUP_GAP_MS = 5 * 60 * 1000;

const WAVE_BARS = 36;

function generateWaveform(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    bars.push(0.15 + (hash % 85) / 100);
  }
  return bars;
}

// ──────── Voice Message Player ────────
const VoicePlayer: Component<{ src: string; mine: boolean }> = (props) => {
  const [playing, setPlaying] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [currentTime, setCurrent] = createSignal(0);
  let audio: HTMLAudioElement | undefined;
  const bars = generateWaveform(props.src);

  function toggle() {
    if (!audio) {
      audio = new Audio(props.src);
      audio.addEventListener('loadedmetadata', () => setDuration(audio!.duration));
      audio.addEventListener('timeupdate', () => {
        setCurrent(audio!.currentTime);
        setProgress(audio!.duration > 0 ? audio!.currentTime / audio!.duration : 0);
      });
      audio.addEventListener('ended', () => { setPlaying(false); setProgress(0); setCurrent(0); });
    }
    if (playing()) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  }

  function seekByClick(e: MouseEvent) {
    const wrap = e.currentTarget as HTMLElement;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio && duration() > 0) {
      audio.currentTime = ratio * duration();
      setProgress(ratio);
      setCurrent(audio.currentTime);
    }
  }

  function fmt(s: number): string {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  onCleanup(() => { if (audio) { audio.pause(); audio.src = ''; } });

  return (
    <div class={styles.voicePlayer}>
      <button class={`${styles.voicePlayBtn} ${props.mine ? styles.voicePlayBtnMine : ''}`} onClick={toggle}>
        <Show when={playing()} fallback={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        }>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        </Show>
      </button>
      <div class={styles.voiceWaveWrap}>
        <div class={styles.voiceWaveBars} onClick={seekByClick}>
          {bars.map((h, i) => (
            <div
              class={`${styles.waveBarItem} ${(i / WAVE_BARS) < progress() ? (props.mine ? styles.waveBarPlayedMine : styles.waveBarPlayed) : ''}`}
              style={{ height: `${h * 100}%` }}
            />
          ))}
        </div>
        <div class={styles.voiceTimeLine}>
          <span class={styles.voiceTime}>{playing() || currentTime() > 0 ? fmt(currentTime()) : fmt(duration())}</span>
        </div>
      </div>
    </div>
  );
};


function sameGroup(a: Message, b: Message): boolean {
  if (a.sender?.id !== b.sender?.id) return false;
  return Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < GROUP_GAP_MS;
}


import UserProfile from '../ui/UserProfile';

// ────────────────── Profile Panel (inline, for chat header) ──────────────────
const ProfilePanel: Component<{ user: User | null; onClose: () => void }> = (props) => {
  return (
    <Show when={props.user}>
      <UserProfile
        userId={props.user!.id}
        onClose={props.onClose}
        onStartChat={async (uid) => { props.onClose(); await chatStore.startDirectChat(uid); }}
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
  const [showReactionPicker, setShowReactionPicker] = createSignal<string | null>(null);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQ, setSearchQ] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<Message[]>([]);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [showHeaderMenu, setShowHeaderMenu] = createSignal(false);
  const [menuPortalPos, setMenuPortalPos] = createSignal({ top: 0, right: 0 });
  const [showScrollBtn, setShowScrollBtn] = createSignal(false);
  const [showProfile, setShowProfile] = createSignal(false);
  const [showLightbox, setShowLightbox] = createSignal<string | null>(null);
  const [mutedChats, setMutedChats] = createSignal<Set<string>>(
    new Set(JSON.parse(localStorage.getItem('h2v_muted') ?? '[]'))
  );
  const [actionError, setActionError] = createSignal('');
  const [recording, setRecording] = createSignal(false);
  const [recordTimeMs, setRecordTimeMs] = createSignal(0);
  let mediaRecorder: MediaRecorder | null = null;
  let recordChunks: Blob[] = [];
  let recordTimerInterval: ReturnType<typeof setInterval> | null = null;
  let recordStartTs = 0;
  let recordCancelled = false;

  let msgsRef!: HTMLDivElement;
  let fileInputRef!: HTMLInputElement;
  let textareaRef!: HTMLTextAreaElement;
  let searchInputRef!: HTMLInputElement;
  let menuBtnRef!: HTMLButtonElement;
  let searchTimer: ReturnType<typeof setTimeout>;
  let typingTimer: ReturnType<typeof setTimeout>;
  let actionErrorTimer: ReturnType<typeof setTimeout>;
  let isTyping = false;
  let nearBottom = true;

  const chatId = () => chatStore.activeChatId();
  const msgs = () => chatStore.messages[chatId() ?? ''] ?? [];
  const me = () => authStore.user();
  const chat = () => chatStore.activeChat();
  const isMuted = () => mutedChats().has(chatId() ?? '');

  const partner = createMemo(() => {
    const c = chat();
    if (!c || c.type !== 'DIRECT') return null;
    return c.members.find((m) => m.user.id !== me()?.id)?.user ?? null;
  });

  // Stable reversed list: SolidJS store proxies are stable references,
  // so For<> can reconcile correctly (no DOM teardown on new messages).
  const reversedMsgs = createMemo(() => [...msgs()].reverse());

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

  // Bug 3 fix: reset all local state when switching chats so nothing leaks between conversations
  createEffect((prevId) => {
    const id = chatId();
    if (id !== prevId) {
      batch(() => {
        setText('');
        setEditingId(null);
        setEditText('');
        setReplyTo(null);
        setSearchOpen(false);
        setSearchQ('');
        setSearchResults([]);
        setMenuMsgId(null);
        setShowReactionPicker(null);
      });
    }
    return id;
  }, chatId());

  // Stay at bottom when new message arrives and user was already there
  createEffect(() => {
    const list = msgs();
    if (list.length === 0 || !msgsRef) return;
    const last = list[list.length - 1];
    const age = Date.now() - new Date(last?.createdAt ?? 0).getTime();
    if (nearBottom && age < 8000) {
      msgsRef.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Focus search input when search opens
  createEffect(() => {
    if (searchOpen() && searchInputRef) {
      setTimeout(() => searchInputRef?.focus(), 50);
    }
  });

  // ESC: cascading close
  createEffect(() => {
    const id = chatId();
    if (!id) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (showLightbox()) { setShowLightbox(null); return; }
      if (showReactionPicker()) { setShowReactionPicker(null); return; }
      if (menuMsgId()) { setMenuMsgId(null); return; }
      if (showHeaderMenu()) { setShowHeaderMenu(false); return; }
      if (searchOpen()) { closeSearch(); return; }
      if (editingId()) { setEditingId(null); return; }
      if (showProfile()) { setShowProfile(false); return; }
      chatStore.setActiveChatId(null);
    }
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  function closeSearch() {
    setSearchOpen(false);
    setSearchQ('');
    setSearchResults([]);
  }

  function openHeaderMenu() {
    if (menuBtnRef) {
      const rect = menuBtnRef.getBoundingClientRect();
      setMenuPortalPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    // Toggle: if open, close; if closed, open
    setShowHeaderMenu((v) => !v);
  }

  function closeHeaderMenu() {
    setShowHeaderMenu(false);
  }

  function onScroll() {
    if (!msgsRef) return;
    nearBottom = msgsRef.scrollTop < 120;
    setShowScrollBtn(msgsRef.scrollTop > 300);
  }

  function scrollToBottom() {
    msgsRef?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resizeTextarea() {
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 140) + 'px';
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

  function handleSend(e?: Event) {
    e?.preventDefault();
    const t = text().trim();
    const id = chatId();
    if (!t || !id) return;
    if (!wsStore.connected()) {
      const token = localStorage.getItem('accessToken');
      if (token) wsStore.connect(token);
      return;
    }
    const reply = replyTo();
    batch(() => { setText(''); setReplyTo(null); });
    if (textareaRef) textareaRef.style.height = 'auto';
    isTyping = false; clearTimeout(typingTimer);
    nearBottom = true;
    wsStore.send({ event: 'typing:stop', payload: { chatId: id } });
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
      await api.editMessage(id, t);
      setEditingId(null);
    } catch {
      showActionError('Failed to edit message');
    }
  }

  async function handleDelete(msgId: string) {
    setMenuMsgId(null);
    try { await api.deleteMessage(msgId); }
    catch { showActionError('Failed to delete message'); }
  }

  async function handleReaction(msgId: string, emoji: string) {
    setShowReactionPicker(null);
    const msg = msgs().find((m) => m.id === msgId);
    const mine = msg?.reactions?.find((r) => r.userId === me()?.id && r.emoji === emoji);
    try {
      if (mine) await api.removeReaction(msgId, emoji);
      else await api.addReaction(msgId, emoji);
    } catch { /* noop */ }
  }

  async function handleFileUpload(file: File) {
    const id = chatId();
    if (!id || !wsStore.connected()) return;
    setUploading(true);
    try {
      const res = await api.upload(file);
      const reply = replyTo(); setReplyTo(null);
      nearBottom = true;
      wsStore.send({
        event: 'message:send',
        payload: { chatId: id, text: null, mediaUrl: res.data.url, type: res.data.type,
          ...(reply ? { replyToId: reply.id } : {}) },
      });
    } catch {
      showActionError('Failed to upload file');
    } finally { setUploading(false); }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';
      recordCancelled = false;
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      recordChunks = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordCancelled || recordChunks.length === 0) return;
        const blob = new Blob(recordChunks, { type: mimeType });
        const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
        await handleFileUpload(file);
      };
      mediaRecorder.start(200);
      setRecording(true);
      recordStartTs = Date.now();
      setRecordTimeMs(0);
      recordTimerInterval = setInterval(() => setRecordTimeMs(Date.now() - recordStartTs), 50);
    } catch {
      showActionError('Нет доступа к микрофону');
    }
  }

  function stopRecording(send: boolean) {
    if (recordTimerInterval) { clearInterval(recordTimerInterval); recordTimerInterval = null; }
    setRecording(false);
    setRecordTimeMs(0);
    if (!mediaRecorder) return;
    if (!send) {
      recordCancelled = true;
      recordChunks = [];
    }
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    mediaRecorder = null;
  }

  function fmtRecTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    const cs = Math.floor((ms % 1000) / 10);
    return `${m}:${s.toString().padStart(2, '0')},${cs.toString().padStart(2, '0')}`;
  }

  async function handleSearch(q: string) {
    setSearchQ(q);
    clearTimeout(searchTimer);
    // Bug 8 fix: capture chatId at call time so results from a previous chat can't leak in
    const currentChatId = chatId();
    if (!q.trim() || !currentChatId) { setSearchResults([]); return; }
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

  function toggleMute() {
    const id = chatId(); if (!id) return;
    setMutedChats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('h2v_muted', JSON.stringify([...next]));
      return next;
    });
    closeHeaderMenu();
  }

  async function handleLeaveChat() {
    closeHeaderMenu();
    const id = chatId(); if (!id) return;
    try {
      await api.leaveChat(id);
      // GROUP: just remove us locally (no WS event for group leave)
      chatStore.removeChat(id);
    } catch { showActionError('Failed to leave chat'); }
  }

  async function handleDeleteChat() {
    closeHeaderMenu();
    const id = chatId(); if (!id) return;
    try {
      await api.leaveChat(id);
    } catch { showActionError('Failed to delete chat'); }
  }

  function typingLabel(): string {
    const id = chatId(); if (!id) return '';
    const others = (chatStore.typing[id] ?? []).filter((uid: string) => uid !== me()?.id);
    if (!others.length) return '';
    const c = chat();
    const tSingle = i18n.t('msg.typing_single');
    const tPlural = i18n.t('msg.typing_plural');
    if (c?.type === 'DIRECT') {
      const p = partner();
      return p ? `${displayName(p)} ${tSingle}` : tSingle;
    }
    const names = others
      .map((uid) => { const u = c?.members.find((m) => m.user.id === uid)?.user; return u ? displayName(u) : null; })
      .filter(Boolean) as string[];
    if (!names.length) return tSingle;
    if (names.length === 1) return `${names[0]} ${tSingle}`;
    if (names.length === 2) return `${names[0]} & ${names[1]} ${tPlural}`;
    return `${names[0]} +${names.length - 1} ${tPlural}`;
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
        (m.readBy ?? []).some((uid) => uid !== meId && uid !== '__delivered__');
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
      if ((m.readBy ?? []).includes('__delivered__')) best = t;
    }
    return best;
  });

  function isRead(msg: Message): boolean {
    const meId = me()?.id;
    if (!meId) return false;
    const wm = readWatermark();
    if (wm > 0 && new Date(msg.createdAt).getTime() <= wm) return true;
    if ((msg.readReceipts ?? []).some((r) => r.userId !== meId)) return true;
    return (msg.readBy ?? []).some((uid) => uid !== meId && uid !== '__delivered__');
  }

  function isDelivered(msg: Message): boolean {
    const wm = deliveredWatermark();
    if (wm > 0 && new Date(msg.createdAt).getTime() <= wm) return true;
    return (msg.readBy ?? []).includes('__delivered__');
  }

  function fmt(iso: string): string {
    return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  }

  function groupReactions(msg: Message) {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of msg.reactions ?? []) {
      const e = map.get(r.emoji) ?? { count: 0, mine: false };
      map.set(r.emoji, { count: e.count + 1, mine: e.mine || r.userId === me()?.id });
    }
    return Array.from(map.entries()).map(([emoji, d]) => ({ emoji, ...d }));
  }

  // Only close message-level menus on outside click.
  // Header menu is handled by its own backdrop (Portal), so we don't touch it here —
  // that avoids the SolidJS event delegation conflict.
  function onDocClick() { setMenuMsgId(null); setShowReactionPicker(null); }
  onMount(() => document.addEventListener('click', onDocClick));
  onCleanup(() => {
    document.removeEventListener('click', onDocClick);
    clearTimeout(typingTimer);
    clearTimeout(searchTimer);
    clearTimeout(actionErrorTimer);
    if (recordTimerInterval) clearInterval(recordTimerInterval);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
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
    if (chat()?.type === 'DIRECT') return partner();
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
        {/* ── Header (normal + search mode overlap, animated) ── */}
        <div class={styles.header}>
          {/* Normal mode */}
          <div class={`${styles.headerNormal} ${searchOpen() ? styles.headerNormalHide : ''}`}>
            {/* Mobile: back to chat list — use history.back() so browser/iOS back
                gesture and this button both go through the same popstate handler */}
            <button
              class={styles.mobileBack}
              onClick={() => {
                if (history.state?.h2vChat) history.back();
                else chatStore.setActiveChatId(null);
              }}
              title={i18n.t('sidebar.cancel')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button class={styles.hUserBtn} onClick={() => setShowProfile(true)} title={i18n.t('msg.profile')}>
              <Show when={partner()} keyed>
                {(p) => (
                  <>
                    <div class={styles.hAvatar}>
                      <Show when={p.avatar} fallback={<span>{displayName(p)[0]?.toUpperCase()}</span>}>
                        <img src={p.avatar!} alt="" />
                      </Show>
                      <Show when={chatStore.onlineIds().has(p.id)}>
                        <div class={styles.hOnline} />
                      </Show>
                    </div>
                    <div>
                      <div class={styles.hName}>{displayName(p)}</div>
                      <div class={styles.hStatusWrap}>
                        <span class={`${styles.hStatusDot} ${chatStore.onlineIds().has(p.id) ? styles.hStatusDotOnline : ''}`} />
                        <span class={`${styles.hStatusText} ${chatStore.onlineIds().has(p.id) ? styles.hStatusTextOnline : ''}`}>
                          {chatStore.onlineIds().has(p.id) ? i18n.t('profile.online') : formatLastSeen(p.lastOnline)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </Show>
              <Show when={chat()?.type === 'GROUP'}>
                <div class={styles.hAvatar}>
                  <Show when={chat()?.avatar} fallback={<span>{chat()?.name?.[0]?.toUpperCase() ?? 'Г'}</span>}>
                    <img src={chat()!.avatar!} alt="" />
                  </Show>
                </div>
                <div>
                  <div class={styles.hName}>{chat()?.name ?? 'Группа'}</div>
                  <div class={styles.hStatus}>{chat()?.members.length ?? 0} {i18n.t('msg.members')}</div>
                </div>
              </Show>
            </button>

            <div class={styles.hActions}>
              <Show when={!wsStore.connected()}>
                <div class={styles.noWs}>{i18n.t('msg.no_connection')}</div>
              </Show>
              <button class={styles.iconBtn} onClick={() => setSearchOpen(true)} title={i18n.t('msg.search')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                  <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
              <button
                ref={menuBtnRef!}
                class={`${styles.iconBtn} ${showHeaderMenu() ? styles.iconBtnActive : ''}`}
                onClick={openHeaderMenu}
                title="Ещё"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Search mode — slides in from right */}
          <div class={`${styles.headerSearchMode} ${searchOpen() ? styles.headerSearchModeShow : ''}`}>
            <button class={styles.iconBtn} onClick={closeSearch}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class={styles.headerSearchInputWrap}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" class={styles.headerSearchIcon}>
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
                <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <input
                ref={searchInputRef!}
                class={styles.headerSearchInput}
                placeholder={i18n.t('msg.search_chat')}
                value={searchQ()}
                onInput={(e) => handleSearch(e.currentTarget.value)}
              />
              <Show when={searchLoading()}>
                <span class={styles.headerSearchHint}>...</span>
              </Show>
              <Show when={!searchLoading() && searchQ().trim() && searchResults().length === 0}>
                <span class={styles.headerSearchHint}>{i18n.t('msg.not_found')}</span>
              </Show>
            </div>
            <Show when={searchQ()}>
              <button class={styles.iconBtn} onClick={() => { setSearchQ(''); setSearchResults([]); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
              </button>
            </Show>
          </div>
        </div>

        {/* Search results dropdown (absolute, below header) */}
        <Show when={searchOpen() && searchResults().length > 0}>
          <div class={styles.searchResultsList}>
            <For each={searchResults()}>
              {(msg) => (
                <div class={styles.searchResult}>
                    <span class={styles.searchResultSender}>{msg.sender?.nickname}</span>
                    <span class={styles.searchResultText}>{msg.text ?? '[медиа]'}</span>
                    <span class={styles.searchResultTime}>{fmt(msg.createdAt)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

        {/* ── Messages (column-reverse: scrollTop=0 = bottom = newest) ── */}
        <div
          class={`${styles.messages} ${styles['wp_' + settingsStore.settings().chatWallpaper] ?? ''}`}
          ref={msgsRef!}
          onScroll={onScroll}
          style={{ '--msg-font-size': settingsStore.settings().fontSize === 'small' ? '13px' : settingsStore.settings().fontSize === 'large' ? '16px' : '14px' }}
        >

          {/* Typing — first in DOM = visual bottom with column-reverse */}
          <Show when={typingLabel()}>
            <div class={styles.typingBubble}>
              <span class={styles.typingDots}><span /><span /><span /></span>
            </div>
          </Show>

          <For each={reversedMsgs()}>
            {(msg) => {
              // Memoize per-message grouping so DOM only updates when value changes
              const g = createMemo(() => groupingMap().get(msg.id) ?? { withBelow: false, withAbove: false, showAvatar: false });
              const mine = () => me()?.id === msg.sender?.id;
              const reacted = () => groupReactions(msg);
              const isImageOnly = () => msg.type === 'IMAGE' && !!msg.mediaUrl && !msg.text;

              return (
                <div class={`${mine() ? styles.rowMine : styles.rowTheirs} ${g().withBelow ? styles.rowGrouped : ''}`}>
                  <Show when={!mine()}>
                    <div class={styles.avatarSlot}>
                      <Show when={g().showAvatar}>
                        <div class={styles.msgAvatar}>
                          <Show when={msg.sender?.avatar} fallback={
                            <span>{msg.sender?.nickname?.[0]?.toUpperCase() ?? '?'}</span>
                          }>
                            <img src={msg.sender!.avatar!} alt="" />
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <div class={styles.bubbleWrap}>
                    <Show when={msg.replyTo}>
                      <div class={mine() ? styles.replyQuoteMine : styles.replyQuoteTheirs}>
                        <span class={styles.replyQuoteSender}>
                          {msg.replyTo!.isDeleted ? 'Удалено' : msg.replyTo!.sender?.nickname}
                        </span>
                        <span class={styles.replyQuoteText}>
                          {msg.replyTo!.isDeleted ? 'Сообщение удалено' : (msg.replyTo!.text ?? '[медиа]')}
                        </span>
                      </div>
                    </Show>

                    <div
                      class={[
                        styles.bubble,
                        mine() ? styles.bubbleMine : styles.bubbleTheirs,
                        msg.isDeleted ? styles.bubbleDeleted : '',
                        isImageOnly() ? styles.bubbleImage : '',
                        g().withAbove && mine()  ? styles.bubbleMineTop   : '',
                        g().withAbove && !mine() ? styles.bubbleTheirsTop : '',
                        g().withBelow && mine()  ? styles.bubbleMineBot   : '',
                        g().withBelow && !mine() ? styles.bubbleTheirsBot : '',
                      ].filter(Boolean).join(' ')}
                      onContextMenu={(e) => {
                        if (msg.isDeleted) return;
                        e.preventDefault(); e.stopPropagation();
                        const menuW = 190, menuH = 160;
                        const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
                        const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
                        setMenuPos({ x, y });
                        setMenuMsgId(msg.id);
                      }}
                    >
                      <Show when={!mine() && chat()?.type === 'GROUP' && !g().withAbove}>
                        <div class={styles.senderName}>{displayName(msg.sender)}</div>
                      </Show>

                      <Show when={msg.isDeleted}>
                        <span class={styles.deletedText}>{i18n.t('msg.deleted')}</span>
                      </Show>
                      <Show when={!msg.isDeleted}>
                        <Show when={msg.type === 'IMAGE' && msg.mediaUrl}>
                          <div
                            class={styles.mediaImgWrap}
                            onClick={(e) => { e.stopPropagation(); setShowLightbox(msg.mediaUrl!); }}
                          >
                            <img class={styles.mediaImg} src={msg.mediaUrl!} alt="" loading="lazy" />
                            {/* Time overlay on image, Telegram-style */}
                            <Show when={isImageOnly()}>
                              <div class={styles.mediaImgOverlay}>
                                <Show when={msg.isEdited}><span class={styles.overlayEdited}>{i18n.t('msg.edited')}</span></Show>
                                <span class={styles.overlayTime}>{fmt(msg.createdAt)}</span>
                                <Show when={mine()}>
                                  <span class={`${styles.overlayTick} ${isRead(msg) ? styles.overlayTickRead : isDelivered(msg) ? styles.overlayTickDelivered : ''}`}>
                                    <Show when={isRead(msg) || isDelivered(msg)} fallback={
                                      <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    }>
                                      <svg width="20" height="11" viewBox="0 0 20 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L10.5 10L19.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    </Show>
                                  </span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </Show>
                        <Show when={msg.type === 'VIDEO' && msg.mediaUrl}>
                          <video class={styles.mediaVideo} src={msg.mediaUrl!} controls />
                        </Show>
                        <Show when={msg.type === 'AUDIO' && msg.mediaUrl}>
                          <VoicePlayer src={msg.mediaUrl!} mine={mine()} />
                        </Show>
                        <Show when={msg.type === 'FILE' && msg.mediaUrl}>
                          <a class={styles.mediaFile} href={msg.mediaUrl!} target="_blank" rel="noreferrer">
                            📎 Скачать файл
                          </a>
                        </Show>
                        <Show when={msg.text}>
                          <span class={styles.msgText}>{msg.text}</span>
                        </Show>
                        <Show when={!msg.text && msg.ciphertext}>
                          <span class={styles.encryptedText}>🔒 Зашифровано</span>
                        </Show>
                        <Show when={!isImageOnly()}>
                          <div class={styles.meta}>
                            <Show when={msg.isEdited}><span class={styles.edited}>{i18n.t('msg.edited')}</span></Show>
                            <span class={styles.time}>{fmt(msg.createdAt)}</span>
                            <Show when={mine()}>
                              <span class={`${styles.tick} ${isRead(msg) ? styles.tickRead : isDelivered(msg) ? styles.tickDelivered : ''}`}>
                                <Show when={isRead(msg) || isDelivered(msg)} fallback={
                                  <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                }>
                                  <svg width="20" height="11" viewBox="0 0 20 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L10.5 10L19.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                </Show>
                              </span>
                            </Show>
                          </div>
                        </Show>
                      </Show>

                      {/* Menu rendered via Portal below */}
                    </div>

                    <Show when={!msg.isDeleted && reacted().length > 0}>
                      <div class={styles.reactionsRow}>
                        <For each={reacted()}>
                          {(r) => (
                            <button class={`${styles.reactionChip} ${r.mine ? styles.reactionMine : ''}`}
                              onClick={() => handleReaction(msg.id, r.emoji)}>
                              {r.emoji}{r.count > 1 ? ` ${r.count}` : ''}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={!msg.isDeleted}>
                      <div class={styles.reactionAddWrap}>
                        <button class={styles.reactionAdd}
                          onClick={(e) => { e.stopPropagation(); setShowReactionPicker((v) => v === msg.id ? null : msg.id); }}>
                          😊
                        </button>
                        <Show when={showReactionPicker() === msg.id}>
                          <div class={`${styles.reactionPicker} ${mine() ? styles.reactionPickerMine : ''}`}
                            onClick={(e) => e.stopPropagation()}>
                            <For each={ALLOWED_REACTIONS}>
                              {(emoji) => (
                                <button class={styles.reactionPickerBtn} onClick={() => handleReaction(msg.id, emoji)}>
                                  {emoji}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>

          {/* Load more — last in DOM = visual top with column-reverse */}
          <Show when={chatStore.cursors[chatId()!] !== null && chatStore.cursors[chatId()!] !== undefined && !chatStore.loadingMsgs(chatId()!)}>
            <div class={styles.loadMoreWrap}>
              <button class={styles.loadMore} onClick={() => chatStore.loadMessages(chatId()!, true)}>
                ↑ {i18n.t('msg.load_more')}
              </button>
            </div>
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
        <Show when={showScrollBtn()}>
          <button class={styles.scrollBtn} onClick={scrollToBottom} title="Вниз">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </Show>

        {/* Reply bar */}
        <Show when={replyTo()}>
          <div class={styles.replyBar}>
            <div class={styles.replyBarAccent} />
            <div class={styles.replyBarContent}>
              <span class={styles.replyBarSender}>{replyTo()!.sender?.nickname}</span>
              <span class={styles.replyBarText}>{replyTo()!.text ?? '[медиа]'}</span>
            </div>
            <button class={styles.replyBarClose} onClick={() => setReplyTo(null)}>✕</button>
          </div>
        </Show>

        {/* Action error toast */}
        <Show when={actionError()}>
          <div class={styles.actionError}>{actionError()}</div>
        </Show>

        {/* Input */}
        <Show
          when={!editingId()}
          fallback={
            <form class={styles.inputRow} onSubmit={handleEdit}>
              <textarea class={`${styles.input} ${styles.inputEdit}`} value={editText()} rows={1}
                onInput={(e) => { setEditText(e.currentTarget.value); const el = e.currentTarget; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,140)+'px'; }}
                onKeyDown={(e) => { if (e.key==='Escape') setEditingId(null); if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleEdit();} }}
                autofocus placeholder={i18n.t('msg.edit') + '...'} />
              <button class={styles.btnSave} type="submit">✓</button>
              <button class={styles.btnCancel} type="button" onClick={() => setEditingId(null)}>✕</button>
            </form>
          }
        >
          <Show when={recording()} fallback={
            <form class={styles.inputRow} onSubmit={handleSend}>
              <input type="file" ref={fileInputRef!} style="display:none"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt"
                onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) handleFileUpload(f); e.currentTarget.value=''; }} />
              <button type="button" class={styles.btnAttach}
                onClick={() => fileInputRef?.click()}
                disabled={uploading() || !wsStore.connected()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <textarea ref={textareaRef!} class={styles.input} placeholder={i18n.t('msg.placeholder')} value={text()} rows={1}
                onInput={(e) => { setText(e.currentTarget.value); resizeTextarea(); handleTyping(); }}
                onKeyDown={(e) => {
                  const s = settingsStore.settings().sendByEnter;
                  if (s && e.key==='Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  if (!s && e.key==='Enter' && e.ctrlKey) { e.preventDefault(); handleSend(); }
                }}
                disabled={!wsStore.connected()} />
              <Show when={text().trim()} fallback={
                <button class={styles.btnMic} type="button" onClick={startRecording} disabled={!wsStore.connected()}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <rect x="9" y="1" width="6" height="14" rx="3" stroke="currentColor" stroke-width="2"/>
                    <path d="M5 10a7 7 0 0014 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </button>
              }>
                <button class={styles.btnSend} type="submit" disabled={!text().trim() || !wsStore.connected()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </Show>
            </form>
          }>
            <div class={styles.recRow}>
              <div class={styles.recTimerPill}>
                <span class={styles.recDot} />
                <span class={styles.recTimerText}>{fmtRecTime(recordTimeMs())}</span>
              </div>
              <button class={styles.btnRecDelete} type="button" onClick={() => stopRecording(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
              <button class={styles.btnRecSend} type="button" onClick={() => stopRecording(true)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </Show>
        </Show>

        {/* Profile panel overlay */}
        <Show when={showProfile() && profileUser()}>
          <ProfilePanel user={profileUser()} onClose={() => setShowProfile(false)} />
        </Show>
      </div>

      {/* 3-dot menu via Portal — renders in document.body, always above everything.
          Backdrop covers everything BELOW the header (top:56px) so clicking outside
          closes the menu without interfering with the toggle button in the header. */}
      <Show when={showHeaderMenu()}>
        <Portal>
          <div
            style="position:fixed;inset:0;z-index:9996;"
            onClick={closeHeaderMenu}
          />
          <div
            class={styles.headerMenuPortal}
            style={{ top: menuPortalPos().top + 'px', right: menuPortalPos().right + 'px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={toggleMute}>
              <Show when={isMuted()} fallback={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              }>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </Show>
              {isMuted() ? i18n.t('msg.unmute_chat') : i18n.t('msg.mute_chat')}
            </button>
            <button onClick={() => { setSearchOpen(true); closeHeaderMenu(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              {i18n.t('msg.search')}
            </button>
            <Show when={chat()?.type === 'DIRECT'}>
              <button onClick={() => { setShowProfile(true); closeHeaderMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>
                {i18n.t('msg.profile')}
              </button>
            </Show>
            <div class={styles.headerMenuDivider} />
            <Show when={chat()?.type === 'GROUP'}>
              <button onClick={handleLeaveChat}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                {i18n.t('msg.leave_group')}
              </button>
            </Show>
            <Show when={chat()?.type === 'DIRECT'}>
              <button class={styles.headerMenuDanger} onClick={handleDeleteChat}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                {i18n.t('msg.delete_chat')}
              </button>
            </Show>
          </div>
        </Portal>
      </Show>

      {/* Message context menu — Portal so it's never clipped by bubble overflow */}
      <Show when={menuMsgId()}>
        <Portal>
          <div
            style="position:fixed;inset:0;z-index:8000;"
            onClick={() => setMenuMsgId(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenuMsgId(null); }}
          />
          <div
            class={styles.msgCtxMenu}
            style={{ top: menuPos().y + 'px', left: menuPos().x + 'px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const msg = (chatStore.messages[chatId()!] ?? []).find((m) => m.id === menuMsgId());
              if (!msg) return null;
              const isMine = msg.sender?.id === me()?.id;
              return (
                <>
                  <button onClick={() => { setMenuMsgId(null); setReplyTo(msg); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-7a4 4 0 00-4-4H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    {i18n.t('msg.reply')}
                  </button>
                  <button onClick={() => { setMenuMsgId(null); navigator.clipboard?.writeText(msg.text ?? ''); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>
                    {i18n.t('msg.copy')}
                  </button>
                  <Show when={isMine && !msg.isDeleted}>
                    <button onClick={() => { setMenuMsgId(null); setEditingId(msg.id); setEditText(msg.text ?? ''); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.edit')}
                    </button>
                    <div class={styles.msgCtxDivider} />
                    <button class={styles.msgCtxDanger} onClick={() => handleDelete(msg.id)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      {i18n.t('msg.delete_msg')}
                    </button>
                  </Show>
                </>
              );
            })()}
          </div>
        </Portal>
      </Show>

      {/* Lightbox — full screen image viewer */}
      <Show when={showLightbox()}>
        <Portal>
          <div class={styles.lightbox} onMouseDown={() => setShowLightbox(null)}>
            <button class={styles.lightboxClose} onMouseDown={(e) => { e.stopPropagation(); setShowLightbox(null); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>
            <img
              class={styles.lightboxImg}
              src={showLightbox()!}
              alt=""
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
        </Portal>
      </Show>
    </Show>
  );
};

export default MessageArea;
