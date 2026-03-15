import { createSignal, createEffect, Show, on, onCleanup } from 'solid-js';
import { request } from '../../api/client';
import styles from './LinkPreview.module.css';

interface PreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const previewCache = new Map<string, PreviewData>();

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/;

const isVideoUrl = (url: string) =>
  /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/|vimeo\.com\/\d/.test(url);

interface Props {
  text: string;
}

export default function LinkPreview(props: Props) {
  const [preview, setPreview] = createSignal<PreviewData | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [imgLoaded, setImgLoaded] = createSignal(false);

  const extractedUrl = () => {
    const match = props.text.match(URL_RE);
    return match?.[0] ?? null;
  };

  let abortCtrl: AbortController | null = null;

  createEffect(on(extractedUrl, (url) => {
    abortCtrl?.abort();
    abortCtrl = null;
    setPreview(null);
    setLoading(false);
    setImgLoaded(false);
    if (!url) return;

    const cached = previewCache.get(url);
    if (cached) {
      setPreview(cached);
      return;
    }

    setLoading(true);
    const ctrl = new AbortController();
    abortCtrl = ctrl;

    request<{ success: boolean; data: PreviewData }>(`/link-preview?url=${encodeURIComponent(url)}`, { signal: ctrl.signal }).then((res) => {
      if (ctrl.signal.aborted) return;
      setLoading(false);
      const data = res?.data;
      if (data && (data.title || data.description || data.image)) {
        previewCache.set(url, data);
        setPreview(data);
      }
    }).catch(() => {
      if (!ctrl.signal.aborted) setLoading(false);
    });
  }));

  onCleanup(() => abortCtrl?.abort());

  const hasText = () => {
    const p = preview();
    return p && (p.siteName || p.title || p.description);
  };

  return (
    <>
      <Show when={loading()}>
        <div class={styles.skeleton}>
          <div class={styles.skeletonBar} style="width:35%" />
          <div class={styles.skeletonBar} style="width:90%" />
          <div class={styles.skeletonBar} style="width:65%" />
          <div class={styles.skeletonImg} />
        </div>
      </Show>
      <Show when={preview()}>
        {(p) => (
          <a href={p().url} target="_blank" rel="noopener noreferrer" class={styles.card}>
            <Show when={hasText()}>
              <div class={styles.textBlock}>
                <Show when={p().siteName}>
                  <span class={styles.site}>{p().siteName}</span>
                </Show>
                <Show when={p().title}>
                  <span class={styles.title}>{p().title}</span>
                </Show>
                <Show when={p().description}>
                  <span class={styles.desc}>{p().description!.slice(0, 200)}</span>
                </Show>
              </div>
            </Show>
            <Show when={p().image}>
              <div class={styles.imageWrap}>
                <div class={`${styles.imageSkeleton} ${imgLoaded() ? styles.imageSkeletonHidden : ''}`} />
                <img
                  src={p().image!}
                  alt=""
                  class={`${styles.image} ${imgLoaded() ? styles.imageVisible : ''}`}
                  loading="lazy"
                  onLoad={() => setImgLoaded(true)}
                  onError={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    if (!el.dataset.fell && el.src.includes('maxresdefault')) {
                      el.dataset.fell = '1';
                      el.src = el.src.replace('maxresdefault', 'hqdefault');
                    } else {
                      el.style.display = 'none';
                    }
                  }}
                />
                <Show when={isVideoUrl(p().url)}>
                  <div class={styles.playOverlay}>
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                      <circle cx="24" cy="24" r="24" fill="rgba(0,0,0,0.55)" />
                      <path d="M19 15l14 9-14 9V15z" fill="#fff" />
                    </svg>
                  </div>
                </Show>
              </div>
            </Show>
          </a>
        )}
      </Show>
    </>
  );
}
