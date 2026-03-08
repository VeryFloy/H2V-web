/**
 * Reactive E2E state + decrypted message text cache.
 *
 * Keeps a Map<messageId, decryptedText> in a SolidJS store so that
 * MessageArea can reactively display decrypted content without prop-drilling.
 */
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  isE2EAvailable,
  initE2E,
  encryptMessage,
  decryptMessage,
  savePlaintext,
  getPlaintext,
  clearStore,
  checkAndReplenish,
  exportEncryptedBackup,
  importEncryptedBackup,
} from '../crypto/e2e';

export type E2EStatus = 'unavailable' | 'initializing' | 'ready' | 'error';

const [status, setStatus] = createSignal<E2EStatus>('unavailable');
const [decryptedTexts, setDecryptedTexts] = createStore<Record<string, string>>({});

let _userId: string | null = null;

// Pending plaintext: saved just before we send, keyed by chatId.
// Each chat holds a FIFO queue so rapid messages don't overwrite each other.
// When the server echoes a message back with a real msgId, we shift() from the queue.
const _pendingPlaintext = new Map<string, string[]>();

// Dedup set: prevents concurrent decrypt calls for the same message from
// corrupting Signal session state via double ratchet advancement.
const _decryptingIds = new Set<string>();

// ── Init on login ─────────────────────────────────────────────────────────────

export async function initE2EStore(userId: string): Promise<void> {
  _userId = userId;
  if (!isE2EAvailable()) {
    setStatus('unavailable');
    return;
  }
  setStatus('initializing');
  try {
    await initE2E(userId);
    setStatus('ready');
  } catch {
    setStatus('error');
  }
}

// ── Encrypt (for sending) ─────────────────────────────────────────────────────

export async function encrypt(
  chatId: string,
  partnerId: string,
  plaintext: string,
): Promise<{ ciphertext: string; signalType: number } | null> {
  if (!_userId || status() !== 'ready') return null;
  const result = await encryptMessage(_userId, partnerId, plaintext);
  if (result) {
    // Enqueue plaintext BEFORE sending so we can restore it when the server echoes back.
    // FIFO queue per chat handles rapid-fire messages without collisions.
    const queue = _pendingPlaintext.get(chatId) ?? [];
    queue.push(plaintext);
    _pendingPlaintext.set(chatId, queue);
  }
  return result;
}

// ── Encrypt for editing (direct cache write, bypasses pending queue) ──────────
// Unlike encrypt(), this is for edits: the msgId is already known, so we
// immediately persist the new plaintext under that id rather than waiting
// for the server's echo with a new msgId.

export async function encryptEdit(
  msgId: string,
  partnerId: string,
  plaintext: string,
): Promise<{ ciphertext: string; signalType: number } | null> {
  if (!_userId || status() !== 'ready') return null;
  const result = await encryptMessage(_userId, partnerId, plaintext);
  if (result) {
    // Update cache immediately so the sender sees the new text right away
    savePlaintext(msgId, plaintext);
    setDecryptedTexts(msgId, plaintext);
  }
  return result;
}

// ── Claim pending plaintext when server echoes our own message back ───────────
// Must be called from events.store when message:new arrives for our own message.

export function claimPendingPlaintext(chatId: string, msgId: string): void {
  const queue = _pendingPlaintext.get(chatId);
  if (!queue || queue.length === 0) return;
  const text = queue.shift()!;
  if (queue.length === 0) _pendingPlaintext.delete(chatId);
  savePlaintext(msgId, text);
  setDecryptedTexts(msgId, text);
}

// ── Decrypt (for received messages) ──────────────────────────────────────────

export async function decrypt(
  msgId: string,
  senderId: string,
  ciphertext: string,
  signalType: number,
): Promise<string | null> {
  const cached = getPlaintext(msgId);
  if (cached) {
    setDecryptedTexts(msgId, cached);
    return cached;
  }

  if (!_userId || !isE2EAvailable()) return null;
  if (_decryptingIds.has(msgId)) return null;
  _decryptingIds.add(msgId);

  try {
    const text = await decryptMessage(_userId, senderId, ciphertext, signalType);
    if (text) {
      savePlaintext(msgId, text);
      setDecryptedTexts(msgId, text);
    }
    return text;
  } finally {
    _decryptingIds.delete(msgId);
  }
}

// ── Get cached decrypted text (synchronous, for rendering) ───────────────────

export function getDecryptedText(msgId: string): string | null {
  return decryptedTexts[msgId] ?? getPlaintext(msgId);
}

// ── Preload decrypted texts from localStorage on mount ───────────────────────
// Called once after loading a chat's messages so old messages show up immediately.

export function preloadDecryptedTexts(messageIds: string[]): void {
  for (const id of messageIds) {
    const cached = getPlaintext(id);
    if (cached && !decryptedTexts[id]) {
      setDecryptedTexts(id, cached);
    }
  }
}

// ── Reset on logout ───────────────────────────────────────────────────────────

export function resetE2EStore(): void {
  const uid = _userId;
  _userId = null;
  setStatus('unavailable');
  setDecryptedTexts({});
  _pendingPlaintext.clear();
  _decryptingIds.clear();
  clearStore(uid ?? undefined);
}

function checkReplenish(userId: string): void {
  checkAndReplenish(userId).catch(() => {});
}

// ── Key Backup (export / import) ──────────────────────────────────────────────

export async function exportBackup(passphrase: string): Promise<string> {
  if (!_userId) throw new Error('not_logged_in');
  return exportEncryptedBackup(_userId, passphrase);
}

export async function importBackup(fileContent: string, passphrase: string): Promise<void> {
  if (!_userId) throw new Error('not_logged_in');
  // Reset reactive state — re-init will be triggered by the caller
  setStatus('initializing');
  setDecryptedTexts({});
  _pendingPlaintext.clear();
  clearStore();
  try {
    await importEncryptedBackup(_userId, fileContent, passphrase);
    setStatus('ready');
  } catch (err) {
    setStatus('error');
    throw err;
  }
}

export const e2eStore = {
  status,
  decryptedTexts,
  initE2EStore,
  encrypt,
  encryptEdit,
  decrypt,
  getDecryptedText,
  preloadDecryptedTexts,
  claimPendingPlaintext,
  resetE2EStore,
  checkReplenish,
  exportBackup,
  importBackup,
};
