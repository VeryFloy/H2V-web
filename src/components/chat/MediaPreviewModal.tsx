import { type Component, createSignal, Show, For, onMount, onCleanup } from 'solid-js';
import { i18n } from '../../stores/i18n.store';
import styles from './MediaPreviewModal.module.css';

export interface MediaPreviewFile {
  file: File;
  blobUrl: string;
  fileType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE';
}

interface Props {
  mediaList: MediaPreviewFile[];
  onSend: (items: { file: File; caption: string; asDocument: boolean }[]) => void;
  onCancel: () => void;
  onAddMore: (files: File[]) => void;
  onRemove: (index: number) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function gridClass(n: number): string {
  if (n <= 1) return '';
  if (n >= 10) return styles.previewGrid10;
  return (styles as Record<string, string>)[`previewGrid${n}`] ?? '';
}

const MediaPreviewModal: Component<Props> = (props) => {
  const [caption, setCaption] = createSignal('');
  const [asDoc, setAsDoc] = createSignal(false);
  const [dropHover, setDropHover] = createSignal(false);
  let captionRef!: HTMLInputElement;
  let _dropCounter = 0;

  const count = () => props.mediaList.length;
  const visuals = () => props.mediaList.filter(f => !asDoc() && (f.fileType === 'IMAGE' || f.fileType === 'VIDEO'));
  const hasMultipleVisuals = () => visuals().length > 1;

  const titleKey = () => {
    const n = count();
    if (n === 0) return '';
    if (asDoc()) return `${i18n.t('media_preview.send_file')} (${n})`;
    const f = props.mediaList[0];
    if (!f) return '';
    switch (f.fileType) {
      case 'IMAGE': return n > 1 ? `${i18n.t('media_preview.send_image')} (${n})` : i18n.t('media_preview.send_image');
      case 'VIDEO': return n > 1 ? `${i18n.t('media_preview.send_video')} (${n})` : i18n.t('media_preview.send_video');
      default: return n > 1 ? `${i18n.t('media_preview.send_file')} (${n})` : i18n.t('media_preview.send_file');
    }
  };

  function handleSend() {
    props.onSend(props.mediaList.map((m) => ({
      file: m.file,
      caption: caption().trim(),
      asDocument: asDoc(),
    })));
  }

  function handleAddMore() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt';
    inp.onchange = () => {
      if (inp.files && inp.files.length > 0) {
        props.onAddMore(Array.from(inp.files));
      }
    };
    inp.click();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') props.onCancel();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      props.onAddMore(files);
    }
  }

  function onModalDragEnter(e: DragEvent) {
    e.preventDefault();
    _dropCounter++;
    if (e.dataTransfer?.types.includes('Files')) setDropHover(true);
  }
  function onModalDragOver(e: DragEvent) { e.preventDefault(); }
  function onModalDragLeave(e: DragEvent) {
    e.preventDefault();
    _dropCounter--;
    if (_dropCounter <= 0) { _dropCounter = 0; setDropHover(false); }
  }
  function onModalDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    _dropCounter = 0;
    setDropHover(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) props.onAddMore(Array.from(files));
  }

  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste);
    requestAnimationFrame(() => captionRef?.focus());
  });
  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('paste', onPaste);
  });

  return (
    <div class={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div
        class={`${styles.modal} ${dropHover() ? styles.modalDropHover : ''}`}
        onDragEnter={onModalDragEnter}
        onDragOver={onModalDragOver}
        onDragLeave={onModalDragLeave}
        onDrop={onModalDrop}
      >
        <div class={styles.header}>
          <span>{titleKey()}</span>
          <div class={styles.headerActions}>
            <button class={styles.addBtn} onClick={handleAddMore} title={i18n.t('media_preview.add') || 'Add more'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <button class={styles.closeBtn} onClick={props.onCancel}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div class={styles.preview}>
          <Show when={dropHover()}>
            <div class={styles.dropZone}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M12 15V3m0 0l-4 4m4-4l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>{i18n.t('media_preview.drop_here') || 'Drop files here'}</span>
            </div>
          </Show>

          {/* Single file preview */}
          <Show when={!dropHover() && !hasMultipleVisuals() && count() === 1}>
            {(() => {
              const f = () => props.mediaList[0];
              const isVis = () => f() && !asDoc() && (f()!.fileType === 'IMAGE' || f()!.fileType === 'VIDEO');
              return (
                <>
                  <Show when={isVis() && f()!.fileType === 'IMAGE'}>
                    <img class={styles.previewImg} src={f()!.blobUrl} alt="" />
                  </Show>
                  <Show when={isVis() && f()!.fileType === 'VIDEO'}>
                    <video class={styles.previewVideo} src={f()!.blobUrl} controls />
                  </Show>
                  <Show when={!isVis()}>
                    <div class={styles.previewFile}>
                      <div class={styles.previewFileIcon}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/>
                          <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8"/>
                        </svg>
                      </div>
                      <div class={styles.previewFileInfo}>
                        <div class={styles.previewFileName}>{f()!.file.name}</div>
                        <div class={styles.previewFileSize}>{formatSize(f()!.file.size)}</div>
                      </div>
                    </div>
                  </Show>
                </>
              );
            })()}
          </Show>

          {/* Grouped grid preview for multiple visuals */}
          <Show when={!dropHover() && (hasMultipleVisuals() || count() > 1)}>
            <div class={`${styles.previewGridWrap} ${gridClass(Math.min(props.mediaList.length, 10))}`}>
              <For each={props.mediaList.slice(0, 10)}>
                {(item, idx) => (
                  <div class={styles.previewGridCell}>
                    <Show when={!asDoc() && item.fileType === 'IMAGE'}>
                      <img src={item.blobUrl} alt="" />
                    </Show>
                    <Show when={!asDoc() && item.fileType === 'VIDEO'}>
                      <video src={item.blobUrl} />
                      <div class={styles.previewGridPlay}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21" /></svg>
                      </div>
                    </Show>
                    <Show when={asDoc() || (item.fileType !== 'IMAGE' && item.fileType !== 'VIDEO')}>
                      <div class={styles.previewGridDoc}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/>
                        </svg>
                        <span>{item.file.name.length > 12 ? item.file.name.slice(0, 10) + '...' : item.file.name}</span>
                      </div>
                    </Show>
                    {/* Remove button */}
                    <button class={styles.previewGridRemove} onClick={(e) => { e.stopPropagation(); props.onRemove(idx()); }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                      </svg>
                    </button>
                    <Show when={idx() === 9 && props.mediaList.length > 10}>
                      <div class={styles.previewGridMore}>+{props.mediaList.length - 10}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class={styles.body}>
          <Show when={visuals().length > 0}>
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
            <input
              ref={captionRef!}
              class={styles.captionInput}
              value={caption()}
              onInput={(e) => setCaption(e.currentTarget.value)}
              placeholder={i18n.t('media_preview.caption_placeholder') || 'Add a caption...'}
            />
          </div>
        </div>

        <div class={styles.footer}>
          <button class={styles.cancelBtn} onClick={props.onCancel}>
            {i18n.t('common.cancel')}
          </button>
          <button class={styles.sendBtn} onClick={handleSend}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M22 2L15 22l-4-9-9-4L22 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            {count() > 1 ? `${i18n.t('common.send')} (${count()})` : i18n.t('common.send')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MediaPreviewModal;
