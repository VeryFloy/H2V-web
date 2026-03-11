import {
  type Component, createSignal, createEffect, createMemo, For, Show,
  onMount, onCleanup, batch, untrack,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { wsStore } from '../../stores/ws.store';
import { api, mediaUrl, mediaMediumUrl } from '../../api/client';
import styles from './MessageArea.module.css';
import type { Chat, Message, User } from '../../types';
import { formatLastSeen, displayName } from '../../utils/format';
import { settingsStore } from '../../stores/settings.store';
import { mutedStore } from '../../stores/muted.store';
import { e2eStore } from '../../stores/e2e.store';
import { avatarColor } from '../../utils/avatar';
import { i18n } from '../../stores/i18n.store';

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const GROUP_GAP_MS = 5 * 60 * 1000;

const WAVE_BARS = 48;

// ──────── Real waveform extraction from audio ────────
const waveformCache = new Map<string, number[]>();
const voiceDurCache = new Map<string, number>();

function fallbackWaveform(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    bars.push(0.10 + (hash % 80) / 100);
  }
  return bars;
}

async function extractWaveform(url: string, barCount: number): Promise<number[]> {
  if (waveformCache.has(url)) return waveformCache.get(url)!;
  const resp = await fetch(url, { credentials: 'include' });
  const buf = await resp.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    if (decoded.duration && isFinite(decoded.duration)) {
      voiceDurCache.set(url, decoded.duration);
    }
    const raw = decoded.getChannelData(0);
    const step = Math.floor(raw.length / barCount);
    const peaks: number[] = [];
    for (let i = 0; i < barCount; i++) {
      let peak = 0;
      const end = Math.min((i + 1) * step, raw.length);
      for (let j = i * step; j < end; j++) {
        const v = Math.abs(raw[j]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
    }
    const maxPeak = Math.max(...peaks, 0.001);
    const normalized = peaks.map(p => Math.max(0.06, p / maxPeak));
    waveformCache.set(url, normalized);
    return normalized;
  } finally {
    await ctx.close();
  }
}

function fmtVoice(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ──────── Shared voice player state ────────
const VOICE_SPEEDS = [1, 1.5, 2] as const;
const [vpSrc, setVpSrc] = createSignal<string | null>(null);
const [vpPlaying, setVpPlaying] = createSignal(false);
const [vpProgress, setVpProgress] = createSignal(0);
const [vpDuration, setVpDuration] = createSignal(0);
const [vpCurrentTime, setVpCurrentTime] = createSignal(0);
const [vpSpeedIdx, setVpSpeedIdx] = createSignal(0);
const [vpSender, setVpSender] = createSignal('');
const [vpMsgTime, setVpMsgTime] = createSignal('');
let vpAudio: HTMLAudioElement | null = null;
let vpRaf: number | null = null;
let vpPlaylist: { src: string; sender: string; time: string }[] = [];

function vpTick() {
  if (!vpAudio || !vpPlaying()) { vpRaf = null; return; }
  setVpCurrentTime(vpAudio.currentTime);
  setVpProgress(vpAudio.duration > 0 ? vpAudio.currentTime / vpAudio.duration : 0);
  vpRaf = requestAnimationFrame(vpTick);
}
function vpStartRaf() { if (vpRaf == null) vpRaf = requestAnimationFrame(vpTick); }
function vpStopRaf() { if (vpRaf != null) { cancelAnimationFrame(vpRaf); vpRaf = null; } }

function vpOnMeta() { if (vpAudio) setVpDuration(vpAudio.duration); }
function vpOnEnd() {
  vpStopRaf();
  const cur = vpSrc();
  const idx = vpPlaylist.findIndex(p => p.src === cur);
  const next = idx >= 0 ? vpPlaylist[idx + 1] : undefined;
  if (next) {
    vpPlayInternal(next.src, next.sender, next.time);
  } else {
    vpClose();
  }
}

function vpPlayInternal(src: string, sender: string, time: string) {
  vpStopRaf();
  if (vpAudio) {
    vpAudio.pause();
    vpAudio.removeEventListener('loadedmetadata', vpOnMeta);
    vpAudio.removeEventListener('ended', vpOnEnd);
    vpAudio.src = '';
  }
  vpAudio = new Audio(src);
  const prevSpeed = vpSpeedIdx();
  batch(() => {
    setVpSrc(src);
    setVpSender(sender);
    setVpMsgTime(time);
    setVpProgress(0);
    setVpCurrentTime(0);
    setVpDuration(0);
  });
  if (VOICE_SPEEDS[prevSpeed] !== 1) vpAudio.playbackRate = VOICE_SPEEDS[prevSpeed];
  vpAudio.addEventListener('loadedmetadata', vpOnMeta);
  vpAudio.addEventListener('ended', vpOnEnd);
  vpAudio.play().catch(() => {});
  setVpPlaying(true);
  vpStartRaf();
}

function vpPlay(src: string, sender: string, time: string) {
  if (vpAudio && vpSrc() === src) {
    if (vpPlaying()) { vpAudio.pause(); vpStopRaf(); setVpPlaying(false); }
    else { vpAudio.play().catch(() => {}); setVpPlaying(true); vpStartRaf(); }
    return;
  }
  vpPlayInternal(src, sender, time);
}

function vpClose() {
  vpStopRaf();
  if (vpAudio) {
    vpAudio.pause();
    vpAudio.removeEventListener('loadedmetadata', vpOnMeta);
    vpAudio.removeEventListener('ended', vpOnEnd);
    vpAudio.src = '';
  }
  vpAudio = null;
  batch(() => { setVpSrc(null); setVpPlaying(false); setVpProgress(0); setVpCurrentTime(0); setVpDuration(0); });
}

function vpSeek(ratio: number) {
  if (vpAudio && vpDuration() > 0) vpAudio.currentTime = ratio * vpDuration();
}

function vpSeekRel(sec: number) {
  if (vpAudio) vpAudio.currentTime = Math.max(0, Math.min(vpDuration(), vpAudio.currentTime + sec));
}

function vpCycleSpeed() {
  const next = (vpSpeedIdx() + 1) % VOICE_SPEEDS.length;
  setVpSpeedIdx(next);
  if (vpAudio) vpAudio.playbackRate = VOICE_SPEEDS[next];
}

// ──────── Voice Message Player (bubble) ────────
const VoicePlayer: Component<{
  src: string; mine: boolean; msgId: string;
  voiceListens?: { userId: string }[];
  currentUserId?: string;
  senderName?: string; msgTime?: string;
}> = (props) => {
  const [waveform, setWaveform] = createSignal<number[]>(fallbackWaveform(props.src));
  const [sentListen, setSentListen] = createSignal(false);
  const [cachedDur, setCachedDur] = createSignal(0);

  onMount(() => {
    extractWaveform(props.src, WAVE_BARS).then((w) => {
      setWaveform(w);
      const d = voiceDurCache.get(props.src);
      if (d && d > 0) setCachedDur(d);
    }).catch(() => {});
  });

  const isActive = () => vpSrc() === props.src;
  const progress = () => isActive() ? vpProgress() : 0;
  const playing = () => isActive() && vpPlaying();
  const curTime = () => isActive() ? vpCurrentTime() : 0;
  const dur = () => isActive() ? (vpDuration() || cachedDur()) : cachedDur();

  const listened = () =>
    props.mine || !props.currentUserId
      ? true
      : (props.voiceListens ?? []).some(v => v.userId === props.currentUserId) || sentListen();

  createEffect(() => {
    if (playing() && !props.mine && !listened()) {
      wsStore.send({ event: 'message:listened', payload: { messageId: props.msgId } });
      setSentListen(true);
      const cid = chatStore.activeChatId();
      if (cid && props.currentUserId) {
        chatStore.markListened(cid, props.msgId, props.currentUserId);
      }
    }
  });

  function toggle() {
    vpPlay(props.src, props.senderName || '', props.msgTime || '');
  }

  function seekByClick(e: MouseEvent) {
    const wrap = e.currentTarget as HTMLElement;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (isActive()) vpSeek(ratio);
    else toggle();
  }

  const barClass = (idx: number) => {
    const played = (idx / WAVE_BARS) < progress();
    if (props.mine) {
      return played ? styles.waveBarPlayedMine : styles.waveBarMine;
    }
    if (played) return styles.waveBarPlayed;
    return listened() ? '' : styles.waveBarUnheard;
  };

  return (
    <div class={`${styles.voicePlayer} ${isActive() ? styles.voicePlayerActive : ''}`}>
      <button class={`${styles.voicePlayBtn} ${props.mine ? styles.voicePlayBtnMine : ''}`} onClick={toggle}>
        <Show when={playing()} fallback={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        }>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        </Show>
      </button>
      <div class={styles.voiceWaveWrap}>
        <div class={styles.voiceWaveBars} onClick={seekByClick}>
          <For each={waveform()}>{(h, i) =>
            <div
              class={`${styles.waveBarItem} ${barClass(i())}`}
              style={{ height: `${h * 100}%` }}
            />
          }</For>
        </div>
        <div class={styles.voiceTimeLine}>
          <span class={styles.voiceTime}>{playing() || curTime() > 0 ? fmtVoice(curTime()) : fmtVoice(dur())}</span>
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
  const [menuPortalPos, setMenuPortalPos] = createSignal({ top: 0, right: 0 });
  const [showScrollBtn, setShowScrollBtn] = createSignal(false);
  const [newMsgsBadge, setNewMsgsBadge] = createSignal(0);
  const [showUnreadBar, setShowUnreadBar] = createSignal(true);
  let _unreadBarTimer: ReturnType<typeof setTimeout> | null = null;
  // Per-chat scroll state — reset on every chat switch
  let _initialScrollDone = false;
  let _lastProcessedMsgId = '';
  const [showProfile, setShowProfile] = createSignal(false);
  const [showGroupProfile, setShowGroupProfile] = createSignal(false);
  const [lbMsgId, setLbMsgId] = createSignal<string | null>(null);
  let lbOriginRect: DOMRect | null = null;
  const [actionError, setActionError] = createSignal('');
  const [recording, setRecording] = createSignal(false);
  const [recordTimeMs, setRecordTimeMs] = createSignal(0);
  const [recWaveBars, setRecWaveBars] = createSignal<number[]>([]);
  let mediaRecorder: MediaRecorder | null = null;
  let recordChunks: Blob[] = [];
  let recordTimerInterval: ReturnType<typeof setInterval> | null = null;
  let recordStartTs = 0;
  let recordCancelled = false;
  let recAudioCtx: AudioContext | null = null;
  let recAnalyser: AnalyserNode | null = null;
  let recAnimFrame: number | null = null;

  let msgsRef!: HTMLDivElement;
  let bottomSentinelRef!: HTMLDivElement;
  let fileInputRef!: HTMLInputElement;
  let textareaRef!: HTMLTextAreaElement;
  let searchInputRef!: HTMLInputElement;
  let menuBtnRef!: HTMLButtonElement;
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
  const isMuted = () => mutedStore.isMuted(chatId() ?? '');
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
    vpPlaylist = all
      .filter(m => m.type === 'AUDIO' && m.mediaUrl)
      .map(m => ({ src: mediaUrl(m.mediaUrl)!, sender: displayName(m.sender), time: fmt(m.createdAt) }));
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
    setShowScrollBtn(scrollDist() > 300);
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
    if (textareaRef) textareaRef.style.height = 'auto';
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
  const [fwdSearch, setFwdSearch] = createSignal('');

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

  const filteredChatsForFwd = createMemo(() => {
    const q = fwdSearch().toLowerCase().trim();
    const all = chatStore.chats;
    if (!q) return all;
    return all.filter((c: Chat) => {
      const n = c.name ?? c.members?.filter((m) => m.user.id !== me()?.id).map((m) => displayName(m.user)).join(', ');
      return n?.toLowerCase().includes(q);
    });
  });

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

  function handleFileUpload(file: File) {
    const id = chatId();
    if (!id || !wsStore.connected()) return;
    if (chat()?.type === 'SECRET') {
      showActionError(i18n.t('msg.media_secret_blocked') || 'Media is not encrypted in secret chats');
      return;
    }

    const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const blobUrl = URL.createObjectURL(file);
    const fileType: PendingUpload['type'] =
      file.type.startsWith('image/') ? 'IMAGE' :
      file.type.startsWith('video/') ? 'VIDEO' :
      file.type.startsWith('audio/') ? 'AUDIO' : 'FILE';

    const [progress, setProgress] = createSignal(0);
    const reply = replyTo();
    setReplyTo(null);

    const { promise, abort } = api.uploadWithProgress(file, (pct) => {
      setProgress(pct);
    });

    setPendingUploads(prev => [...prev, { tempId, blobUrl, type: fileType, fileName: file.name, progress, setProgress, abort }]);
    setUploading(true);

    promise.then(res => {
      wsStore.send({
        event: 'message:send',
        payload: { chatId: id, text: null, mediaUrl: res.data.url, type: res.data.type,
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

  const REC_VIS_BARS = 32;

  function startRecAnalyser(stream: MediaStream) {
    recAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = recAudioCtx.createMediaStreamSource(stream);
    recAnalyser = recAudioCtx.createAnalyser();
    recAnalyser.fftSize = 256;
    recAnalyser.smoothingTimeConstant = 0.6;
    source.connect(recAnalyser);
    const dataArr = new Uint8Array(recAnalyser.frequencyBinCount);

    function tick() {
      if (!recAnalyser) return;
      recAnalyser.getByteFrequencyData(dataArr);
      const step = Math.max(1, Math.floor(dataArr.length / REC_VIS_BARS));
      const bars: number[] = [];
      for (let i = 0; i < REC_VIS_BARS; i++) {
        let sum = 0;
        for (let j = i * step; j < (i + 1) * step && j < dataArr.length; j++) {
          sum += dataArr[j];
        }
        bars.push(Math.max(0.06, (sum / step) / 255));
      }
      setRecWaveBars(bars);
      recAnimFrame = requestAnimationFrame(tick);
    }
    recAnimFrame = requestAnimationFrame(tick);
  }

  function stopRecAnalyser() {
    if (recAnimFrame != null) { cancelAnimationFrame(recAnimFrame); recAnimFrame = null; }
    if (recAudioCtx) { recAudioCtx.close().catch(() => {}); recAudioCtx = null; }
    recAnalyser = null;
    setRecWaveBars([]);
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
        stopRecAnalyser();
        if (recordCancelled || recordChunks.length === 0) return;
        const blob = new Blob(recordChunks, { type: mimeType });
        const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
        await handleFileUpload(file);
      };
      mediaRecorder.start(200);
      startRecAnalyser(stream);
      setRecording(true);
      recordStartTs = Date.now();
      setRecordTimeMs(0);
      recordTimerInterval = setInterval(() => setRecordTimeMs(Date.now() - recordStartTs), 50);
    } catch {
      showActionError(i18n.t('msg.mic_denied') || 'Microphone access denied');
    }
  }

  function stopRecording(send: boolean) {
    if (recordTimerInterval) { clearInterval(recordTimerInterval); recordTimerInterval = null; }
    setRecording(false);
    setRecordTimeMs(0);
    stopRecAnalyser();
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

  function toggleMute() {
    const id = chatId(); if (!id) return;
    mutedStore.toggle(id);
    closeHeaderMenu();
  }

  async function handleLeaveChat() {
    closeHeaderMenu();
    const id = chatId(); if (!id) return;
    try {
      await api.leaveChat(id);
      chatStore.removeChat(id);
    } catch { showActionError(i18n.t('error.generic') || 'Error'); }
  }

  // Direct chat "delete" uses the same leave API endpoint.
  const handleDeleteChat = handleLeaveChat;

  function typingLabel(): string {
    const id = chatId(); if (!id) return '';
    const others = (chatStore.typing[id] ?? []).filter((uid: string) => uid !== me()?.id);
    if (!others.length) return '';
    const c = chat();
    const tSingle = i18n.t('msg.typing_single');
    const tPlural = i18n.t('msg.typing_plural');
    if (c?.type === 'DIRECT' || c?.type === 'SECRET') {
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

  function groupReactions(msg: Message) {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of msg.reactions ?? []) {
      const e = map.get(r.emoji) ?? { count: 0, mine: false };
      map.set(r.emoji, { count: e.count + 1, mine: e.mine || r.userId === me()?.id });
    }
    return Array.from(map.entries()).map(([emoji, d]) => ({ emoji, ...d }));
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
    if (recordTimerInterval) clearInterval(recordTimerInterval);
    stopRecAnalyser();
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
            <button
              class={styles.hUserBtn}
              onClick={() => {
                if (chat()?.type === 'GROUP') setShowGroupProfile(true);
                else setShowProfile(true);
              }}
              title={i18n.t('msg.profile')}
            >
              <Show when={partner()} keyed>
                {(p) => (
                  <>
                    <div class={styles.hAvatar} style={!p.avatar ? { background: avatarColor(p.id) } : undefined}>
                      <Show when={p.avatar} fallback={<span>{displayName(p)[0]?.toUpperCase()}</span>}>
                        <img src={mediaUrl(p.avatar)} alt="" />
                      </Show>
                      <Show when={chatStore.onlineIds().has(p.id)}>
                        <div class={styles.hOnline} />
                      </Show>
                    </div>
                    <div>
                      <div class={styles.hName}>
                        <Show when={chat()?.type === 'SECRET'}>
                          <svg style="display:inline;vertical-align:-2px;margin-right:5px;color:#a78bfa" width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2.5"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                        </Show>
                        {displayName(p)}
                      </div>
                      <Show when={chat()?.type === 'SECRET'} fallback={
                        <div class={styles.hStatusWrap}>
                          <Show when={typingLabel()} fallback={
                            <>
                              <span class={`${styles.hStatusDot} ${chatStore.onlineIds().has(p.id) ? styles.hStatusDotOnline : ''}`} />
                              <span class={`${styles.hStatusText} ${chatStore.onlineIds().has(p.id) ? styles.hStatusTextOnline : ''}`}>
                                {chatStore.onlineIds().has(p.id) ? i18n.t('profile.online') : formatLastSeen(p.lastOnline)}
                              </span>
                            </>
                          }>
                            <span class={`${styles.hStatusText} ${styles.hStatusTyping}`}>{i18n.t('msg.typing_single')}</span>
                          </Show>
                        </div>
                      }>
                        <div class={styles.hSecretBadge}>{i18n.t('chat.secret_desc')}</div>
                      </Show>
                    </div>
                  </>
                )}
              </Show>
              <Show when={chat()?.type === 'GROUP'}>
                <div class={styles.hAvatar} style={!chat()?.avatar ? { background: avatarColor(chat()!.id) } : undefined}>
                  <Show when={chat()?.avatar} fallback={<span>{chat()?.name?.[0]?.toUpperCase() ?? 'Г'}</span>}>
                    <img src={mediaUrl(chat()!.avatar)} alt="" />
                  </Show>
                </div>
                <div>
                  <div class={styles.hName}>{chat()?.name ?? i18n.t('common.group')}</div>
                  <div class={styles.hStatus}>{chat()?.members.length ?? 0} {i18n.t('msg.members')}</div>
                </div>
              </Show>
            </button>

            <div class={styles.hActions}>
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
                title={i18n.t('common.more')}
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
                  <div class={`${styles.bubble} ${styles.mine}`}>
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
                        <div class={styles.uploadVoicePlayBtn}>
                          <svg class={styles.uploadVoicePlaySvg} viewBox="0 0 38 38" width="38" height="38">
                            <circle cx="19" cy="19" r="16" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
                            <circle class={styles.uploadArc} cx="19" cy="19" r="16" fill="none" stroke="#fff" stroke-width="2"
                              stroke-dasharray={`${2 * Math.PI * 16}`}
                              style={{ 'stroke-dashoffset': `${2 * Math.PI * 16 * (1 - pending.progress() / 100)}px` }}
                              stroke-linecap="round"
                              transform="rotate(-90 19 19)" />
                          </svg>
                          <button class={styles.uploadVoiceCancelInner} onClick={() => pending.abort()}>
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
              const reacted = () => groupReactions(msg);
              const isImageOnly = () => msg.type === 'IMAGE' && !!msg.mediaUrl && !msg.text;
              const openUnread = () => chatStore.openUnreadMap[chatId() ?? ''] ?? 0;
              // Divider goes ABOVE the first (oldest) unread message.
              // In column-reverse idx=0 is newest. The first unread is at
              // idx = openUnread - 1 in reversed order, so the divider
              // renders at idx === openUnread (between read and unread blocks).
              const shouldShowDivider = () => showUnreadBar() && openUnread() > 0 && idx() === openUnread();

              return (
                <>
                <Show when={shouldShowDivider()}>
                  <div class={styles.unreadDivider} data-unread-divider>
                    <div class={styles.unreadDividerLine} />
                    <span class={styles.unreadDividerPill}>{i18n.t('msg.unread_messages')}</span>
                    <div class={styles.unreadDividerLine} />
                  </div>
                </Show>
                <div class={`${mine() ? styles.rowMine : styles.rowTheirs} ${g().withBelow ? styles.rowGrouped : ''} ${menuMsgId() === msg.id ? styles.msgActive : ''}`} data-msg-id={msg.id}>
                  <Show when={!mine()}>
                    <div class={styles.avatarSlot}>
                      <Show when={g().showAvatar}>
                        <div class={styles.msgAvatar} style={!msg.sender?.avatar ? { background: avatarColor(msg.sender?.id ?? '') } : undefined}>
                          <Show when={msg.sender?.avatar} fallback={
                            <span>{msg.sender?.nickname?.[0]?.toUpperCase() ?? '?'}</span>
                          }>
                            <img src={mediaUrl(msg.sender!.avatar)} alt="" />
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <div class={styles.bubbleWrap}>
                    <Show when={msg.replyTo}>
                      <div
                        class={mine() ? styles.replyQuoteMine : styles.replyQuoteTheirs}
                        style="cursor:pointer"
                        onClick={(e) => { e.stopPropagation(); if (msg.replyToId) scrollToMessage(msg.replyToId); }}
                      >
                        <span class={styles.replyQuoteSender}>
                          {msg.replyTo!.isDeleted ? i18n.t('common.deleted') : msg.replyTo!.sender?.nickname}
                        </span>
                        <span class={styles.replyQuoteText}>
                          {msg.replyTo!.isDeleted ? i18n.t('common.msg_deleted') : (msg.replyTo!.text ?? i18n.t('common.media'))}
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
                        const bubble = e.currentTarget as HTMLElement;
                        const rect = bubble.getBoundingClientRect();
                        const menuW = 200, menuH = 280;
                        let x: number, y: number;
                        if (mine()) {
                          x = Math.max(8, rect.left - menuW - 8);
                          if (x < 8) x = rect.right + 8;
                        } else {
                          x = rect.right + 8;
                          if (x + menuW > window.innerWidth - 8) x = rect.left - menuW - 8;
                        }
                        x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
                        y = rect.top;
                        if (y + menuH > window.innerHeight - 8) y = window.innerHeight - menuH - 8;
                        if (y < 8) y = 8;
                        setMenuPos({ x, y });
                        setMenuMsgId(msg.id);
                      }}
                    >
                      <Show when={!mine() && chat()?.type === 'GROUP' && !g().withAbove}>
                        <div class={styles.senderName}>{displayName(msg.sender)}</div>
                      </Show>

                      <Show when={msg.forwardSenderName}>
                        <div class={styles.forwardLabel}>
                          ↗ {i18n.t('msg.forward_from')} <span>{msg.forwardSenderName}</span>
                        </div>
                      </Show>

                      <Show when={msg.isDeleted}>
                        <span class={styles.deletedText}>{i18n.t('msg.deleted')}</span>
                      </Show>
                      <Show when={!msg.isDeleted}>
                        <Show when={msg.type === 'IMAGE' && msg.mediaUrl}>
                          {(() => {
                            const [imgLoaded, setImgLoaded] = createSignal(false);
                            return (
                          <div
                            class={styles.mediaImgWrap}
                            onClick={(e) => { e.stopPropagation(); openLightbox(msg.id, e.currentTarget as HTMLElement); }}
                          >
                            <div class={`${styles.mediaImgSkeleton} ${imgLoaded() ? styles.mediaImgLoaded : ''}`} />
                            <img class={`${styles.mediaImg} ${imgLoaded() ? styles.mediaImgVisible : ''}`} src={mediaMediumUrl(msg.mediaUrl)} alt="" loading="lazy" onLoad={() => setImgLoaded(true)} onError={(e) => { const t = e.currentTarget; if (!t.dataset.fell) { t.dataset.fell = '1'; t.src = mediaUrl(msg.mediaUrl)!; } else { setImgLoaded(true); } }} />
                            {/* Time overlay on image, style */}
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
                            );
                          })()}
                        </Show>
                        <Show when={msg.type === 'VIDEO' && msg.mediaUrl}>
                          <video class={styles.mediaVideo} src={mediaUrl(msg.mediaUrl)} controls />
                        </Show>
                        <Show when={msg.type === 'AUDIO' && msg.mediaUrl}>
                          <VoicePlayer src={mediaUrl(msg.mediaUrl)} mine={mine()} msgId={msg.id} voiceListens={msg.voiceListens} currentUserId={me()?.id} senderName={displayName(msg.sender)} msgTime={fmt(msg.createdAt)} />
                        </Show>
                        <Show when={msg.type === 'FILE' && msg.mediaUrl}>
                          <a class={styles.mediaFile} href={mediaUrl(msg.mediaUrl)} target="_blank" rel="noreferrer">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/></svg>
                            <div class={styles.mediaFileInfo}>
                              <span class={styles.mediaFileName}>{msg.mediaName ?? i18n.t('common.download_file')}</span>
                              <Show when={msg.mediaSize}>
                                <span class={styles.mediaFileSize}>
                                  {msg.mediaSize! < 1024 ? `${msg.mediaSize} B`
                                    : msg.mediaSize! < 1048576 ? `${(msg.mediaSize! / 1024).toFixed(1)} KB`
                                    : `${(msg.mediaSize! / 1048576).toFixed(1)} MB`}
                                </span>
                              </Show>
                            </div>
                          </a>
                        </Show>
                        <Show when={msg.text}>
                          <span class={styles.msgText}>{msg.text}</span>
                        </Show>
                        <Show when={!msg.text && msg.ciphertext}>
                          {(() => {
                            const dt = () => e2eStore.decryptedTexts[msg.id];
                            return (
                              <Show
                                when={dt()}
                                fallback={<span class={styles.encryptedText}>🔒 {i18n.t('msg.encrypted')}</span>}
                              >
                                {(text) => <span class={styles.msgText}>{text()}</span>}
                              </Show>
                            );
                          })()}
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

                  </div>
                </div>
                <Show when={shouldShowDateSep(idx())}>
                  <div class={styles.dateSeparator}>
                    <span class={styles.dateSeparatorPill}>{dateLabelFor(msg.createdAt)}</span>
                  </div>
                </Show>
                </>
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

        {/* Reply bar */}
        <Show when={replyTo()}>
          <div class={styles.replyBar}>
            <div class={styles.replyBarAccent} />
            <div class={styles.replyBarContent}>
              <span class={styles.replyBarSender}>{replyTo()!.sender?.nickname}</span>
              <span class={styles.replyBarText}>
                {replyTo()!.text ?? e2eStore.getDecryptedText(replyTo()!.id) ?? i18n.t('common.media')}
              </span>
            </div>
            <button class={styles.replyBarClose} onClick={() => setReplyTo(null)}>✕</button>
          </div>
        </Show>

        {/* Action error toast */}
        <Show when={actionError()}>
          <div class={styles.actionError}>{actionError()}</div>
        </Show>

        {/* Input */}
        <Show when={partner()?.blockedByThem}>
          <div class={styles.blockedBanner}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="currentColor" stroke-width="2"/></svg>
            {i18n.t('msg.blocked_by_user')}
          </div>
        </Show>
        <Show when={!partner()?.blockedByThem}>
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
          <form class={styles.inputRow} onSubmit={handleSend} style={{ display: recording() ? 'none' : undefined }}>
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
          <Show when={recording()}>
            <div class={styles.recRow}>
              <button class={styles.btnRecCancel} type="button" onClick={() => stopRecording(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
              </button>
              <div class={styles.recCenter}>
                <div class={styles.recWaveform}>
                  <For each={recWaveBars()}>{(h) =>
                    <div class={styles.recWaveBar} style={{ height: `${Math.max(4, h * 100)}%` }} />
                  }</For>
                </div>
              </div>
              <div class={styles.recTimerPill}>
                <span class={styles.recDot} />
                <span class={styles.recTimerText}>{fmtRecTime(recordTimeMs())}</span>
              </div>
              <button class={styles.btnRecSend} type="button" onClick={() => stopRecording(true)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </Show>
        </Show>
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
            <Show when={chat()?.type === 'DIRECT' || chat()?.type === 'SECRET'}>
              <button onClick={() => { setShowProfile(true); closeHeaderMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>
                {i18n.t('msg.profile')}
              </button>
            </Show>
            <div class={styles.headerMenuDivider} />
            <Show when={chat()?.type === 'GROUP'}>
              <button onClick={() => { setShowGroupProfile(true); closeHeaderMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                {i18n.t('grp.title')}
              </button>
              <button onClick={handleLeaveChat}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                {i18n.t('msg.leave_group')}
              </button>
            </Show>
            <Show when={chat()?.type === 'DIRECT' || chat()?.type === 'SECRET'}>
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
            class={styles.ctxOverlay}
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
                  <Show when={!msg.isDeleted}>
                    <div class={styles.msgCtxReactions}>
                      <For each={ALLOWED_REACTIONS}>
                        {(emoji) => (
                          <button class={styles.msgCtxReactionBtn} onClick={() => { setMenuMsgId(null); handleReaction(msg.id, emoji); }}>
                            {emoji}
                          </button>
                        )}
                      </For>
                    </div>
                    <div class={styles.msgCtxDivider} />
                  </Show>
                  <button onClick={() => { setMenuMsgId(null); setReplyTo(msg); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-7a4 4 0 00-4-4H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    {i18n.t('msg.reply')}
                  </button>
                  <Show when={!msg.isDeleted}>
                    <button onClick={() => { setMenuMsgId(null); setForwardMsg(msg); setFwdSearch(''); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M15 14L20 9l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20v-7a4 4 0 014-4h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.forward')}
                    </button>
                  </Show>
                  <button onClick={() => { setMenuMsgId(null); navigator.clipboard?.writeText(msg.text ?? e2eStore.getDecryptedText(msg.id) ?? ''); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>
                    {i18n.t('msg.copy')}
                  </button>
                  <Show when={!msg.isDeleted}>
                    <button onClick={() => {
                      setMenuMsgId(null);
                      const isPinned = chat()?.pinnedMessageId === msg.id;
                      api.pinMessage(chatId()!, isPinned ? null : msg.id).catch(() => {});
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2v8m0 0l-3-3m3 3l3-3M12 18v4m-4-4h8l-1-4H9l-1 4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {chat()?.pinnedMessageId === msg.id ? i18n.t('msg.unpin') : i18n.t('msg.pin')}
                    </button>
                  </Show>
                  <Show when={isMine && !msg.isDeleted}>
                    <button onClick={() => {
                      setMenuMsgId(null);
                      setEditingId(msg.id);
                      setEditText(msg.text ?? e2eStore.getDecryptedText(msg.id) ?? '');
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {i18n.t('msg.edit')}
                    </button>
                  </Show>
                  <div class={styles.msgCtxDivider} />
                  <button class={styles.msgCtxDanger} onClick={() => { setMenuMsgId(null); setDeleteModalId(msg.id); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    {i18n.t('msg.delete')}
                  </button>
                </>
              );
            })()}
          </div>
        </Portal>
      </Show>

      {/* Forward modal */}
      <Show when={forwardMsg()}>
        <Portal>
          <div class={styles.modalOverlay} onClick={() => setForwardMsg(null)}>
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
                      const chatName = () => c.name ?? c.members?.filter((m) => m.user.id !== me()?.id).map((m) => displayName(m.user)).join(', ') ?? '';
                      const avatar = () => c.avatar ?? c.members?.find((m) => m.user.id !== me()?.id)?.user?.avatar;
                      const initial = () => chatName()?.[0]?.toUpperCase() ?? '?';
                      return (
                        <div class={styles.modalChatItem} onClick={() => handleForwardTo(c.id, forwardMsg()!)}>
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
                <button onClick={() => setForwardMsg(null)}>{i18n.t('sidebar.cancel')}</button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      {/* Delete confirmation modal */}
      <Show when={deleteModalId()}>
        <Portal>
          <div class={styles.modalOverlay} onClick={() => setDeleteModalId(null)}>
            <div class={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div class={styles.modalHeader}>{i18n.t('msg.delete')}</div>
              <div class={styles.modalActions}>
                {(() => {
                  const msgId = deleteModalId()!;
                  const msg = (chatStore.messages[chatId()!] ?? []).find((m) => m.id === msgId);
                  const isMine = msg?.sender?.id === me()?.id;
                  return (
                    <>
                      <Show when={isMine}>
                        <button class={styles.msgCtxDanger} onClick={() => handleDelete(msgId, true)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                          {i18n.t('msg.delete_for_all')}
                        </button>
                      </Show>
                      <button onClick={() => handleDelete(msgId, false)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                        {i18n.t('msg.delete_for_me')}
                      </button>
                    </>
                  );
                })()}
              </div>
              <div class={styles.modalCancel}>
                <button onClick={() => setDeleteModalId(null)}>{i18n.t('sidebar.cancel')}</button>
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
