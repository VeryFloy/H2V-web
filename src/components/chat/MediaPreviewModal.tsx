import { type Component, createSignal, Show, onMount, onCleanup } from 'solid-js';
import { i18n } from '../../stores/i18n.store';
import styles from './MediaPreviewModal.module.css';

export interface MediaPreviewFile {
  file: File;
  blobUrl: string;
  fileType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE';
}

interface Props {
  media: MediaPreviewFile;
  onSend: (file: File, caption: string, asDocument: boolean) => void;
  onCancel: () => void;
  onAddMore: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const MediaPreviewModal: Component<Props> = (props) => {
  const [caption, setCaption] = createSignal('');
  const [asDoc, setAsDoc] = createSignal(false);
  let captionRef!: HTMLInputElement;

  const titleKey = () => {
    if (asDoc()) return i18n.t('media_preview.send_file');
    switch (props.media.fileType) {
      case 'IMAGE': return i18n.t('media_preview.send_image');
      case 'VIDEO': return i18n.t('media_preview.send_video');
      default: return i18n.t('media_preview.send_file');
    }
  };

  const isVisual = () =>
    !asDoc() && (props.media.fileType === 'IMAGE' || props.media.fileType === 'VIDEO');

  function handleSend() {
    props.onSend(props.media.file, caption().trim(), asDoc());
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') props.onCancel();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => captionRef?.focus());
  });
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  return (
    <div class={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div class={styles.modal}>
        <div class={styles.header}>
          <span>{titleKey()}</span>
          <button class={styles.closeBtn} onClick={props.onCancel}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div class={styles.preview}>
          <Show when={isVisual() && props.media.fileType === 'IMAGE'}>
            <img class={styles.previewImg} src={props.media.blobUrl} alt="" />
          </Show>
          <Show when={isVisual() && props.media.fileType === 'VIDEO'}>
            <video class={styles.previewVideo} src={props.media.blobUrl} controls />
          </Show>
          <Show when={!isVisual()}>
            <div class={styles.previewFile}>
              <div class={styles.previewFileIcon}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/>
                  <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/>
                </svg>
              </div>
              <div class={styles.previewFileInfo}>
                <div class={styles.previewFileName}>{props.media.file.name}</div>
                <div class={styles.previewFileSize}>{formatSize(props.media.file.size)}</div>
              </div>
            </div>
          </Show>
        </div>

        <div class={styles.body}>
          <Show when={props.media.fileType === 'IMAGE' || props.media.fileType === 'VIDEO'}>
            <label class={styles.docToggle} onClick={() => setAsDoc(!asDoc())}>
              <div class={`${styles.checkbox} ${asDoc() ? styles.checkboxChecked : ''}`}>
                <Show when={asDoc()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </Show>
              </div>
              {i18n.t('media_preview.as_document')}
            </label>
          </Show>

          <div class={styles.captionRow}>
            <span class={styles.captionLabel}>{i18n.t('media_preview.caption')}</span>
            <input
              ref={captionRef!}
              class={styles.captionInput}
              value={caption()}
              onInput={(e) => setCaption(e.currentTarget.value)}
              placeholder={i18n.t('media_preview.caption_placeholder')}
            />
          </div>
        </div>

        <div class={styles.footer}>
          <div class={styles.footerLeft}>
            <button class={styles.addBtn} onClick={props.onAddMore}>
              {i18n.t('media_preview.add')}
            </button>
          </div>
          <div class={styles.footerRight}>
            <button class={styles.cancelBtn} onClick={props.onCancel}>
              {i18n.t('common.cancel')}
            </button>
            <button class={styles.sendBtn} onClick={handleSend}>
              {i18n.t('common.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MediaPreviewModal;
