import {
  type Component, type Accessor, type Setter,
  createSignal, createEffect, Show, For, onCleanup, onMount, on,
} from 'solid-js';
// Portal removed — link preview modal is rendered via raw DOM
import { wsStore } from '../../stores/ws.store';
import { settingsStore } from '../../stores/settings.store';
import { e2eStore } from '../../stores/e2e.store';
import { i18n } from '../../stores/i18n.store';
import type { Message } from '../../types';
import EmojiPicker from '../ui/EmojiPicker';
import styles from './ChatInput.module.css';

interface ChatInputProps {
  text: Accessor<string>;
  setText: Setter<string>;
  editingId: Accessor<string | null>;
  setEditingId: Setter<string | null>;
  editText: Accessor<string>;
  setEditText: Setter<string>;
  replyTo: Accessor<Message | null>;
  setReplyTo: Setter<Message | null>;
  uploading: Accessor<boolean>;
  actionError: Accessor<string>;
  blockedByThem: () => boolean;
  onSend: (e?: Event) => void;
  onEdit: (e?: Event) => void;
  onFileUpload: (files: File[]) => void;
  onVoiceRecord: (file: File) => void;
  onTyping: () => void;
  onActionError: (msg: string) => void;
  onEditLastMessage?: () => void;
}

const REC_VIS_BARS = 32;

const ChatInput: Component<ChatInputProps> = (props) => {
  const [showEmoji, setShowEmoji] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [recordTimeMs, setRecordTimeMs] = createSignal(0);
  const [recWaveBars, setRecWaveBars] = createSignal<number[]>([]);
  const [hasSelection, setHasSelection] = createSignal(false);

  let editorRef!: HTMLDivElement;
  let fileInputRef!: HTMLInputElement;
  let mediaRecorder: MediaRecorder | null = null;
  let recordChunks: Blob[] = [];
  let recordTimerInterval: ReturnType<typeof setInterval> | null = null;
  let recordStartTs = 0;
  let recordCancelled = false;
  let recAudioCtx: AudioContext | null = null;
  let recAnalyser: AnalyserNode | null = null;
  let recAnimFrame: number | null = null;
  let _lastMd = '';
  let _savedRange: Range | null = null;

  /* ── Link preview above input ── */
  interface LinkPreviewData { url: string; title: string | null; description: string | null; image: string | null; siteName: string | null; }
  const [lpData, setLpData] = createSignal<LinkPreviewData | null>(null);
  const [lpDismissed, setLpDismissed] = createSignal<string | null>(null);
  const [lpAbove, setLpAbove] = createSignal(true);
  let _lpDebounce: ReturnType<typeof setTimeout> | null = null;
  let _lpAbort: AbortController | null = null;
  let _lpModalRoot: HTMLDivElement | null = null;

  const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/;

  function fetchLinkPreview(md: string) {
    if (_lpDebounce) clearTimeout(_lpDebounce);
    const match = md.match(URL_RE);
    if (!match) { setLpData(null); setLpDismissed(null); return; }
    const url = match[0];
    if (lpDismissed() === url) return;
    if (lpData()?.url === url) return;
    _lpDebounce = setTimeout(async () => {
      _lpAbort?.abort();
      const ctrl = new AbortController();
      _lpAbort = ctrl;
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
          signal: ctrl.signal,
          credentials: 'include',
        });
        if (ctrl.signal.aborted || !res.ok) return;
        const json = await res.json();
        if (ctrl.signal.aborted) return;
        const d = json?.data as LinkPreviewData | undefined;
        if (d && (d.title || d.description || d.image || d.siteName)) {
          setLpData({ ...d, url });
        }
      } catch {}
    }, 400);
  }

  createEffect(on(() => props.text(), fetchLinkPreview));

  function lpDismiss() {
    const d = lpData();
    if (d) setLpDismissed(d.url);
    setLpData(null);
    lpCloseModal();
  }

  function lpOpenModal() {
    if (_lpModalRoot || !lpData()) return;
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(root);
    _lpModalRoot = root;

    function renderModal() {
      const d = lpData();
      if (!d) { lpCloseModal(); return; }
      const above = lpAbove();
      const proxyImg = d.image ? `/api/link-preview/proxy?url=${encodeURIComponent(d.image)}` : '';

      const card = `<div style="display:flex;flex-direction:column;gap:2px;margin-bottom:4px;">
        ${d.siteName ? `<span style="font-size:11px;font-weight:600;color:var(--accent);">${esc(d.siteName)}</span>` : ''}
        ${d.title ? `<span style="font-size:13px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.title)}</span>` : ''}
        ${d.description ? `<span style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.description.slice(0, 120))}</span>` : ''}
        ${proxyImg ? `<img src="${esc(proxyImg)}" alt="" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-top:6px;" />` : ''}
      </div>`;

      root.innerHTML = `<div style="background:var(--bg-panel);border:1px solid var(--border-primary);border-radius:16px;padding:20px;width:90%;max-width:360px;box-shadow:0 16px 48px var(--shadow-modal);" data-lp-modal>
        <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:16px;">${esc(i18n.t('lp.settings_title'))}</div>
        <div style="background:var(--bg-card);border-radius:12px;padding:12px;margin-bottom:16px;">
          ${above ? card : ''}<div style="font-size:12px;color:var(--accent);word-break:break-all;">${esc(d.url)}</div>${above ? '' : card}
        </div>
        <button type="button" data-lp-move style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;background:none;border:none;border-radius:10px;font-size:14px;color:var(--text-primary);cursor:pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="${above ? 'M12 5v14M5 12l7 7 7-7' : 'M12 19V5M5 12l7-7 7 7'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${esc(above ? i18n.t('lp.move_below') : i18n.t('lp.move_above'))}
        </button>
        <button type="button" data-lp-remove style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;background:none;border:none;border-radius:10px;font-size:14px;color:var(--text-primary);cursor:pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          ${esc(i18n.t('lp.remove'))}
        </button>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;border-top:1px solid var(--border-subtle);padding-top:14px;">
          <button type="button" data-lp-cancel style="padding:8px 18px;border-radius:10px;border:none;background:var(--bg-input);color:var(--text-secondary);font-size:14px;cursor:pointer;">${esc(i18n.t('common.cancel'))}</button>
          <button type="button" data-lp-save style="padding:8px 18px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-weight:600;font-size:14px;cursor:pointer;">${esc(i18n.t('lp.save'))}</button>
        </div>
      </div>`;
    }

    function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    renderModal();

    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-lp-modal]') && !target.closest('button')) return;
      if (target.closest('[data-lp-move]')) { setLpAbove(!lpAbove()); renderModal(); return; }
      if (target.closest('[data-lp-remove]')) { lpDismiss(); return; }
      if (target.closest('[data-lp-cancel]') || target.closest('[data-lp-save]')) { lpCloseModal(); return; }
      lpCloseModal();
    });
  }

  function lpCloseModal() {
    if (_lpModalRoot) {
      _lpModalRoot.remove();
      _lpModalRoot = null;
    }
  }

  onCleanup(() => { _lpAbort?.abort(); if (_lpDebounce) clearTimeout(_lpDebounce); lpCloseModal(); });

  /* ── Markdown ↔ HTML ── */
  function escHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function mdToHtml(md: string): string {
    if (!md) return '';
    return md.split('\n').map(line => {
      if (line.startsWith('> ')) {
        return `<blockquote class="${styles.fmtQuote}">${escHtml(line.slice(2))}</blockquote>`;
      }
      return escHtml(line)
        .replace(/`([^`\n]+)`/g, `<code class="${styles.fmtCode}">$1</code>`)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/\|\|([^|]+?)\|\|/g, `<span class="${styles.fmtSpoiler}" data-spoiler>$1</span>`);
    }).join('<br>');
  }

  function htmlToMd(el: HTMLElement): string {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        out += (n.textContent ?? '').replace(/\u200B/g, '');
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const e = n as HTMLElement;
        const tag = e.tagName;
        const inner = htmlToMd(e);
        if (tag === 'STRONG' || tag === 'B') out += `**${inner}**`;
        else if (tag === 'EM' || tag === 'I') out += `*${inner}*`;
        else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') out += `~~${inner}~~`;
        else if (tag === 'CODE') out += `\`${inner}\``;
        else if (e.hasAttribute('data-spoiler') || e.classList.contains(styles.fmtSpoiler))
          out += `||${inner}||`;
        else if (tag === 'BLOCKQUOTE') {
          const lines = inner.split('\n').map(l => `> ${l}`).join('\n');
          if (out && !out.endsWith('\n')) out += '\n';
          out += lines;
          if (!out.endsWith('\n')) out += '\n';
        } else if (tag === 'BR') out += '\n';
        else if (tag === 'DIV') {
          if (out && !out.endsWith('\n')) out += '\n';
          out += inner;
        } else out += inner;
      }
    }
    return out;
  }

  /* ── Auto-format: convert typed markdown tokens into styled elements ── */
  function tryAutoFormat(): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.focusNode || sel.focusNode.nodeType !== Node.TEXT_NODE) return false;
    if (!editorRef.contains(sel.focusNode)) return false;
    const node = sel.focusNode as Text;
    const text = node.textContent || '';
    const cursor = sel.focusOffset;
    const before = text.slice(0, cursor);

    const patterns: [RegExp, (c: string) => HTMLElement][] = [
      [/\*\*(.+?)\*\*$/, c => { const el = document.createElement('strong'); el.textContent = c; return el; }],
      [/(?<!\*)\*([^*\n]+?)\*$/, c => { const el = document.createElement('em'); el.textContent = c; return el; }],
      [/~~(.+?)~~$/, c => { const el = document.createElement('s'); el.textContent = c; return el; }],
      [/`([^`\n]+)`$/, c => { const el = document.createElement('code'); el.className = styles.fmtCode; el.textContent = c; return el; }],
      [/\|\|([^|]+?)\|\|$/, c => { const el = document.createElement('span'); el.className = styles.fmtSpoiler; el.setAttribute('data-spoiler', ''); el.textContent = c; return el; }],
    ];

    for (const [re, create] of patterns) {
      const m = before.match(re);
      if (!m || m.index === undefined) continue;
      const el = create(m[1]);
      const beforeMatch = text.slice(0, m.index);
      const afterMatch = text.slice(m.index + m[0].length);

      // Replace text node with: [beforeText] <el> ZWS [afterText]
      const parent = node.parentNode!;
      const frag = document.createDocumentFragment();
      if (beforeMatch) frag.appendChild(document.createTextNode(beforeMatch));
      frag.appendChild(el);
      const zws = document.createTextNode('\u200B');
      frag.appendChild(zws);
      if (afterMatch) frag.appendChild(document.createTextNode(afterMatch));
      parent.replaceChild(frag, node);

      const r = document.createRange();
      r.setStartAfter(zws);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }
    return false;
  }

  function checkSelection() {
    const sel = window.getSelection();
    setHasSelection(!!sel && !sel.isCollapsed && !!editorRef?.contains(sel.anchorNode));
  }

  function updatePlaceholder() {
    if (!editorRef) return;
    editorRef.toggleAttribute('data-empty', !editorRef.textContent?.trim());
  }

  function saveCursor() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef?.contains(sel.anchorNode)) {
      _savedRange = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreCursor() {
    if (!_savedRange || !editorRef) return;
    editorRef.focus();
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(_savedRange); }
    _savedRange = null;
  }

  function handleInput() {
    tryAutoFormat();
    updatePlaceholder();
    const md = htmlToMd(editorRef);
    _lastMd = md;
    props.setText(md);
    props.onTyping();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' && !props.text().trim() && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      props.onEditLastMessage?.();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey) {
      if (e.key === 'b') { e.preventDefault(); document.execCommand('bold'); handleInput(); return; }
      if (e.key === 'i') { e.preventDefault(); document.execCommand('italic'); handleInput(); return; }
      if (e.key === 'e') { e.preventDefault(); wrapSelWith('code', styles.fmtCode); return; }
    }
    if (mod && e.shiftKey) {
      if (e.key === 'X' || e.key === 'x') { e.preventDefault(); document.execCommand('strikeThrough'); handleInput(); return; }
      if (e.key === 'P' || e.key === 'p') { e.preventDefault(); wrapSelWith('span', styles.fmtSpoiler, true); return; }
    }
    const s = settingsStore.settings().sendByEnter;
    if (s && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); props.onSend(); }
    if (!s && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); props.onSend(); }
  }

  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  }

  function wrapSelWith(tag: string, cls?: string, spoiler?: boolean) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (spoiler) el.setAttribute('data-spoiler', '');
    try { range.surroundContents(el); } catch {
      const fragment = range.extractContents();
      el.appendChild(fragment);
      range.insertNode(el);
    }
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.addRange(r);
    handleInput();
  }

  function insertQuoteBlock() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const text = sel.toString();
    if (!text) return;
    const quoted = text.split('\n').map(l => `> ${l}`).join('\n');
    document.execCommand('insertText', false, quoted);
    handleInput();
  }

  // Attach native input listener (SolidJS delegation can miss contentEditable events)
  onMount(() => {
    editorRef.addEventListener('input', handleInput);
    updatePlaceholder();
  });
  onCleanup(() => editorRef?.removeEventListener('input', handleInput));

  // Sync external text changes (emoji picker, draft load, send-clear)
  createEffect(() => {
    const md = props.text();
    if (md === _lastMd) return;
    _lastMd = md;
    if (!editorRef) return;
    editorRef.innerHTML = mdToHtml(md);
    updatePlaceholder();
  });

  /* ── Voice recording (unchanged) ── */
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
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        stream?.getTracks().forEach(t => t.stop());
        stopRecAnalyser();
        if (recordCancelled || recordChunks.length === 0) return;
        const blob = new Blob(recordChunks, { type: mimeType });
        const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
        props.onVoiceRecord(file);
      };
      mediaRecorder.start(200);
      startRecAnalyser(stream);
      setRecording(true);
      recordStartTs = Date.now();
      setRecordTimeMs(0);
      recordTimerInterval = setInterval(() => setRecordTimeMs(Date.now() - recordStartTs), 50);
    } catch {
      stream?.getTracks().forEach(t => t.stop());
      props.onActionError(i18n.t('msg.mic_denied') || 'Microphone access denied');
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
    return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  }

  onCleanup(() => {
    if (recordTimerInterval) clearInterval(recordTimerInterval);
    stopRecAnalyser();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
  });

  return (
    <>
      {/* Reply bar */}
      <Show when={props.replyTo()}>
        <div class={styles.replyBar}>
          <div class={styles.replyBarAccent} />
          <div class={styles.replyBarContent}>
            <span class={styles.replyBarSender}>{props.replyTo()!.sender?.nickname}</span>
            <span class={styles.replyBarText}>
              {props.replyTo()!.text ?? e2eStore.getDecryptedText(props.replyTo()!.id) ?? i18n.t('common.media')}
            </span>
          </div>
          <button class={styles.replyBarClose} onClick={() => props.setReplyTo(null)} aria-label="Close">✕</button>
        </div>
      </Show>

      {/* Link preview bar */}
      <Show when={lpData()}>
        <div class={styles.lpBar} ref={(el: HTMLDivElement) => {
          el.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('[data-lp-x]')) {
              e.stopPropagation();
              lpDismiss();
            } else {
              lpOpenModal();
            }
          });
        }}>
          <div class={styles.lpAccent} />
          <div class={styles.lpContent}>
            {lpData()!.siteName && <span class={styles.lpSite}>{lpData()!.siteName}</span>}
            {lpData()!.title && <span class={styles.lpTitle}>{lpData()!.title}</span>}
            {lpData()!.description && <span class={styles.lpDesc}>{lpData()!.description!.slice(0, 100)}</span>}
          </div>
          {lpData()!.image && <img class={styles.lpThumb} src={`/api/link-preview/proxy?url=${encodeURIComponent(lpData()!.image!)}`} alt="" />}
          <button type="button" data-lp-x class={styles.lpClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </Show>

      {/* Action error toast */}
      <Show when={props.actionError()}>
        <div class={styles.actionError}>{props.actionError()}</div>
      </Show>

      {/* Blocked banner */}
      <Show when={props.blockedByThem()}>
        <div class={styles.blockedBanner}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="currentColor" stroke-width="2"/></svg>
          {i18n.t('msg.blocked_by_user')}
        </div>
      </Show>
      <Show when={!props.blockedByThem()}>
      <Show
        when={!props.editingId()}
        fallback={
          <form class={styles.inputRow} onSubmit={props.onEdit}>
            <textarea class={`${styles.input} ${styles.inputEdit}`} value={props.editText()} rows={1}
              maxLength={10000}
              onInput={(e) => { props.setEditText(e.currentTarget.value); const el = e.currentTarget; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,140)+'px'; }}
              onKeyDown={(e) => { if (e.key==='Escape') props.setEditingId(null); if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();props.onEdit();} }}
              autofocus placeholder={i18n.t('msg.edit') + '...'} />
            <button class={styles.btnSave} type="submit" aria-label={i18n.t('common.save') || 'Save'}>✓</button>
            <button class={styles.btnCancel} type="button" onClick={() => props.setEditingId(null)} aria-label={i18n.t('common.cancel') || 'Cancel'}>✕</button>
          </form>
        }
      >
        <form class={styles.inputRow} onSubmit={props.onSend} style={{ display: recording() ? 'none' : undefined }}>
            <input type="file" ref={fileInputRef!} style="display:none" multiple
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt"
              onChange={(e) => { const files = e.currentTarget.files; if (files && files.length > 0) props.onFileUpload(Array.from(files)); e.currentTarget.value=''; }} />
            <button type="button" class={styles.btnAttach}
              onClick={() => fileInputRef?.click()}
              disabled={props.uploading() || !wsStore.connected()}
              aria-label={i18n.t('msg.attach') || 'Attach file'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div style="position:relative">
              <button type="button" class={styles.btnEmoji}
                onClick={() => setShowEmoji(!showEmoji())}
                aria-label={i18n.t('msg.emoji') || 'Emoji'}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <circle cx="9" cy="9.5" r="1" fill="currentColor"/>
                  <circle cx="15" cy="9.5" r="1" fill="currentColor"/>
                </svg>
              </button>
              <Show when={showEmoji()}>
                <EmojiPicker
                  onSelect={(emoji) => {
                    restoreCursor();
                    document.execCommand('insertText', false, emoji);
                    handleInput();
                    setShowEmoji(false);
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              </Show>
            </div>
            <div class={styles.inputWrap}>
            <Show when={hasSelection()}>
              <div class={styles.fmtToolbar}>
                <button type="button" class={styles.fmtBtn} onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); handleInput(); }} title="Bold (Ctrl+B)"><strong>B</strong></button>
                <button type="button" class={styles.fmtBtn} onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); handleInput(); }} title="Italic (Ctrl+I)"><em>I</em></button>
                <button type="button" class={styles.fmtBtn} onMouseDown={(e) => { e.preventDefault(); document.execCommand('strikeThrough'); handleInput(); }} title="Strikethrough (Ctrl+Shift+X)"><s>S</s></button>
                <button type="button" class={styles.fmtBtn} onMouseDown={(e) => { e.preventDefault(); wrapSelWith('code', styles.fmtCode); }} title="Code (Ctrl+E)"><code style={{ 'font-family': 'monospace', 'font-size': '13px' }}>M</code></button>
                <button type="button" class={styles.fmtBtn} onMouseDown={(e) => { e.preventDefault(); wrapSelWith('span', styles.fmtSpoiler, true); }} title="Spoiler (Ctrl+Shift+P)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="currentColor" stroke-width="2"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <button type="button" class={styles.fmtBtn} onMouseDown={(e) => { e.preventDefault(); insertQuoteBlock(); }} title="Quote">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" opacity="0.7"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" opacity="0.7"/></svg>
                </button>
              </div>
            </Show>
            <div
              ref={editorRef!}
              contentEditable={wsStore.connected()}
              class={styles.inputWysiwyg}
              data-chat-input
              data-placeholder={i18n.t('msg.placeholder')}
              data-empty
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onSelect={checkSelection}
              onMouseUp={checkSelection}
              onKeyUp={checkSelection}
              onBlur={() => { saveCursor(); setHasSelection(false); }}
            />
            </div>
            <Show when={props.text().trim()} fallback={
              <button class={styles.btnMic} type="button" onClick={startRecording} disabled={!wsStore.connected()} aria-label={i18n.t('msg.voice') || 'Voice message'}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="1" width="6" height="14" rx="3" stroke="currentColor" stroke-width="2"/>
                  <path d="M5 10a7 7 0 0014 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            }>
              <button class={styles.btnSend} type="submit" disabled={!props.text().trim() || !wsStore.connected()} aria-label={i18n.t('common.send') || 'Send'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </Show>
          </form>
        <Show when={recording()}>
          <div class={styles.recRow}>
            <button class={styles.btnRecCancel} type="button" onClick={() => stopRecording(false)} aria-label={i18n.t('common.cancel') || 'Cancel'}>
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
            <button class={styles.btnRecSend} type="button" onClick={() => stopRecording(true)} aria-label={i18n.t('common.send') || 'Send'}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </Show>
      </Show>
      </Show>
    </>
  );
};

export default ChatInput;
