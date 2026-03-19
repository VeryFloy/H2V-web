import {
  type Component, createSignal, createEffect, For, Show,
  onMount, batch,
} from 'solid-js';
import { chatStore } from '../../stores/chat.store';
import { wsStore } from '../../stores/ws.store';
import { uiStore } from '../../stores/ui.store';
import { mediaUrl, mediaMediumUrl, api } from '../../api/client';
import { displayName } from '../../utils/format';
import { avatarColor } from '../../utils/avatar';
import { e2eStore } from '../../stores/e2e.store';
import { i18n } from '../../stores/i18n.store';
import { WAVE_BARS, fallbackWaveform, extractWaveform, getCachedDuration } from '../../utils/waveform';
import LinkPreview from '../ui/LinkPreview';
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
export const [vpSpeedIdx, setVpSpeedIdx] = createSignal(0);
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
  const next = (vpSpeedIdx() + 1) % VOICE_SPEEDS.length;
  setVpSpeedIdx(next);
  if (vpAudio) vpAudio.playbackRate = VOICE_SPEEDS[next];
}

// ──────── Rich text: auto-link URLs + @mentions ────────
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
const RICH_RE = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)|(@[a-zA-Z0-9_.]{2,30})/g;

function isSafeUrl(url: string): boolean {
  try {
    const u = url.trim().toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://');
  } catch {
    return false;
  }
}

function handleMentionClick(nickname: string) {
  const chat = chatStore.activeChat();
  if (chat) {
    const member = chat.members.find(
      (m) => m.user.nickname?.toLowerCase() === nickname.toLowerCase(),
    );
    if (member) {
      chatStore.startDirectChat(member.user.id).then(() => {
        uiStore.openUserProfile(member.user.id);
      }).catch(() => {});
      return;
    }
  }
  api.searchUsers(nickname).then((r) => {
    const found = r.data?.find(
      (u: any) => u.nickname?.toLowerCase() === nickname.toLowerCase(),
    );
    if (found) {
      chatStore.startDirectChat(found.id).then(() => {
        uiStore.openUserProfile(found.id);
      }).catch(() => {});
    }
  }).catch(() => {});
}

function RichText(props: { text: string }) {
  const parts = () => {
    const t = props.text;
    const result: { type: 'text' | 'link' | 'mention'; value: string }[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    const re = new RegExp(RICH_RE.source, 'g');
    while ((m = re.exec(t)) !== null) {
      if (m.index > lastIdx) result.push({ type: 'text', value: t.slice(lastIdx, m.index) });
      const full = m[0];
      if (full.startsWith('http')) {
        result.push(isSafeUrl(full) ? { type: 'link', value: full } : { type: 'text', value: full });
      } else {
        result.push({ type: 'mention', value: full.startsWith('@') ? full.slice(1) : full });
      }
      lastIdx = re.lastIndex;
    }
    if (lastIdx < t.length) result.push({ type: 'text', value: t.slice(lastIdx) });
    return result;
  };

  return (
    <For each={parts()}>
      {(p) =>
        p.type === 'link'
          ? <a href={p.value} target="_blank" rel="noopener noreferrer" class={styles.inlineLink}>{p.value}</a>
          : p.type === 'mention'
          ? <span class={styles.mention} onClick={(e) => { e.stopPropagation(); handleMentionClick(p.value); }}>@{p.value}</span>
          : <>{p.value}</>
      }
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
}

const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const msg = props.msg;
  const reacted = () => groupReactions(msg, props.currentUserId);
  const isImageOnly = () => msg.type === 'IMAGE' && !!msg.mediaUrl && !msg.text;

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
    if (y < 8) y = 8;
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
    <div
      class={`${props.mine ? styles.rowMine : styles.rowTheirs} ${props.grouping.withBelow ? styles.rowGrouped : ''} ${props.isActive ? styles.msgActive : ''}`}
      data-msg-id={msg.id}
    >
      <Show when={!props.mine}>
        <div class={styles.avatarSlot}>
          <Show when={props.grouping.showAvatar}>
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
            isImageOnly() ? styles.bubbleImage : '',
            props.grouping.withAbove && props.mine  ? styles.bubbleMineTop   : '',
            props.grouping.withAbove && !props.mine ? styles.bubbleTheirsTop : '',
            props.grouping.withBelow && props.mine  ? styles.bubbleMineBot   : '',
            props.grouping.withBelow && !props.mine ? styles.bubbleTheirsBot : '',
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
                return (
              <div
                class={styles.mediaImgWrap}
                onClick={(e) => { e.stopPropagation(); props.onOpenLightbox(msg.id, e.currentTarget as HTMLElement); }}
              >
                <div class={`${styles.mediaImgSkeleton} ${imgLoaded() ? styles.mediaImgLoaded : ''}`} />
                <img class={`${styles.mediaImg} ${imgLoaded() ? styles.mediaImgVisible : ''}`} src={mediaMediumUrl(msg.mediaUrl)} alt="" loading="lazy" onLoad={() => setImgLoaded(true)} onError={(e) => { const t = e.currentTarget; if (!t.dataset.fell) { t.dataset.fell = '1'; t.src = mediaUrl(msg.mediaUrl)!; } else { setImgLoaded(true); } }} />
                <Show when={isImageOnly()}>
                  <div class={styles.mediaImgOverlay}>
                    <Show when={msg.isEdited}><span class={styles.overlayEdited}>{i18n.t('msg.edited')}</span></Show>
                    <span class={styles.overlayTime}>{props.fmt(msg.createdAt)}</span>
                    <Show when={props.mine}>
                      <span class={`${styles.overlayTick} ${props.isPending(msg) ? styles.overlayTickPending : props.isRead(msg) ? styles.overlayTickRead : props.isDelivered(msg) ? styles.overlayTickDelivered : ''}`}>
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
              <VoicePlayer src={mediaUrl(msg.mediaUrl)!} mine={props.mine} msgId={msg.id} voiceListens={msg.voiceListens} currentUserId={props.currentUserId} senderName={displayName(msg.sender)} msgTime={props.fmt(msg.createdAt)} />
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
            <Show when={!isImageOnly()}>
              <div class={styles.meta}>
                <Show when={msg.isEdited}><span class={styles.edited}>{i18n.t('msg.edited')}</span></Show>
                <span class={styles.time}>{props.fmt(msg.createdAt)}</span>
                <Show when={props.mine}>
                  <span class={`${styles.tick} ${props.isPending(msg) ? styles.tickPending : props.isRead(msg) ? styles.tickRead : props.isDelivered(msg) ? styles.tickDelivered : ''}`}>
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
                </Show>
              </div>
            </Show>
          </Show>
        </div>

        <Show when={!msg.isDeleted && reacted().length > 0}>
          <div class={styles.reactionsRow}>
            <For each={reacted()}>
              {(r) => (
                <button class={`${styles.reactionChip} ${r.mine ? styles.reactionMine : ''}`}
                  onClick={() => props.onReaction(msg.id, r.emoji)}>
                  {r.emoji}{r.count > 1 ? ` ${r.count}` : ''}
                </button>
              )}
            </For>
          </div>
        </Show>

      </div>
    </div>
    </>
  );
};

export default MessageBubble;
