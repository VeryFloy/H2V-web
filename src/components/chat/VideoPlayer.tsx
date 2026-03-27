import { type Component, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { mediaThumbUrl, mediaMediumUrl } from '../../api/client';
import styles from './VideoPlayer.module.css';

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

interface Props {
  src: string;
  posterUrl?: string;
  lightbox?: boolean;
}

const VideoPlayer: Component<Props> = (props) => {
  let videoRef!: HTMLVideoElement;
  let wrapRef!: HTMLDivElement;
  let progressRef!: HTMLDivElement;

  const [playing, setPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [buffered, setBuffered] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [showUI, setShowUI] = createSignal(true);
  const [speedIdx, setSpeedIdx] = createSignal(0);
  const [metaReady, setMetaReady] = createSignal(false);
  const [seeking, setSeeking] = createSignal(false);
  const [volume, setVolume] = createSignal(1);
  const [muted, setMuted] = createSignal(false);
  const [videoSrc, setVideoSrc] = createSignal('');
  const [triedMedium, setTriedMedium] = createSignal(false);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let raf: number | undefined;

  const thumbUrl = () => props.posterUrl || mediaThumbUrl(props.src) || '';

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (playing()) hideTimer = setTimeout(() => setShowUI(false), 3000);
  }

  function revealUI() {
    setShowUI(true);
    scheduleHide();
  }

  // ─── Click / tap ───
  function handleClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(`.${styles.panel}`)) return;
    if (playing()) {
      if (!showUI()) { revealUI(); return; }
      videoRef.pause();
    } else {
      videoRef.play().catch(() => {});
    }
    revealUI();
  }

  function handleTouch(e: TouchEvent) {
    if ((e.target as HTMLElement).closest(`.${styles.panel}`)) return;
    if (playing() && !showUI()) {
      e.preventDefault();
      revealUI();
      return;
    }
  }

  // ─── Video events ───
  let _lastTickTs = 0;
  function tick() {
    const now = performance.now();
    if (now - _lastTickTs > 100) {
      _lastTickTs = now;
      if (!seeking()) setCurrentTime(videoRef.currentTime);
      const b = videoRef.buffered;
      if (b.length > 0) setBuffered(b.end(b.length - 1));
    }
    raf = requestAnimationFrame(tick);
  }

  function onMeta() {
    setDuration(videoRef.duration);
    setMetaReady(true);
    setLoading(false);
  }
  function onPlay() { setPlaying(true); scheduleHide(); raf = requestAnimationFrame(tick); }
  function onPause() { setPlaying(false); setShowUI(true); clearTimeout(hideTimer); if (raf) cancelAnimationFrame(raf); }
  function onWaiting() { setLoading(true); }
  function onCanPlay() { setLoading(false); }
  function onEnded() { setPlaying(false); setShowUI(true); clearTimeout(hideTimer); if (raf) cancelAnimationFrame(raf); }

  // ─── Progress seek ───
  function seekAt(e: MouseEvent | Touch) {
    const rect = progressRef.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.currentTime = pct * duration();
    setCurrentTime(pct * duration());
  }
  function onProgressDown(e: MouseEvent) {
    e.stopPropagation(); setSeeking(true); seekAt(e);
    const mv = (ev: MouseEvent) => seekAt(ev);
    const up = () => { setSeeking(false); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  }
  function onProgressTouch(e: TouchEvent) {
    e.stopPropagation(); setSeeking(true); seekAt(e.touches[0]);
    const mv = (ev: TouchEvent) => { ev.preventDefault(); seekAt(ev.touches[0]); };
    const up = () => { setSeeking(false); window.removeEventListener('touchmove', mv); window.removeEventListener('touchend', up); };
    window.addEventListener('touchmove', mv, { passive: false }); window.addEventListener('touchend', up);
  }

  // ─── Control actions ───
  function togglePlay(e: MouseEvent) { e.stopPropagation(); if (videoRef.paused) videoRef.play().catch(() => {}); else videoRef.pause(); revealUI(); }
  function cycleSpeed(e: MouseEvent) { e.stopPropagation(); const n = (speedIdx() + 1) % SPEEDS.length; setSpeedIdx(n); videoRef.playbackRate = SPEEDS[n]; }
  function toggleFS(e: MouseEvent) { e.stopPropagation(); document.fullscreenElement ? document.exitFullscreen() : wrapRef.requestFullscreen?.(); }
  function togglePiP(e: MouseEvent) { e.stopPropagation(); document.pictureInPictureElement ? document.exitPictureInPicture() : videoRef.requestPictureInPicture?.(); }
  function toggleMute(e: MouseEvent) { e.stopPropagation(); const m = !muted(); setMuted(m); videoRef.muted = m; }
  function onVolChange(e: Event) { const v = parseFloat((e.target as HTMLInputElement).value); setVolume(v); videoRef.volume = v; if (v > 0 && muted()) { setMuted(false); videoRef.muted = false; } }

  function handleVideoError() {
    if (!triedMedium()) { setTriedMedium(true); setVideoSrc(props.src); }
  }

  onMount(() => {
    if (videoRef) videoRef.volume = 1;
    const medium = mediaMediumUrl(props.src);
    if (medium && medium !== props.src) setVideoSrc(medium);
    else { setVideoSrc(props.src); setTriedMedium(true); }
  });

  onCleanup(() => { clearTimeout(hideTimer); if (raf) cancelAnimationFrame(raf); });

  const pct = () => duration() > 0 ? (currentTime() / duration()) * 100 : 0;
  const bufPct = () => duration() > 0 ? (buffered() / duration()) * 100 : 0;
  const remaining = () => Math.max(0, duration() - currentTime());

  return (
    <div ref={wrapRef!} class={`${styles.wrap} ${props.lightbox ? styles.wrapLightbox : ''}`} onClick={handleClick} onTouchEnd={handleTouch}>

      {/* Video element */}
      <video
        ref={videoRef!}
        class={styles.video}
        src={videoSrc()}
        preload="metadata"
        playsinline
        onLoadedMetadata={onMeta}
        onPlay={onPlay}
        onPause={onPause}
        onWaiting={onWaiting}
        onCanPlay={onCanPlay}
        onEnded={onEnded}
        onError={handleVideoError}
      />

      {/* Blur poster placeholder */}
      <Show when={thumbUrl() && !metaReady()}>
        <div class={`${styles.poster} ${metaReady() ? styles.posterGone : ''}`}
          style={{ 'background-image': `url(${thumbUrl()})` }} />
      </Show>

      {/* Duration badge (top-left, visible when paused) */}
      <div class={`${styles.badge} ${playing() && !showUI() ? styles.badgeHidden : ''}`}>
        <svg class={styles.badgeIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <Show when={!muted() && volume() > 0} fallback={
            <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="#fff" stroke="none" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
          }>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="#fff" stroke="none" />
            <path d="M15.54 8.46a5 5 0 010 7.07" />
          </Show>
        </svg>
        <span class={styles.badgeText}>
          {playing() ? fmt(currentTime()) : fmt(duration())}
        </span>
      </div>

      {/* Center play/pause button (when paused or buffering) */}
      <div class={`${styles.centerBtn} ${playing() ? styles.centerBtnHidden : ''}`}>
        <div class={`${styles.playCircle} ${playing() ? styles.pauseCircle : ''}`}>
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>

      {/* Loading spinner */}
      <Show when={loading() && playing()}>
        <div class={styles.loader}><div class={styles.ring} /></div>
      </Show>

      {/* Bottom gradient */}
      <div class={`${styles.grad} ${!showUI() ? styles.panelHidden : ''}`} />

      {/* Bottom controls */}
      <div class={`${styles.panel} ${!showUI() ? styles.panelHidden : ''}`}>

        {/* Progress bar */}
        <div ref={progressRef!} class={styles.progress}
          onMouseDown={onProgressDown} onTouchStart={onProgressTouch}>
          <div class={styles.track}>
            <div class={styles.bufBar} style={{ width: `${bufPct()}%` }} />
            <div class={styles.fillBar} style={{ width: `${pct()}%` }} />
          </div>
          <div class={styles.thumb} style={{ left: `${pct()}%` }} />
        </div>

        {/* Controls row */}
        <div class={styles.row}>

          {/* Volume */}
          <div class={styles.volWrap}>
            <button class={styles.btn} onClick={toggleMute} title={muted() ? 'Unmute' : 'Mute'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <Show when={!muted() && volume() > 0} fallback={
                  <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="currentColor" stroke="none" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                }>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="currentColor" stroke="none" />
                  <path d="M15.54 8.46a5 5 0 010 7.07" />
                  <Show when={volume() > 0.5}>
                    <path d="M19.07 4.93a10 10 0 010 14.14" />
                  </Show>
                </Show>
              </svg>
            </button>
            <div class={styles.volSlider}>
              <input type="range" class={styles.volRange} min="0" max="1" step="0.05"
                value={volume()} onInput={onVolChange} onClick={(e: MouseEvent) => e.stopPropagation()} />
            </div>
          </div>

          {/* Time */}
          <span class={styles.time}>{fmt(currentTime())}</span>
          <span class={styles.sep}>/</span>
          <span class={styles.time}>{fmt(duration())}</span>

          <div class={styles.spacer} />

          {/* Play/Pause mini button */}
          <button class={styles.playBtn} onClick={togglePlay}>
            <Show when={!playing()} fallback={
              <svg width="14" height="14" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            }>
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </Show>
          </button>

          <div class={styles.spacer} />

          {/* Speed */}
          <button class={styles.speedBtn} onClick={cycleSpeed}>{SPEEDS[speedIdx()]}x</button>

          {/* PiP */}
          <Show when={'pictureInPictureEnabled' in document}>
            <button class={styles.btn} onClick={togglePiP} title="PiP">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" /><rect x="12" y="9" width="8" height="6" rx="1" />
              </svg>
            </button>
          </Show>

          {/* Fullscreen */}
          <button class={styles.btn} onClick={toggleFS} title="Fullscreen">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
