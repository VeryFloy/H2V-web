import { type Component, createResource, createSignal, createEffect, createMemo, Show, For, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { api, mediaUrl, mediaMediumUrl } from '../../api/client';
import { fallbackWaveform, extractWaveform, getCachedDuration, WAVE_BARS } from '../../utils/waveform';
import { chatStore } from '../../stores/chat.store';
import { authStore } from '../../stores/auth.store';
import { displayName, formatLastSeen } from '../../utils/format';
import { i18n } from '../../stores/i18n.store';
import { avatarColor } from '../../utils/avatar';
import { useSwipeBack } from '../../utils/useSwipeBack';
import styles from './UserProfile.module.css';

interface Props {
  userId: string;
  onClose: () => void;
  onStartChat?: (userId: string) => void;
  onStartSecretChat?: (userId: string) => void;
  inline?: boolean;
}

const UserProfile: Component<Props> = (props) => {
  const t = i18n.t;

  // Instant display from store while API fetches fresh data (bio, exact lastOnline).
  const cachedUser = createMemo(() => {
    const id = props.userId;
    if (authStore.user()?.id === id) return authStore.user() ?? null;
    for (const chat of chatStore.chats) {
      const member = chat.members.find((m) => m.user.id === id);
      if (member) return member.user;
    }
    return null;
  });

  const [userData] = createResource(
    () => props.userId,
    (id) => api.getUser(id).then((r) => r.data),
  );

  const user = createMemo(() => userData() ?? cachedUser());

  const isOnline = () => chatStore.onlineIds().has(props.userId);
  const avatarLetter = () => displayName(user())[0]?.toUpperCase() ?? '?';

  const [isBlockedState, setIsBlockedState] = createSignal(false);
  const [isContactState, setIsContactState] = createSignal(false);
  const [isMutualState, setIsMutualState] = createSignal(false);
  const [contactLoading, setContactLoading] = createSignal(false);

  createEffect(() => {
    const uid = props.userId;
    api.getBlockedUsers().then(r => {
      setIsBlockedState(r.data?.includes(uid) ?? false);
    }).catch(() => {});
    api.checkContact(uid).then(r => {
      setIsContactState(r.data.isContact);
      setIsMutualState(r.data.isMutual);
    }).catch(() => {});
  });

  const [blockLoading, setBlockLoading] = createSignal(false);

  type GalleryTab = 'media' | 'files' | 'links' | 'voice';
  const [galleryTab, setGalleryTab] = createSignal<GalleryTab>('media');
  const [galleryItems, setGalleryItems] = createSignal<any[]>([]);
  const [galleryLoading, setGalleryLoading] = createSignal(false);
  const [lightboxIdx, setLightboxIdx] = createSignal<number | null>(null);
  let lbOriginRect: DOMRect | null = null;

  // Voice player state for gallery
  const [gvSrc, setGvSrc] = createSignal<string | null>(null);
  const [gvPlaying, setGvPlaying] = createSignal(false);
  const [gvProgress, setGvProgress] = createSignal(0);
  const [gvDuration, setGvDuration] = createSignal(0);
  const [gvCurrentTime, setGvCurrentTime] = createSignal(0);
  let gvAudio: HTMLAudioElement | null = null;
  let gvRaf: number | null = null;

  function gvTick() {
    if (!gvAudio || !gvPlaying()) { gvRaf = null; return; }
    setGvCurrentTime(gvAudio.currentTime);
    setGvProgress(gvAudio.duration > 0 ? gvAudio.currentTime / gvAudio.duration : 0);
    gvRaf = requestAnimationFrame(gvTick);
  }
  function gvPlay(src: string) {
    if (gvAudio && gvSrc() === src) {
      if (gvPlaying()) { gvAudio.pause(); if (gvRaf) cancelAnimationFrame(gvRaf); gvRaf = null; setGvPlaying(false); }
      else { gvAudio.play().catch(() => {}); setGvPlaying(true); gvRaf = requestAnimationFrame(gvTick); }
      return;
    }
    if (gvAudio) { gvAudio.pause(); gvAudio.src = ''; }
    gvAudio = new Audio(src);
    setGvSrc(src); setGvProgress(0); setGvCurrentTime(0); setGvDuration(0);
    gvAudio.addEventListener('loadedmetadata', () => { if (gvAudio) setGvDuration(gvAudio.duration); });
    gvAudio.addEventListener('ended', () => { setGvPlaying(false); setGvProgress(0); setGvCurrentTime(0); if (gvRaf) cancelAnimationFrame(gvRaf); gvRaf = null; });
    gvAudio.play().catch(() => {});
    setGvPlaying(true);
    gvRaf = requestAnimationFrame(gvTick);
  }
  function gvSeek(e: MouseEvent) {
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (gvAudio && gvDuration() > 0) gvAudio.currentTime = ratio * gvDuration();
  }
  function fmtVoice(s: number): string {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }
  onCleanup(() => { if (gvAudio) { gvAudio.pause(); gvAudio.src = ''; } });

  const chatWithUser = createMemo(() => {
    const me = authStore.user();
    if (!me) return null;
    return chatStore.chats.find(c =>
      (c.type === 'DIRECT' || c.type === 'SECRET') &&
      c.members.some(m => m.user.id === props.userId) &&
      c.members.some(m => m.user.id === me.id)
    ) ?? null;
  });

  async function loadGallery(tab: GalleryTab) {
    const c = chatWithUser();
    if (!c) { setGalleryItems([]); return; }
    setGalleryLoading(true);
    try {
      const res = await api.getSharedMedia(c.id, tab);
      setGalleryItems(res.data?.items ?? []);
    } catch { setGalleryItems([]); }
    finally { setGalleryLoading(false); }
  }

  createEffect(() => {
    const tab = galleryTab();
    if (chatWithUser()) loadGallery(tab);
  });

  async function toggleContact() {
    if (contactLoading()) return;
    setContactLoading(true);
    try {
      if (isContactState()) {
        await api.removeContact(props.userId);
        setIsContactState(false);
        setIsMutualState(false);
      } else {
        await api.addContact(props.userId);
        setIsContactState(true);
        const check = await api.checkContact(props.userId);
        setIsMutualState(check.data.isMutual);
      }
    } catch {
      console.error('[UserProfile] toggleContact failed');
    } finally {
      setContactLoading(false);
    }
  }

  async function toggleBlock() {
    if (blockLoading()) return;
    setBlockLoading(true);
    try {
      if (isBlockedState()) {
        await api.unblockUser(props.userId);
        setIsBlockedState(false);
      } else {
        await api.blockUser(props.userId);
        setIsBlockedState(true);
      }
    } catch {
      console.error('[UserProfile] toggleBlock failed');
    } finally {
      setBlockLoading(false);
    }
  }

  const swipe = useSwipeBack(() => props.onClose());

  return (
    <div
      class={props.inline ? styles.inlineWrap : styles.overlay}
      onClick={props.inline ? undefined : props.onClose}
      onTouchStart={props.inline ? swipe.onTouchStart : undefined}
      onTouchMove={props.inline ? swipe.onTouchMove : undefined}
      onTouchEnd={props.inline ? swipe.onTouchEnd : undefined}
    >
      <div class={props.inline ? styles.inlinePanel : styles.panel} onClick={props.inline ? undefined : (e) => e.stopPropagation()}>
        <div class={styles.header}>
          <Show when={props.inline}>
            <button class={styles.headerBtn} onClick={props.onClose} style={{ "margin-right": "4px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            </button>
          </Show>
          <span class={styles.headerTitle}>{t('profile.title')}</span>
          <button class={styles.headerBtn} onClick={props.onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>

        <Show when={userData.loading && !cachedUser()}>
          <div class={styles.loading}>...</div>
        </Show>

        <Show when={userData.error && !cachedUser()}>
          <div class={styles.error}>{t('profile.load_error')}</div>
        </Show>

        <Show when={user()}>
          {(u) => (
            <>
              <div class={styles.avatarSection}>
                <div class={styles.avatar} style={!u().avatar ? { background: avatarColor(u().id) } : undefined}>
                  <Show when={u().avatar} fallback={<span class={styles.avatarLetter}>{avatarLetter()}</span>}>
                    <img src={mediaUrl(u().avatar)} alt="" />
                  </Show>
                </div>
                <Show when={isOnline()}>
                  <div class={styles.onlineBadge} />
                </Show>
              </div>

              <div class={styles.name}>
                {displayName(u())}
                <Show when={isMutualState()}>
                  <span class={styles.mutualBadge}>{t('contacts.mutual')}</span>
                </Show>
              </div>
              <div class={`${styles.statusLine} ${isOnline() ? styles.statusOnline : ''}`}>
                {isOnline() ? t('profile.online') : formatLastSeen(u().lastOnline)}
              </div>

              <div class={styles.infoSection}>
                <div class={styles.infoRow}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/></svg>
                  <div class={styles.infoContent}>
                    <div class={styles.infoLabel}>{t('profile.username')}</div>
                    <div class={styles.infoValue}>@{u().nickname}</div>
                  </div>
                </div>
                <Show when={u().bio}>
                  <div class={styles.infoRow}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="1.8"/></svg>
                    <div class={styles.infoContent}>
                      <div class={styles.infoLabel}>{t('profile.about')}</div>
                      <div class={styles.infoValue}>{u().bio}</div>
                    </div>
                  </div>
                </Show>
              </div>

              <Show when={props.onStartChat || props.onStartSecretChat}>
                <div class={styles.actions}>
                  <Show when={props.onStartChat}>
                    <button class={styles.chatBtn} onClick={() => props.onStartChat?.(props.userId)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {t('profile.send_message')}
                    </button>
                  </Show>
                  <Show when={props.onStartSecretChat}>
                    <button class={styles.secretBtn} onClick={() => props.onStartSecretChat?.(props.userId)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                      {t('profile.secret_chat')}
                    </button>
                  </Show>
                </div>
              </Show>

              {/* ── Media Gallery ── */}
              <Show when={chatWithUser()}>
                <div class={styles.gallery}>
                  <div class={styles.galleryTabs}>
                    {(['media', 'files', 'links', 'voice'] as GalleryTab[]).map(tab => (
                      <button
                        class={`${styles.galleryTab} ${galleryTab() === tab ? styles.galleryTabActive : ''}`}
                        onClick={() => setGalleryTab(tab)}
                      >
                        {t(`gallery.${tab}`)}
                      </button>
                    ))}
                  </div>
                  <div class={styles.galleryContent}>
                    <Show when={galleryLoading()}>
                      <div class={styles.galleryEmpty}>...</div>
                    </Show>
                    <Show when={!galleryLoading() && galleryItems().length === 0}>
                      <div class={styles.galleryEmpty}>{t('gallery.empty')}</div>
                    </Show>
                    <Show when={!galleryLoading() && galleryItems().length > 0}>
                      <Show when={galleryTab() === 'media'}>
                        <div class={styles.mediaGrid}>
                          <For each={galleryItems()}>
                            {(item, idx) => (
                              <div class={styles.mediaThumb} onClick={(e) => { if (item.type !== 'VIDEO') { lbOriginRect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setLightboxIdx(idx()); } }}>
                                <Show when={item.type === 'VIDEO'} fallback={
                                  <img src={mediaMediumUrl(item.mediaUrl)} alt="" loading="lazy" />
                                }>
                                  <video src={mediaUrl(item.mediaUrl)} preload="metadata" onClick={(e) => { e.stopPropagation(); window.open(mediaUrl(item.mediaUrl), '_blank'); }} />
                                  <div class={styles.mediaPlay}>▶</div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={galleryTab() === 'files'}>
                        <div class={styles.fileList}>
                          <For each={galleryItems()}>
                            {(item) => (
                              <a class={styles.fileRow} href={mediaUrl(item.mediaUrl)} target="_blank" rel="noopener">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/></svg>
                                <span class={styles.fileName}>{item.mediaName || item.mediaUrl?.split('/').pop()}</span>
                              </a>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={galleryTab() === 'links'}>
                        <div class={styles.fileList}>
                          <For each={galleryItems()}>
                            {(item) => {
                              const url = () => item.text?.match(/https?:\/\/[^\s]+/)?.[0] ?? item.text;
                              return (
                                <a class={styles.linkRow} href={url()} target="_blank" rel="noopener">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                                  <span class={styles.linkText}>{url()}</span>
                                </a>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                      <Show when={galleryTab() === 'voice'}>
                        <div class={styles.voiceList}>
                          <For each={galleryItems()}>
                            {(item) => {
                              const src = () => mediaUrl(item.mediaUrl);
                              const [waveform, setWaveform] = createSignal<number[]>(fallbackWaveform(src()));
                              const [itemDur, setItemDur] = createSignal(0);
                              onMount(() => {
                                extractWaveform(src(), WAVE_BARS).then((w) => {
                                  setWaveform(w);
                                  const cached = getCachedDuration(src());
                                  if (cached > 0) setItemDur(cached);
                                }).catch(() => {});
                              });
                              const active = () => gvSrc() === src();
                              const playing = () => active() && gvPlaying();
                              const progress = () => active() ? gvProgress() : 0;
                              const curTime = () => active() ? gvCurrentTime() : 0;
                              const dur = () => active() ? (gvDuration() || itemDur()) : itemDur();
                              return (
                                <div class={`${styles.gvRow} ${active() ? styles.gvRowActive : ''}`}>
                                  <button class={styles.gvPlayBtn} onClick={() => gvPlay(src())}>
                                    <Show when={playing()} fallback={
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                    }>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                                    </Show>
                                  </button>
                                  <div class={styles.gvBody}>
                                    <div class={styles.gvWaveBars} onClick={(e) => { e.stopPropagation(); gvSeek(e); }}>
                                      <For each={waveform()}>{(h, i) =>
                                        <div
                                          class={`${styles.gvWaveBarItem} ${(i() / WAVE_BARS) < progress() ? styles.gvWavePlayed : ''}`}
                                          style={{ height: `${h * 100}%` }}
                                        />
                                      }</For>
                                    </div>
                                    <div class={styles.gvInfo}>
                                      <span class={styles.gvTime}>{playing() || curTime() > 0 ? fmtVoice(curTime()) : fmtVoice(dur())}</span>
                                      <span class={styles.gvSender}>{displayName(item.sender)}</span>
                                      <span class={styles.gvDate}>{new Date(item.createdAt).toLocaleDateString()}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </div>
                </div>
              </Show>

              {/* ── Gallery Lightbox (style) ── */}
              <Show when={lightboxIdx() !== null}>
                {(() => {
                  const mediaItems = () => galleryItems().filter(i => i.type === 'IMAGE');
                  const idx = () => lightboxIdx()!;
                  const item = () => mediaItems()[idx()];
                  const hasPrev = () => idx() > 0;
                  const hasNext = () => idx() < mediaItems().length - 1;
                  let lbImgRef: HTMLImageElement | undefined;
                  let lbOverRef: HTMLDivElement | undefined;
                  let touchStartX = 0, touchStartY = 0, swDx = 0, swDy = 0;
                  let swAxis: 'none' | 'x' | 'y' = 'none';
                  const [closing, setClosing] = createSignal(false);

                  const originStyle = () => {
                    const r = lbOriginRect;
                    if (!r) return '';
                    const cx = r.left + r.width / 2;
                    const cy = r.top + r.height / 2;
                    const vw = window.innerWidth;
                    const vh = window.innerHeight;
                    const scale = Math.max(r.width / Math.min(vw * 0.9, 800), 0.08);
                    return `translate(${cx - vw / 2}px, ${cy - vh / 2}px) scale(${scale})`;
                  };

                  function closeLb() {
                    if (closing()) return;
                    setClosing(true);
                    if (lbImgRef) {
                      const o = originStyle();
                      lbImgRef.style.transition = 'transform 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease';
                      lbImgRef.style.transform = o || 'scale(0.85)';
                      lbImgRef.style.opacity = '0';
                    }
                    if (lbOverRef) { lbOverRef.style.transition = 'background 0.25s ease'; lbOverRef.style.background = 'rgba(0,0,0,0)'; }
                    setTimeout(() => setLightboxIdx(null), 280);
                  }

                  function onKeyDown(e: KeyboardEvent) {
                    if (e.key === 'Escape') closeLb();
                    if (e.key === 'ArrowLeft' && hasPrev()) setLightboxIdx(idx() - 1);
                    if (e.key === 'ArrowRight' && hasNext()) setLightboxIdx(idx() + 1);
                  }
                  document.addEventListener('keydown', onKeyDown);
                  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

                  return (
                    <Portal>
                      <div
                        ref={lbOverRef}
                        class={styles.lbOverlay}
                        onClick={() => closeLb()}
                        onTouchStart={(e) => { if (e.touches.length === 1) { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; swDx = 0; swDy = 0; swAxis = 'none'; } }}
                        onTouchMove={(e) => {
                          if (e.touches.length !== 1) return;
                          swDx = e.touches[0].clientX - touchStartX;
                          swDy = e.touches[0].clientY - touchStartY;
                          if (swAxis === 'none' && (Math.abs(swDx) > 8 || Math.abs(swDy) > 8)) swAxis = Math.abs(swDx) > Math.abs(swDy) ? 'x' : 'y';
                          if (lbImgRef) {
                            if (swAxis === 'y') {
                              lbImgRef.style.transition = 'none';
                              lbImgRef.style.transform = `translateY(${swDy}px) scale(${Math.max(0.85, 1 - Math.abs(swDy) / 600)})`;
                              if (lbOverRef) lbOverRef.style.background = `rgba(0,0,0,${Math.max(0.15, 0.92 - Math.abs(swDy) / 400)})`;
                            } else if (swAxis === 'x') {
                              lbImgRef.style.transition = 'none';
                              lbImgRef.style.transform = `translateX(${swDx}px)`;
                            }
                          }
                        }}
                        onTouchEnd={() => {
                          if (swAxis === 'y' && Math.abs(swDy) > 100) { closeLb(); }
                          else if (swAxis === 'x') {
                            if (swDx > 80 && hasPrev()) setLightboxIdx(idx() - 1);
                            else if (swDx < -80 && hasNext()) setLightboxIdx(idx() + 1);
                            if (lbImgRef) { lbImgRef.style.transition = 'transform 0.25s ease'; lbImgRef.style.transform = ''; }
                          } else if (lbImgRef) {
                            lbImgRef.style.transition = 'transform 0.25s ease, opacity 0.2s ease';
                            lbImgRef.style.transform = '';
                            lbImgRef.style.opacity = '';
                            if (lbOverRef) { lbOverRef.style.transition = 'background 0.25s ease'; lbOverRef.style.background = ''; }
                          }
                          swAxis = 'none';
                        }}
                      >
                        <button class={styles.lbClose} onClick={(e) => { e.stopPropagation(); closeLb(); }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
                        </button>
                        <Show when={hasPrev()}>
                          <button class={`${styles.lbNav} ${styles.lbNavPrev}`} onClick={(e) => { e.stopPropagation(); setLightboxIdx(idx() - 1); }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          </button>
                        </Show>
                        <Show when={hasNext()}>
                          <button class={`${styles.lbNav} ${styles.lbNavNext}`} onClick={(e) => { e.stopPropagation(); setLightboxIdx(idx() + 1); }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          </button>
                        </Show>
                        <Show when={mediaItems().length > 1}>
                          <div class={styles.lbCounter}>{idx() + 1} / {mediaItems().length}</div>
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
                            class={styles.lbImg}
                            src={mediaUrl(item().mediaUrl)}
                            alt=""
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Show>
                      </div>
                    </Portal>
                  );
                })()}
              </Show>

              <button class={styles.contactBtn} onClick={toggleContact} disabled={contactLoading()}>
                <Show when={isContactState()} fallback={
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8.5" cy="7" r="4" stroke="currentColor" stroke-width="2"/><line x1="20" y1="8" x2="20" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="23" y1="11" x2="17" y2="11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    {t('contacts.add')}
                  </>
                }>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8.5" cy="7" r="4" stroke="currentColor" stroke-width="2"/><line x1="17" y1="11" x2="23" y2="11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  {t('contacts.remove')}
                </Show>
              </button>

              <button class={styles.blockBtn} onClick={toggleBlock}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="currentColor" stroke-width="2"/></svg>
                {isBlockedState() ? t('msg.unblock') : t('msg.block')}
              </button>
            </>
          )}
        </Show>
      </div>
    </div>
  );
};

export default UserProfile;
