import { type Component, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { mediaThumbUrl } from '../../api/client';
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
  const [showControls, setShowControls] = createSignal(true);
  const [speedIdx, setSpeedIdx] = createSignal(0);
  const [metaLoaded, setMetaLoaded] = createSignal(false);
  const [seeking, setSeeking] = createSignal(false);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let raf: number | undefined;

  const thumbUrl = () => {
    if (props.posterUrl) return props.posterUrl;
    return mediaThumbUrl(props.src) || '';
  };

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (playing()) {
      hideTimer = setTimeout(() => setShowControls(false), 3000);
    }
  }

  function handleWrapClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(`.${styles.controls}`)) return;
    togglePlay();
    setShowControls(true);
    scheduleHide();
  }

  function handleWrapTouch(e: TouchEvent) {
    if ((e.target as HTMLElement).closest(`.${styles.controls}`)) return;
    if (!showControls() && playing()) {
      e.preventDefault();
      setShowControls(true);
      scheduleHide();
      return;
    }
  }

  function togglePlay() {
    if (videoRef.paused) {
      videoRef.play().catch(() => {});
    } else {
      videoRef.pause();
    }
  }

  function tick() {
    if (!seeking()) {
      setCurrentTime(videoRef.currentTime);
    }
    const buf = videoRef.buffered;
    if (buf.length > 0) {
      setBuffered(buf.end(buf.length - 1));
    }
    raf = requestAnimationFrame(tick);
  }

  function handleLoadedMeta() {
    setDuration(videoRef.duration);
    setMetaLoaded(true);
    setLoading(false);
  }

  function handlePlay() {
    setPlaying(true);
    scheduleHide();
    raf = requestAnimationFrame(tick);
  }

  function handlePause() {
    setPlaying(false);
    setShowControls(true);
    clearTimeout(hideTimer);
    if (raf) cancelAnimationFrame(raf);
  }

  function handleWaiting() { setLoading(true); }
  function handleCanPlay() { setLoading(false); }

  function handleEnded() {
    setPlaying(false);
    setShowControls(true);
    clearTimeout(hideTimer);
    if (raf) cancelAnimationFrame(raf);
  }

  function seekFromEvent(e: MouseEvent | Touch) {
    const rect = progressRef.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.currentTime = pct * duration();
    setCurrentTime(pct * duration());
  }

  function handleProgressDown(e: MouseEvent) {
    e.stopPropagation();
    setSeeking(true);
    seekFromEvent(e);
    const onMove = (ev: MouseEvent) => seekFromEvent(ev);
    const onUp = () => {
      setSeeking(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleProgressTouch(e: TouchEvent) {
    e.stopPropagation();
    setSeeking(true);
    seekFromEvent(e.touches[0]);
    const onMove = (ev: TouchEvent) => { ev.preventDefault(); seekFromEvent(ev.touches[0]); };
    const onEnd = () => {
      setSeeking(false);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }

  function cycleSpeed(e: MouseEvent) {
    e.stopPropagation();
    const next = (speedIdx() + 1) % SPEEDS.length;
    setSpeedIdx(next);
    videoRef.playbackRate = SPEEDS[next];
  }

  function toggleFullscreen(e: MouseEvent) {
    e.stopPropagation();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      wrapRef.requestFullscreen?.();
    }
  }

  function togglePiP(e: MouseEvent) {
    e.stopPropagation();
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else {
      videoRef.requestPictureInPicture?.();
    }
  }

  onMount(() => {
    if (videoRef) {
      videoRef.volume = 1;
    }
  });

  onCleanup(() => {
    clearTimeout(hideTimer);
    if (raf) cancelAnimationFrame(raf);
  });

  const pct = () => duration() > 0 ? (currentTime() / duration()) * 100 : 0;
  const bufPct = () => duration() > 0 ? (buffered() / duration()) * 100 : 0;

  return (
    <div
      ref={wrapRef!}
      class={styles.wrap}
      onClick={handleWrapClick}
      onTouchEnd={handleWrapTouch}
    >
      <video
        ref={videoRef!}
        class={styles.video}
        src={props.src}
        preload="metadata"
        playsinline
        onLoadedMetadata={handleLoadedMeta}
        onPlay={handlePlay}
        onPause={handlePause}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onEnded={handleEnded}
      />

      <Show when={thumbUrl() && !metaLoaded()}>
        <div
          class={`${styles.poster} ${metaLoaded() ? styles.posterHidden : ''}`}
          style={{ 'background-image': `url(${thumbUrl()})` }}
        />
      </Show>

      <Show when={loading()}>
        <div class={styles.spinner}>
          <div class={styles.spinnerRing} />
        </div>
      </Show>

      <div class={`${styles.bigPlay} ${playing() && showControls() ? styles.bigPlayHidden : !playing() ? '' : styles.bigPlayHidden}`}>
        <div class={styles.bigPlayBtn}>
          <Show when={!playing()} fallback={
            <svg width="24" height="24" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          }>
            <svg width="24" height="24" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </Show>
        </div>
      </div>

      <div class={`${styles.gradient} ${!showControls() ? styles.controlsHidden : ''}`} />

      <div class={`${styles.controls} ${!showControls() ? styles.controlsHidden : ''}`}>
        <div
          ref={progressRef!}
          class={styles.progressWrap}
          onMouseDown={handleProgressDown}
          onTouchStart={handleProgressTouch}
        >
          <div class={styles.progressTrack}>
            <div class={styles.progressBuf} style={{ width: `${bufPct()}%` }} />
            <div class={styles.progressFill} style={{ width: `${pct()}%` }} />
          </div>
          <div class={styles.progressThumb} style={{ left: `${pct()}%` }} />
        </div>

        <div class={styles.bottomRow}>
          <span class={styles.time}>{fmt(currentTime())} / {fmt(duration())}</span>
          <div class={styles.spacer} />

          <button class={styles.speedBtn} onClick={cycleSpeed} title="Speed">
            {SPEEDS[speedIdx()]}x
          </button>

          <Show when={'pictureInPictureEnabled' in document}>
            <button class={styles.ctrlBtn} onClick={togglePiP} title="Picture-in-Picture">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <rect x="12" y="9" width="8" height="6" rx="1" />
              </svg>
            </button>
          </Show>

          <button class={styles.ctrlBtn} onClick={toggleFullscreen} title="Fullscreen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
