import { createSignal, createEffect, Show, on } from 'solid-js';
import { request } from '../../api/client';
import styles from './LinkPreview.module.css';

interface PreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const previewCache = new Map<string, PreviewData | null>();

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/;

interface Props {
  text: string;
}

export default function LinkPreview(props: Props) {
  const [preview, setPreview] = createSignal<PreviewData | null>(null);

  const extractedUrl = () => {
    const match = props.text.match(URL_RE);
    return match?.[0] ?? null;
  };

  createEffect(on(extractedUrl, (url) => {
    setPreview(null);
    if (!url) return;

    const cached = previewCache.get(url);
    if (cached !== undefined) {
      setPreview(cached);
      return;
    }

    request<{ success: boolean; data: PreviewData }>(`/link-preview?url=${encodeURIComponent(url)}`).then((res) => {
      const data = res?.data;
      if (data && (data.title || data.description || data.image)) {
        previewCache.set(url, data);
        setPreview(data);
      } else {
        previewCache.set(url, null);
      }
    }).catch(() => {
      previewCache.set(url, null);
    });
  }));

  return (
    <Show when={preview()}>
      {(p) => (
        <a href={p().url} target="_blank" rel="noopener noreferrer" class={styles.card}>
          <Show when={p().image}>
            <img src={p().image!} alt="" class={styles.image} loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          </Show>
          <div class={styles.info}>
            <Show when={p().siteName}>
              <span class={styles.site}>{p().siteName}</span>
            </Show>
            <Show when={p().title}>
              <span class={styles.title}>{p().title}</span>
            </Show>
            <Show when={p().description}>
              <span class={styles.desc}>{p().description!.slice(0, 150)}</span>
            </Show>
          </div>
        </a>
      )}
    </Show>
  );
}
