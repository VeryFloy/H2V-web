import {
  type Component, createSignal, createEffect, For, Show,
  onMount, batch,
} from 'solid-js';
import { chatStore } from '../../stores/chat.store';
import { wsStore } from '../../stores/ws.store';
import { uiStore } from '../../stores/ui.store';
import { settingsStore } from '../../stores/settings.store';
import { mediaUrl, mediaMediumUrl, mediaThumbUrl, api } from '../../api/client';
import { displayName } from '../../utils/format';
import { avatarColor } from '../../utils/avatar';
import { e2eStore } from '../../stores/e2e.store';
import { i18n } from '../../stores/i18n.store';
import { WAVE_BARS, fallbackWaveform, extractWaveform, getCachedDuration } from '../../utils/waveform';
import LinkPreview from '../ui/LinkPreview';
import VideoPlayer from './VideoPlayer';
import styles from './MessageBubble.module.css';
import type { Message } from '../../types';

export { fallbackWaveform };

// ──────── Voice time formatter ────────
export function fmtVoice(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ──────── Shared voice player state ────────
export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export const [vpSrc, setVpSrc] = createSignal<string | null>(null);
export const [vpPlaying, setVpPlaying] = createSignal(false);
export const [vpProgress, setVpProgress] = createSignal(0);
const [vpDuration, setVpDuration] = createSignal(0);
export const [vpCurrentTime, setVpCurrentTime] = createSignal(0);
export const [vpSpeedIdx, setVpSpeedIdx] = createSignal(settingsStore.settings().voiceSpeed ?? 0);
export const [vpSender, setVpSender] = createSignal('');
export const [vpMsgTime, setVpMsgTime] = createSignal('');
let vpAudio: HTMLAudioElement | null = null;
let vpRaf: number | null = null;
let vpPlaylist: { src: string; sender: string; time: string }[] = [];

export function setVpPlaylist(list: { src: string; sender: string; time: string }[]) {
  vpPlaylist = list;
}

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

export function vpPlay(src: string, sender: string, time: string) {
  if (vpAudio && vpSrc() === src) {
    if (vpPlaying()) { vpAudio.pause(); vpStopRaf(); setVpPlaying(false); }
    else { vpAudio.play().catch(() => {}); setVpPlaying(true); vpStartRaf(); }
    return;
  }
  vpPlayInternal(src, sender, time);
}

export function vpClose() {
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

export function vpSeekRel(sec: number) {
  if (vpAudio) vpAudio.currentTime = Math.max(0, Math.min(vpDuration(), vpAudio.currentTime + sec));
}

export function vpCycleSpeed() {
  const next = ((vpSpeedIdx() + 1) % VOICE_SPEEDS.length) as 0 | 1 | 2;
  setVpSpeedIdx(next);
  if (vpAudio) vpAudio.playbackRate = VOICE_SPEEDS[next];
  settingsStore.updateSettings({ voiceSpeed: next });
}

// ──────── Rich text: formatting, URLs, @mentions, blockquotes ────────
type PartType = 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'codeblock' | 'spoiler' | 'link' | 'mention' | 'blockquote';
interface RichPart { type: PartType; value: string; lang?: string }

const CODEBLOCK_RE = /```(\w*)\n?([\s\S]*?)```/g;
const INLINE_RE = /`([^`\n]+)`|\*\*(.+?)\*\*|\*([^*\n]+?)\*|~~(.+?)~~|\|\|([^|]+?)\|\||(https?:\/\/[^\s<>"{}|\\^`[\]]+)|(@[a-zA-Z0-9_.]{2,30})/g;

function isSafeUrl(url: string): boolean {
  try { const u = url.trim().toLowerCase(); return u.startsWith('http://') || u.startsWith('https://'); } catch { return false; }
}

function parseInline(text: string): RichPart[] {
  const result: RichPart[] = [];
  let lastIdx = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) result.push({ type: 'text', value: text.slice(lastIdx, m.index) });
    if (m[1] !== undefined) result.push({ type: 'code', value: m[1] });
    else if (m[2] !== undefined) result.push({ type: 'bold', value: m[2] });
    else if (m[3] !== undefined) result.push({ type: 'italic', value: m[3] });
    else if (m[4] !== undefined) result.push({ type: 'strike', value: m[4] });
    else if (m[5] !== undefined) result.push({ type: 'spoiler', value: m[5] });
    else if (m[0].startsWith('http')) result.push(isSafeUrl(m[0]) ? { type: 'link', value: m[0] } : { type: 'text', value: m[0] });
    else if (m[0].startsWith('@')) result.push({ type: 'mention', value: m[0].slice(1) });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) result.push({ type: 'text', value: text.slice(lastIdx) });
  return result;
}

function parseBlocksAndInline(text: string): RichPart[] {
  const result: RichPart[] = [];
  const lines = text.split('\n');
  let quoteLines: string[] = [];
  let textLines: string[] = [];
  const flushText = () => { if (textLines.length > 0) { result.push(...parseInline(textLines.join('\n'))); textLines = []; } };
  const flushQuote = () => { if (quoteLines.length > 0) { result.push({ type: 'blockquote', value: quoteLines.join('\n') }); quoteLines = []; } };
  for (const line of lines) {
    if (line.startsWith('> ')) { flushText(); quoteLines.push(line.slice(2)); }
    else { flushQuote(); textLines.push(line); }
  }
  flushText(); flushQuote();
  return result;
}

function parseRich(text: string): RichPart[] {
  const result: RichPart[] = [];
  let lastIdx = 0;
  const re = new RegExp(CODEBLOCK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) result.push(...parseBlocksAndInline(text.slice(lastIdx, m.index)));
    result.push({ type: 'codeblock', value: m[2].trimEnd(), lang: m[1] || undefined });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) result.push(...parseBlocksAndInline(text.slice(lastIdx)));
  return result;
}

function handleMentionClick(nickname: string) {
  const chat = chatStore.activeChat();
  if (chat) {
    const member = chat.members.find((m) => m.user.nickname?.toLowerCase() === nickname.toLowerCase());
    if (member) { chatStore.startDirectChat(member.user.id).then(() => uiStore.openUserProfile(member.user.id)).catch(() => {}); return; }
  }
  api.searchUsers(nickname).then((r) => {
    const found = r.data?.find((u: any) => u.nickname?.toLowerCase() === nickname.toLowerCase());
    if (found) chatStore.startDirectChat(found.id).then(() => uiStore.openUserProfile(found.id)).catch(() => {});
  }).catch(() => {});
}

function SpoilerText(props: { text: string }) {
  const [revealed, setRevealed] = createSignal(false);
  return (
    <span
      class={`${styles.fmtSpoiler} ${revealed() ? styles.fmtSpoilerRevealed : ''}`}
      onClick={(e) => { e.stopPropagation(); setRevealed(!revealed()); }}
    >{props.text}</span>
  );
}

function RichText(props: { text: string }) {
  const parts = () => parseRich(props.text);
  return (
    <For each={parts()}>
      {(p) => {
        switch (p.type) {
          case 'bold': return <strong class={styles.fmtBold}>{p.value}</strong>;
          case 'italic': return <em class={styles.fmtItalic}>{p.value}</em>;
          case 'strike': return <s class={styles.fmtStrike}>{p.value}</s>;
          case 'code': return <code class={styles.fmtCode}>{p.value}</code>;
          case 'codeblock': return <pre class={styles.fmtCodeblock}><code>{p.value}</code></pre>;
          case 'spoiler': return <SpoilerText text={p.value} />;
          case 'blockquote': {
            const lines = p.value.split('\n');
            const lastLine = lines[lines.length - 1];
            const authorMatch = lastLine?.match(/^— @(\S+)$/);
            const quoteText = authorMatch ? lines.slice(0, -1).join('\n') : p.value;
            return (
              <blockquote class={styles.fmtBlockquote}>
                <RichText text={quoteText} />
                <Show when={authorMatch}>
                  <span class={styles.fmtQuoteAuthor}>— <span class={styles.mention} onClick={(e) => { e.stopPropagation(); handleMentionClick(authorMatch![1]); }}>@{authorMatch![1]}</span></span>
                </Show>
              </blockquote>
            );
          }
          case 'link': return <a href={p.value} target="_blank" rel="noopener noreferrer" class={styles.inlineLink}>{p.value}</a>;
          case 'mention': return <span class={styles.mention} onClick={(e) => { e.stopPropagation(); handleMentionClick(p.value); }}>@{p.value}</span>;
          default: return <>{p.value}</>;
        }
      }}
    </For>
  );
}

// ──────── Helpers ────────
function groupReactions(msg: Message, myId?: string) {
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of msg.reactions ?? []) {
    const e = map.get(r.emoji) ?? { count: 0, mine: false };
    map.set(r.emoji, { count: e.count + 1, mine: e.mine || r.userId === myId });
  }
  return Array.from(map.entries()).map(([emoji, d]) => ({ emoji, ...d }));
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
      const d = getCachedDuration(props.src);
      if (d > 0) setCachedDur(d);
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

// ──────── Message Bubble ────────
export interface MessageBubbleProps {
  msg: Message;
  mine: boolean;
  grouping: { withBelow: boolean; withAbove: boolean; showAvatar: boolean };
  shouldShowDivider: boolean;
  shouldShowDate: boolean;
  dateLabel: string;
  isActive: boolean;
  chatType: string;
  currentUserId?: string;
  onContextMenu: (msgId: string, pos: { x: number; y: number }) => void;
  onScrollToMessage: (msgId: string) => void;
  onReaction: (msgId: string, emoji: string) => void;
  onOpenLightbox: (msgId: string, el?: HTMLElement) => void;
  fmt: (iso: string) => string;
  isRead: (msg: Message) => boolean;
  isDelivered: (msg: Message) => boolean;
  isPending: (msg: Message) => boolean;
  isFailed?: (msg: Message) => boolean;
  onRetry?: (msg: Message) => void;
  onReply?: (msg: Message) => void;
  isSelected?: boolean;
  selectionActive?: boolean;
  onSelect?: (msgId: string) => void;
  isDeleting?: boolean;
  onShowReadBy?: (msg: Message, rect: DOMRect) => void;
}

const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const msg = props.msg;
  const reacted = () => groupReactions(msg, props.currentUserId);
  const isImageOnly = () => msg.type === 'IMAGE' && !!msg.mediaUrl && !msg.text;
  const isVideoOnly = () => msg.type === 'VIDEO' && !!msg.mediaUrl && !msg.text;
  const isMediaOnly = () => isImageOnly() || isVideoOnly();
  const isEncryptedMedia = () => !!msg.ciphertext && !!msg.mediaUrl && msg.type !== 'TEXT';
  const [decMediaLoading, setDecMediaLoading] = createSignal(false);

  const resolvedMediaUrl = () => {
    if (!isEncryptedMedia()) return msg.mediaUrl ? mediaUrl(msg.mediaUrl) : null;
    const cached = e2eStore.getDecryptedMediaUrl(msg.id);
    if (cached) return cached;
    if (!decMediaLoading()) {
      setDecMediaLoading(true);
      const senderId = msg.sender?.id ?? '';
      e2eStore.decryptMediaMessage(msg.id, senderId, msg.ciphertext!, msg.signalType ?? 3, mediaUrl(msg.mediaUrl)!).finally(() => setDecMediaLoading(false));
    }
    return null;
  };

  const isMobile = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  function handleRowDblClick(e: MouseEvent) {
    if (msg.isDeleted) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    props.onReply?.(msg);
  }

  // ── Swipe left to reply + long-press context menu (mobile) ──
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeActive = false;
  let swipeLocked = false;
  let swipeRow: HTMLElement | null = null;
  let swipeIcon: HTMLElement | null = null;
  const SWIPE_THRESHOLD = 60;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;

  function clearLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  function onSwipeStart(e: TouchEvent) {
    longPressFired = false;
    if (msg.isDeleted) return;

    if (props.selectionActive && props.onSelect) {
      e.preventDefault();
      props.onSelect(msg.id);
      return;
    }

    const t = e.touches[0];
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    swipeActive = true;
    swipeLocked = false;
    swipeRow = e.currentTarget as HTMLElement;
    const wrap = swipeRow.closest('[data-msg-id]') as HTMLElement | null;
    swipeIcon = wrap?.querySelector('[data-swipe-icon]') as HTMLElement | null;

    clearLongPress();
    const touchX = t.clientX;
    const touchY = t.clientY;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      swipeActive = false;
      resetSwipe();
      try { navigator.vibrate?.(20); } catch {}
      const bubble = (e.currentTarget as HTMLElement).querySelector('[class*="bubble"]') as HTMLElement | null;
      const rect = bubble?.getBoundingClientRect() ?? { left: touchX, right: touchX, top: touchY };
      const menuW = 200, menuH = 280;
      let x = touchX - menuW / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
      let y = (rect as DOMRect).top ?? touchY;
      if (y + menuH > window.innerHeight - 8) y = window.innerHeight - menuH - 8;
      if (y < 60) y = 60;
      props.onContextMenu(msg.id, { x: Math.max(8, x), y });
    }, 500);
  }

  function onSwipeMove(e: TouchEvent) {
    if (longPressFired) return;
    if (!swipeActive || !swipeRow) return;
    const t = e.touches[0];
    const dx = swipeStartX - t.clientX;
    const dy = Math.abs(t.clientY - swipeStartY);

    if (Math.abs(dx) > 8 || dy > 8) clearLongPress();

    if (!swipeLocked && dy > 30) { resetSwipe(); return; }

    if (dx > 10) {
      swipeLocked = true;
      e.preventDefault();
      const offset = Math.min(dx, SWIPE_THRESHOLD + 30);
      swipeRow.style.transform = `translateX(-${offset}px)`;
      swipeRow.style.transition = 'none';
      if (swipeIcon) {
        const progress = Math.min(offset / SWIPE_THRESHOLD, 1);
        swipeIcon.style.opacity = String(progress);
        swipeIcon.style.transform = `translateY(-50%) scale(${0.5 + progress * 0.5})`;
      }
    }
  }

  function onSwipeEnd() {
    clearLongPress();
    if (longPressFired) { longPressFired = false; return; }
    if (!swipeActive || !swipeRow) return;
    const row = swipeRow;
    const icon = swipeIcon;
    const transform = row.style.transform;
    const match = transform.match(/translateX\(-(\d+(?:\.\d+)?)px\)/);
    const offset = match ? parseFloat(match[1]) : 0;

    row.style.transition = 'transform 0.2s ease';
    row.style.transform = '';
    if (icon) {
      icon.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      icon.style.opacity = '0';
      icon.style.transform = 'translateY(-50%) scale(0.5)';
    }
    swipeActive = false;
    swipeLocked = false;
    swipeRow = null;
    swipeIcon = null;

    if (offset >= SWIPE_THRESHOLD && props.onReply) {
      try { navigator.vibrate?.(15); } catch {}
      props.onReply(msg);
    }
  }

  function resetSwipe() {
    clearLongPress();
    if (swipeRow) {
      swipeRow.style.transition = 'transform 0.2s ease';
      swipeRow.style.transform = '';
    }
    if (swipeIcon) {
      swipeIcon.style.transition = 'opacity 0.2s ease';
      swipeIcon.style.opacity = '0';
    }
    swipeActive = false;
    swipeLocked = false;
    swipeRow = null;
    swipeIcon = null;
  }

  function handleContextMenu(e: MouseEvent & { currentTarget: HTMLElement }) {
    if (msg.isDeleted) return;
    e.preventDefault(); e.stopPropagation();
    try { navigator.vibrate?.(10); } catch {}
    const bubble = e.currentTarget;
    const rect = bubble.getBoundingClientRect();
    const menuW = 200, menuH = 280;
    let x: number, y: number;
    if (props.mine) {
      x = Math.max(8, rect.left - menuW - 8);
      if (x < 8) x = rect.right + 8;
    } else {
      x = rect.right + 8;
      if (x + menuW > window.innerWidth - 8) x = rect.left - menuW - 8;
    }
    x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
    y = rect.top;
    if (y + menuH > window.innerHeight - 8) y = window.innerHeight - menuH - 8;
    if (y < 60) y = 60;
    props.onContextMenu(msg.id, { x, y });
  }

  return (
    <>
    <Show when={props.shouldShowDate}>
      <div class={styles.dateSeparator}>
        <span class={styles.dateSeparatorPill}>{props.dateLabel}</span>
      </div>
    </Show>
    <Show when={props.shouldShowDivider}>
      <div class={styles.unreadDivider} data-unread-divider>
        <div class={styles.unreadDividerLine} />
        <span class={styles.unreadDividerPill}>{i18n.t('msg.unread_messages')}</span>
        <div class={styles.unreadDividerLine} />
      </div>
    </Show>
    <div class={`${styles.swipeWrap} ${props.isDeleting ? styles.msgDeleting : ''}`} data-msg-id={msg.id}>
      <div class={styles.swipeReplyIcon} data-swipe-icon>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M9 14l-4-4 4-4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 10h10a4 4 0 014 4v1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    <div
      class={`${props.mine ? styles.rowMine : styles.rowTheirs} ${props.grouping.withBelow ? styles.rowGrouped : ''} ${props.isActive ? styles.msgActive : ''} ${props.isSelected ? styles.rowSelected : ''}`}
      onDblClick={handleRowDblClick}
      onClick={(e) => { if (props.selectionActive) { e.preventDefault(); e.stopPropagation(); } }}
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      <Show when={props.selectionActive}>
        <div class={styles.selectCheckbox}>
          <div class={`${styles.selectCheck} ${props.isSelected ? styles.selectCheckActive : ''}`}>
            <Show when={props.isSelected}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={!props.mine}>
        <div class={styles.avatarSlot}>
          <Show when={props.grouping.showAvatar}>
            <div class={styles.msgAvatar} style={!msg.sender?.avatar ? { background: avatarColor(msg.sender?.id ?? '') } : undefined}>
              <Show when={msg.sender?.avatar} fallback={
                <span>{msg.sender?.nickname?.[0]?.toUpperCase() ?? '?'}</span>
              }>
                <img src={mediaUrl(msg.sender!.avatar)} alt="" loading="lazy" />
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      <div class={styles.bubbleWrap}>
        <Show when={msg.replyTo}>
          <div
            class={props.mine ? styles.replyQuoteMine : styles.replyQuoteTheirs}
            style="cursor:pointer"
            onClick={(e) => { e.stopPropagation(); if (msg.replyToId) props.onScrollToMessage(msg.replyToId); }}
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
            props.mine ? styles.bubbleMine : styles.bubbleTheirs,
            msg.isDeleted ? styles.bubbleDeleted : '',
            isMediaOnly() ? styles.bubbleImage : '',
            props.grouping.withAbove && props.mine  ? styles.bubbleMineTop   : '',
            props.grouping.withAbove && !props.mine ? styles.bubbleTheirsTop : '',
            props.grouping.withBelow && props.mine  ? styles.bubbleMineBot   : '',
            props.grouping.withBelow && !props.mine ? styles.bubbleTheirsBot : '',
            props.isSelected ? styles.bubbleSelected : '',
          ].filter(Boolean).join(' ')}
          onContextMenu={handleContextMenu}
        >
          <Show when={!props.mine && props.chatType === 'GROUP' && !props.grouping.withAbove}>
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
                const imgSrc = () => isEncryptedMedia() ? resolvedMediaUrl() : mediaMediumUrl(msg.mediaUrl);
                const thumbSrc = () => isEncryptedMedia() ? '' : mediaThumbUrl(msg.mediaUrl);
                return (
              <div
                class={styles.mediaImgWrap}
                onClick={(e) => { e.stopPropagation(); props.onOpenLightbox(msg.id, e.currentTarget as HTMLElement); }}
              >
                <div
                  class={`${styles.mediaImgSkeleton} ${imgLoaded() ? styles.mediaImgLoaded : ''}`}
                  style={thumbSrc() ? { 'background-image': `url(${thumbSrc()})`, 'background-size': 'cover', 'background-position': 'center', filter: 'blur(12px)', transform: 'scale(1.1)' } : undefined}
                />
                <Show when={imgSrc()} fallback={<div class={styles.mediaImgSkeleton} />}>
                  {(src) => <img class={`${styles.mediaImg} ${imgLoaded() ? styles.mediaImgVisible : ''}`} src={src()} alt="" loading="lazy" onLoad={() => setImgLoaded(true)} onError={(e) => { const t = e.currentTarget; if (!t.dataset.fell && !isEncryptedMedia()) { t.dataset.fell = '1'; t.src = mediaUrl(msg.mediaUrl)!; } else { setImgLoaded(true); } }} />}
                </Show>
                <Show when={isImageOnly()}>
                  <div class={styles.mediaImgOverlay}>
                    <Show when={msg.isEdited}><span class={styles.overlayEdited}>{i18n.t('msg.edited')}</span></Show>
                    <span class={styles.overlayTime}>{props.fmt(msg.createdAt)}</span>
                    <Show when={props.mine}>
                      <Show when={props.isFailed?.(msg)} fallback={
                        <span
                          class={`${styles.overlayTick} ${props.isPending(msg) ? styles.overlayTickPending : props.isRead(msg) ? styles.overlayTickRead : props.isDelivered(msg) ? styles.overlayTickDelivered : ''} ${props.chatType === 'GROUP' && props.isRead(msg) ? styles.tickClickable : ''}`}
                          onClick={(e) => {
                            if (props.chatType === 'GROUP' && props.isRead(msg) && props.onShowReadBy) {
                              e.stopPropagation();
                              props.onShowReadBy(msg, (e.currentTarget as HTMLElement).getBoundingClientRect());
                            }
                          }}
                        >
                          <Show when={props.isPending(msg)} fallback={
                            <Show when={props.isRead(msg) || props.isDelivered(msg)} fallback={
                              <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            }>
                              <svg width="20" height="11" viewBox="0 0 20 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L10.5 10L19.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            </Show>
                          }>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          </Show>
                        </span>
                      }>
                        <span class={`${styles.overlayTick} ${styles.overlayTickFailed}`} onClick={() => props.onRetry?.(msg)} title={i18n.t('msg.retry')}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
                        </span>
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>
                );
              })()}
            </Show>
            <Show when={msg.type === 'VIDEO' && msg.mediaUrl}>
              <div
                class={styles.mediaImgWrap}
                onClick={(e) => { e.stopPropagation(); props.onOpenLightbox(msg.id, e.currentTarget as HTMLElement); }}
              >
                <Show when={resolvedMediaUrl()} fallback={<div class={styles.mediaImgSkeleton} style={{ height: '180px' }} />}>
                  {(src) => {
                    const mediumSrc = () => isEncryptedMedia() ? src() : (mediaMediumUrl(msg.mediaUrl) || src());
                    return (
                      <>
                        <video
                          class={styles.mediaVideoInline}
                          src={mediumSrc()}
                          autoplay
                          muted
                          loop
                          playsinline
                          preload="metadata"
                          onError={(e) => {
                            const t = e.currentTarget;
                            if (!t.dataset.fell && mediumSrc() !== src()) {
                              t.dataset.fell = '1';
                              t.src = src();
                            }
                          }}
                        />
                      </>
                    );
                  }}
                </Show>
                <Show when={isVideoOnly()}>
                  <div class={styles.mediaImgOverlay}>
                    <Show when={msg.isEdited}><span class={styles.overlayEdited}>{i18n.t('msg.edited')}</span></Show>
                    <span class={styles.overlayTime}>{props.fmt(msg.createdAt)}</span>
                    <Show when={props.mine}>
                      <Show when={props.isFailed?.(msg)} fallback={
                        <span
                          class={`${styles.overlayTick} ${props.isPending(msg) ? styles.overlayTickPending : props.isRead(msg) ? styles.overlayTickRead : props.isDelivered(msg) ? styles.overlayTickDelivered : ''} ${props.chatType === 'GROUP' && props.isRead(msg) ? styles.tickClickable : ''}`}
                          onClick={(e) => {
                            if (props.chatType === 'GROUP' && props.isRead(msg) && props.onShowReadBy) {
                              e.stopPropagation();
                              props.onShowReadBy(msg, (e.currentTarget as HTMLElement).getBoundingClientRect());
                            }
                          }}
                        >
                          <Show when={props.isPending(msg)} fallback={
                            <Show when={props.isRead(msg) || props.isDelivered(msg)} fallback={
                              <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            }>
                              <svg width="20" height="11" viewBox="0 0 20 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L10.5 10L19.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            </Show>
                          }>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          </Show>
                        </span>
                      }>
                        <span class={`${styles.overlayTick} ${styles.overlayTickFailed}`} title={i18n.t('msg.retry')}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
                        </span>
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={msg.type === 'AUDIO' && msg.mediaUrl}>
              <Show when={resolvedMediaUrl()} fallback={<div class={styles.mediaImgSkeleton} style={{ height: '48px' }} />}>
                {(src) => <VoicePlayer src={src()} mine={props.mine} msgId={msg.id} voiceListens={msg.voiceListens} currentUserId={props.currentUserId} senderName={displayName(msg.sender)} msgTime={props.fmt(msg.createdAt)} />}
              </Show>
            </Show>
            <Show when={msg.type === 'FILE' && msg.mediaUrl}>
              <Show when={resolvedMediaUrl()} fallback={<div class={styles.mediaImgSkeleton} style={{ height: '48px' }} />}>
                {(src) => <a class={styles.mediaFile} href={src()} target="_blank" rel="noreferrer" download={msg.mediaName ?? undefined}>
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
              </a>}
              </Show>
            </Show>
            <Show when={msg.text}>
              <span class={styles.msgText}><RichText text={msg.text!} /></span>
              <Show when={/https?:\/\//.test(msg.text!)}>
                <LinkPreview text={msg.text!} />
              </Show>
            </Show>
            <Show when={!msg.text && msg.ciphertext}>
              {(() => {
                const dt = () => e2eStore.decryptedTexts[msg.id];
                return (
                  <Show
                    when={dt()}
                    fallback={<span class={styles.encryptedText}>🔒 {i18n.t('msg.encrypted')}</span>}
                  >
                    {(text) => (
                      <>
                        <span class={styles.msgText}><RichText text={text()} /></span>
                        <Show when={/https?:\/\//.test(text())}>
                          <LinkPreview text={text()} />
                        </Show>
                      </>
                    )}
                  </Show>
                );
              })()}
            </Show>
            <Show when={!isMediaOnly()}>
              <div class={styles.meta}>
                <Show when={msg.isEdited}><span class={styles.edited}>{i18n.t('msg.edited')}</span></Show>
                <span class={styles.time}>{props.fmt(msg.createdAt)}</span>
                <Show when={props.mine}>
                  <Show when={props.isFailed?.(msg)} fallback={
                    <span
                      class={`${styles.tick} ${props.isPending(msg) ? styles.tickPending : props.isRead(msg) ? styles.tickRead : props.isDelivered(msg) ? styles.tickDelivered : ''} ${props.chatType === 'GROUP' && props.isRead(msg) ? styles.tickClickable : ''}`}
                      onClick={(e) => {
                        if (props.chatType === 'GROUP' && props.isRead(msg) && props.onShowReadBy) {
                          e.stopPropagation();
                          props.onShowReadBy(msg, (e.currentTarget as HTMLElement).getBoundingClientRect());
                        }
                      }}
                    >
                      <Show when={props.isPending(msg)} fallback={
                        <Show when={props.isRead(msg) || props.isDelivered(msg)} fallback={
                          <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        }>
                          <svg width="20" height="11" viewBox="0 0 20 11" fill="none"><path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5.5L10.5 10L19.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </Show>
                      }>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      </Show>
                    </span>
                  }>
                    <span class={`${styles.tick} ${styles.tickFailed}`} onClick={() => props.onRetry?.(msg)} title={i18n.t('msg.retry')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
                    </span>
                  </Show>
                </Show>
              </div>
            </Show>
          </Show>

          <Show when={!msg.isDeleted && reacted().length > 0}>
            <div class={styles.reactionsRow}>
              <For each={reacted()}>
                {(r) => (
                  <button class={`${styles.reactionChip} ${r.mine ? styles.reactionMine : ''}`}
                    onClick={(e) => { e.stopPropagation(); props.onReaction(msg.id, r.emoji); }}>
                    <span class={styles.reactionEmoji}>{r.emoji}</span>
                    <Show when={r.count > 1}>
                      <span class={styles.reactionCount}>{r.count}</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

      </div>
    </div>
    </div>
    </>
  );
};

export default MessageBubble;
