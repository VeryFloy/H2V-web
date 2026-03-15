import {
  type Component, type Accessor, type Setter,
  createSignal, createEffect, Show, For, onCleanup,
} from 'solid-js';
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
}

const REC_VIS_BARS = 32;

const ChatInput: Component<ChatInputProps> = (props) => {
  const [showEmoji, setShowEmoji] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [recordTimeMs, setRecordTimeMs] = createSignal(0);
  const [recWaveBars, setRecWaveBars] = createSignal<number[]>([]);

  let textareaRef!: HTMLTextAreaElement;
  let fileInputRef!: HTMLInputElement;
  let mediaRecorder: MediaRecorder | null = null;
  let recordChunks: Blob[] = [];
  let recordTimerInterval: ReturnType<typeof setInterval> | null = null;
  let recordStartTs = 0;
  let recordCancelled = false;
  let recAudioCtx: AudioContext | null = null;
  let recAnalyser: AnalyserNode | null = null;
  let recAnimFrame: number | null = null;

  function resizeTextarea() {
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 140) + 'px';
  }

  createEffect(() => {
    if (!props.text() && textareaRef) {
      textareaRef.style.height = 'auto';
    }
  });

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        stream.getTracks().forEach(t => t.stop());
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
    return `${m}:${s.toString().padStart(2, '0')},${cs.toString().padStart(2, '0')}`;
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
          <button class={styles.replyBarClose} onClick={() => props.setReplyTo(null)}>✕</button>
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
              onInput={(e) => { props.setEditText(e.currentTarget.value); const el = e.currentTarget; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,140)+'px'; }}
              onKeyDown={(e) => { if (e.key==='Escape') props.setEditingId(null); if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();props.onEdit();} }}
              autofocus placeholder={i18n.t('msg.edit') + '...'} />
            <button class={styles.btnSave} type="submit">✓</button>
            <button class={styles.btnCancel} type="button" onClick={() => props.setEditingId(null)}>✕</button>
          </form>
        }
      >
        <form class={styles.inputRow} onSubmit={props.onSend} style={{ display: recording() ? 'none' : undefined }}>
            <input type="file" ref={fileInputRef!} style="display:none" multiple
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt"
              onChange={(e) => { const files = e.currentTarget.files; if (files && files.length > 0) props.onFileUpload(Array.from(files)); e.currentTarget.value=''; }} />
            <button type="button" class={styles.btnAttach}
              onClick={() => fileInputRef?.click()}
              disabled={props.uploading() || !wsStore.connected()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div style="position:relative">
              <button type="button" class={styles.btnEmoji}
                onClick={() => setShowEmoji(!showEmoji())}>
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
                    props.setText((t) => t + emoji);
                    setShowEmoji(false);
                    textareaRef?.focus();
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              </Show>
            </div>
            <textarea ref={textareaRef!} class={styles.input} placeholder={i18n.t('msg.placeholder')} value={props.text()} rows={1}
              onInput={(e) => { props.setText(e.currentTarget.value); resizeTextarea(); props.onTyping(); }}
              onKeyDown={(e) => {
                const s = settingsStore.settings().sendByEnter;
                if (s && e.key==='Enter' && !e.shiftKey) { e.preventDefault(); props.onSend(); }
                if (!s && e.key==='Enter' && e.ctrlKey) { e.preventDefault(); props.onSend(); }
              }}
              disabled={!wsStore.connected()} />
            <Show when={props.text().trim()} fallback={
              <button class={styles.btnMic} type="button" onClick={startRecording} disabled={!wsStore.connected()}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="1" width="6" height="14" rx="3" stroke="currentColor" stroke-width="2"/>
                  <path d="M5 10a7 7 0 0014 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            }>
              <button class={styles.btnSend} type="submit" disabled={!props.text().trim() || !wsStore.connected()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </Show>
          </form>
        <Show when={recording()}>
          <div class={styles.recRow}>
            <button class={styles.btnRecCancel} type="button" onClick={() => stopRecording(false)}>
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
            <button class={styles.btnRecSend} type="button" onClick={() => stopRecording(true)}>
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
