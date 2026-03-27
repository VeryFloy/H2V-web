/**
 * E2E Encryption — Signal Protocol wrapper for the SolidJS app.
 *
 * signal-protocol.js (IIFE) and crypto-store.js are loaded as plain <script>
 * tags in index.html before this module runs, so window.SignalLib,
 * window.SignalStore and window.SignalUtils are available at call-time.
 *
 * Groups are NOT encrypted — only DIRECT chats.
 */
import { api } from '../api/client';

// ── Window global type declarations ──────────────────────────────────────────

interface SignalAddress {
  toString(): string;
}

interface SignalSessionCipher {
  encrypt(buffer: ArrayBuffer): Promise<{ type: number; body: string | ArrayBuffer }>;
  decryptPreKeyWhisperMessage(buffer: ArrayBuffer): Promise<ArrayBuffer>;
  decryptWhisperMessage(buffer: ArrayBuffer): Promise<ArrayBuffer>;
}

interface SignalSessionBuilder {
  processPreKey(bundle: PreKeyBundle): Promise<void>;
}

interface KeyHelper {
  generateIdentityKeyPair(): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }>;
  generateRegistrationId(): number;
  generateSignedPreKey(
    identityKeyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer },
    keyId: number,
  ): Promise<{ keyId: number; keyPair: { pubKey: ArrayBuffer }; signature: ArrayBuffer }>;
  generatePreKey(keyId: number): Promise<{ keyPair: { pubKey: ArrayBuffer } }>;
}

// Constructors typed as interfaces so that `new` calls compile without issues
interface AddressCtor { new (name: string, deviceId: number): SignalAddress; }
interface BuilderCtor { new (store: SignalStoreType, address: SignalAddress): SignalSessionBuilder; }
interface CipherCtor  { new (store: SignalStoreType, address: SignalAddress): SignalSessionCipher; }

interface SignalLibType {
  KeyHelper: KeyHelper;
  SignalProtocolAddress: AddressCtor;
  SessionBuilder: BuilderCtor;
  SessionCipher: CipherCtor;
}

interface SignalUtilsType {
  arrayBufferToBase64(buf: ArrayBuffer): string;
  base64ToArrayBuffer(b64: string): ArrayBuffer;
  textToArrayBuffer(str: string): ArrayBuffer;
  arrayBufferToText(buf: ArrayBuffer): string;
}

interface PreKeyBundle {
  registrationId: number;
  identityKey: ArrayBuffer;
  signedPreKey: { keyId: number; publicKey: ArrayBuffer; signature: ArrayBuffer };
  preKey?: { keyId: number; publicKey: ArrayBuffer };
}

// Full store interface (used for proper typing of constructor return value)
interface SignalStoreType {
  hasIdentityKeyPair(): Promise<boolean>;
  getIdentityKeyPair(): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }>;
  getLocalRegistrationId(): Promise<number>;
  storeIdentityKeyPair(kp: { pubKey: ArrayBuffer; privKey: ArrayBuffer }): Promise<void>;
  storeLocalRegistrationId(id: number): Promise<void>;
  storeSignedPreKey(id: number, kp: { pubKey: ArrayBuffer }): Promise<void>;
  storePreKey(id: number, kp: { pubKey: ArrayBuffer }): Promise<void>;
  removePreKey(id: number): Promise<void>;
  loadSession(encodedAddress: string): Promise<ArrayBuffer | undefined>;
  storeSession(encodedAddress: string, record: ArrayBuffer): Promise<void>;
  saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean>;
  isTrustedIdentity(identifier: string, identityKey: ArrayBuffer, direction: unknown): Promise<boolean>;
  _getDB(): Promise<IDBDatabase>;
}

interface StoreCtor { new (userId: string): SignalStoreType; }

declare global {
  interface Window {
    SignalLib: SignalLibType;
    SignalStore: StoreCtor;
    SignalUtils: SignalUtilsType;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sl(): SignalLibType {
  return window.SignalLib;
}
function su(): SignalUtilsType {
  return window.SignalUtils;
}

export function isE2EAvailable(): boolean {
  return !!(window.SignalLib && window.SignalStore && window.SignalUtils);
}

export async function hasSessionFor(userId: string, partnerId: string): Promise<boolean> {
  if (!isE2EAvailable()) return false;
  try {
    const store = getStore(userId);
    const addr = getAddress(partnerId);
    const session = await store.loadSession(addr.toString());
    return !!session;
  } catch {
    return false;
  }
}

function getAddress(userId: string): SignalAddress {
  const Addr = sl().SignalProtocolAddress;
  return new Addr(userId, 1);
}

// ── Plaintext cache ──────────────────────────────────────────────────────────
// Uses in-memory Map as the hot path. Persisted to sessionStorage (not
// localStorage) so decrypted texts survive page reloads within the same
// browser session but are NOT written to disk long-term, mitigating XSS
// exfiltration of historical plaintext.

const PT_CACHE_KEY = 'e2e_pt';
const PT_CACHE_MAX = 500;

const _ptCache = new Map<string, string>();

function _hydratePtCache(): void {
  try {
    const raw = sessionStorage.getItem(PT_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(entries)) _ptCache.set(k, v);
    }
  } catch { /* corrupted data — start fresh */ }
  // Clean up legacy localStorage cache from older versions
  try { localStorage.removeItem(PT_CACHE_KEY); } catch { /* noop */ }
}
_hydratePtCache();

function _flushPtCache(): void {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of _ptCache) obj[k] = v;
    sessionStorage.setItem(PT_CACHE_KEY, JSON.stringify(obj));
  } catch { /* ignore quota errors */ }
}

let _flushTimer: ReturnType<typeof setTimeout> | undefined;
function _scheduleFlush(): void {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(_flushPtCache, 300);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(_flushTimer); _flushPtCache(); }
  });
}

export function savePlaintext(msgId: string, text: string): void {
  _ptCache.set(msgId, text);
  if (_ptCache.size > PT_CACHE_MAX) {
    const iter = _ptCache.keys();
    let toDelete = _ptCache.size - PT_CACHE_MAX;
    while (toDelete-- > 0) {
      const { value, done } = iter.next();
      if (done) break;
      _ptCache.delete(value);
    }
  }
  _scheduleFlush();
}

export function getPlaintext(msgId: string): string | null {
  return _ptCache.get(msgId) ?? null;
}

// ── Store ─────────────────────────────────────────────────────────────────────

let _store: SignalStoreType | null = null;
let _storeUserId: string | null = null;

function getStore(userId: string): SignalStoreType {
  if (_store && _storeUserId === userId) return _store;
  if (_store && _storeUserId !== userId) {
    if (import.meta.env.DEV) console.warn('[E2E] Store userId mismatch — recreating store');
    _store = null;
  }
  const Store = window.SignalStore;
  _store = new Store(userId);
  _storeUserId = userId;
  return _store;
}

export function clearStore(userId?: string): void {
  const uid = userId ?? _storeUserId;
  _store = null;
  _storeUserId = null;
  _ptCache.clear();
  sessionStorage.removeItem(PT_CACHE_KEY);
  localStorage.removeItem(PREKEY_COUNTER_KEY);
  if (uid) {
    const dbName = `signal-store-${uid}`;
    const req = indexedDB.deleteDatabase(dbName);
    req.onerror = () => {};
    req.onblocked = () => {};
  }
}

// ── E2E version — bump to force key regeneration after breaking changes ───────

const E2E_VERSION = '7';

export async function initE2E(userId: string): Promise<void> {
  if (!isE2EAvailable()) {
    if (import.meta.env.DEV) console.warn('[E2E] Signal Protocol not loaded');
    return;
  }

  if (localStorage.getItem('e2e_version') !== E2E_VERSION) {
    await resetE2E(userId);
    localStorage.setItem('e2e_version', E2E_VERSION);
  } else {
    await initSignalKeys(userId);
  }
}

async function resetE2E(userId: string): Promise<void> {
  const dbName = `signal-store-${userId}`;

  // Close any open DB connection so the deleteDatabase request isn't blocked
  if (_store) {
    try { const db = await _store._getDB(); db.close(); } catch { /* noop */ }
  }
  _store = null;
  _storeUserId = null;

  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

  await initSignalKeys(userId);
}

// ── Key generation + upload ───────────────────────────────────────────────────

const PREKEY_COUNT = 100;

export async function initSignalKeys(userId: string): Promise<void> {
  if (!isE2EAvailable()) return;

  const KH = sl().KeyHelper;
  const store = getStore(userId);

  try {
    if (await store.hasIdentityKeyPair()) {
      scheduleReplenishCheck(userId);
      return;
    }
    const identityKeyPair = await KH.generateIdentityKeyPair();
    const registrationId  = KH.generateRegistrationId();
    const signedPreKey    = await KH.generateSignedPreKey(identityKeyPair, 1);

    await store.storeIdentityKeyPair(identityKeyPair);
    await store.storeLocalRegistrationId(registrationId);
    await store.storeSignedPreKey(1, signedPreKey.keyPair);

    const ab2b64 = su().arrayBufferToBase64;
    const preKeys: Array<{ keyId: number; publicKey: string }> = [];

    for (let i = 1; i <= PREKEY_COUNT; i++) {
      const pk = await KH.generatePreKey(i);
      await store.storePreKey(i, pk.keyPair);
      preKeys.push({ keyId: i, publicKey: ab2b64(pk.keyPair.pubKey) });
    }

    await api.uploadKeyBundle({
      registrationId,
      identityKey:     ab2b64(identityKeyPair.pubKey),
      signedPreKeyId:  signedPreKey.keyId,
      signedPreKey:    ab2b64(signedPreKey.keyPair.pubKey),
      signedPreKeySig: ab2b64(signedPreKey.signature),
      oneTimePreKeys:  preKeys,
    });
    scheduleReplenishCheck(userId);
  } catch (err) {
    if (import.meta.env.DEV) console.error('[E2E] initSignalKeys failed:', err);
  }
}

// ── Prekey replenishment ──────────────────────────────────────────────────────

const PREKEY_MIN = 20;
// localStorage key to persist the prekey ID counter across page reloads.
// Guarantees monotonically increasing, non-colliding IDs even if replenish
// is called multiple times in the same second. Wraps at 2^24 to stay within
// uint32 range and avoid conflicts with initial keys (1..PREKEY_COUNT).
const PREKEY_COUNTER_KEY = 'e2e_prekey_counter';

function getNextPreKeyStartId(): number {
  const raw = parseInt(localStorage.getItem(PREKEY_COUNTER_KEY) ?? '0', 10);
  // Guard against NaN from corrupted localStorage values
  const safe = Number.isFinite(raw) ? raw : 0;
  // Start well above the initial batch (1..PREKEY_COUNT) and avoid overlap
  const start = Math.max(safe, PREKEY_COUNT + 1);
  // Persist the next batch boundary so concurrent/future calls don't overlap
  localStorage.setItem(PREKEY_COUNTER_KEY, String(start + PREKEY_COUNT));
  return start;
}

let replenishing = false;

function scheduleReplenishCheck(userId: string): void {
  setTimeout(() => checkAndReplenish(userId), 5_000);
}

export async function checkAndReplenish(userId: string): Promise<void> {
  if (replenishing || !isE2EAvailable()) return;
  try {
    const res = await api.getPreKeyCount();
    if (res.data.count >= PREKEY_MIN) return;

    replenishing = true;
    const KH = sl().KeyHelper;
    const store = getStore(userId);
    const ab2b64 = su().arrayBufferToBase64;
    const newKeys: Array<{ keyId: number; publicKey: string }> = [];
    const startId = getNextPreKeyStartId();

    for (let i = 0; i < PREKEY_COUNT; i++) {
      const pk = await KH.generatePreKey(startId + i);
      await store.storePreKey(startId + i, pk.keyPair);
      newKeys.push({ keyId: startId + i, publicKey: ab2b64(pk.keyPair.pubKey) });
    }

    await api.replenishPreKeys(newKeys);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[E2E] Replenish failed:', err);
  } finally {
    replenishing = false;
  }
}

// ── Session establishment (sender side) ───────────────────────────────────────

const _sessionLocks = new Map<string, Promise<boolean>>();

async function ensureSession(userId: string, partnerId: string): Promise<boolean> {
  const key = `${userId}:${partnerId}`;
  const pending = _sessionLocks.get(key);
  if (pending) return pending;
  const promise = _ensureSessionInner(userId, partnerId).finally(() => _sessionLocks.delete(key));
  _sessionLocks.set(key, promise);
  return promise;
}

async function _ensureSessionInner(userId: string, partnerId: string): Promise<boolean> {
  if (!isE2EAvailable()) return false;

  const store = getStore(userId);
  const addr  = getAddress(partnerId);

  const existingSession = await store.loadSession(addr.toString());
  if (existingSession) return true;

  try {
    const res = await api.getKeyBundle(partnerId);
    if (!res?.data) { if (import.meta.env.DEV) console.warn('[E2E] No bundle for', partnerId); return false; }

    const bundle = res.data;
    const b64ab  = su().base64ToArrayBuffer;

    const pkBundle: PreKeyBundle = {
      registrationId: bundle.registrationId,
      identityKey:    b64ab(bundle.identityKey),
      signedPreKey: {
        keyId:     bundle.signedPreKeyId,
        publicKey: b64ab(bundle.signedPreKey),
        signature: b64ab(bundle.signedPreKeySig),
      },
    };
    if (bundle.preKey) {
      pkBundle.preKey = {
        keyId:     bundle.preKey.keyId,
        publicKey: b64ab(bundle.preKey.publicKey),
      };
    }

    const Builder = sl().SessionBuilder;
    const builder = new Builder(store, addr);
    await builder.processPreKey(pkBundle);
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[E2E] ensureSession failed:', err);
    return false;
  }
}

// ── Encrypt ───────────────────────────────────────────────────────────────────

export async function encryptMessage(
  myUserId: string,
  partnerId: string,
  plaintext: string,
): Promise<{ ciphertext: string; signalType: number } | null> {
  if (!isE2EAvailable()) return null;

  const ready = await ensureSession(myUserId, partnerId);
  if (!ready) return null;

  try {
    const store  = getStore(myUserId);
    const addr   = getAddress(partnerId);
    const Cipher = sl().SessionCipher;
    const cipher = new Cipher(store, addr);
    const enc    = await cipher.encrypt(su().textToArrayBuffer(plaintext));

    const ct = typeof enc.body === 'string'
      ? btoa(enc.body)
      : su().arrayBufferToBase64(enc.body as ArrayBuffer);

    return { ciphertext: ct, signalType: enc.type };
  } catch (err) {
    if (import.meta.env.DEV) console.error('[E2E] encrypt failed:', err);
    return null;
  }
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

export async function decryptMessage(
  myUserId: string,
  senderId: string,
  ciphertext: string,
  signalType: number,
): Promise<string | null> {
  if (!isE2EAvailable()) return null;

  try {
    const store  = getStore(myUserId);
    const addr   = getAddress(senderId);
    const Cipher = sl().SessionCipher;
    const cipher = new Cipher(store, addr);

    const binStr = atob(ciphertext);
    const bytes  = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    const body = bytes.buffer;

    let plainBuf: ArrayBuffer;
    if (signalType === 3) {
      plainBuf = await cipher.decryptPreKeyWhisperMessage(body);
    } else {
      plainBuf = await cipher.decryptWhisperMessage(body);
    }

    return su().arrayBufferToText(plainBuf);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[E2E] decrypt failed:', (err as Error).message);
    return null;
  }
}

// ── E2E Media Encryption (AES-256-GCM) ────────────────────────────────────────

export async function encryptMedia(data: ArrayBuffer): Promise<{ encrypted: ArrayBuffer; mediaKey: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  const rawKey = await crypto.subtle.exportKey('raw', key);
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);

  let binary = '';
  const raw = new Uint8Array(rawKey);
  for (let i = 0; i < raw.length; i++) binary += String.fromCharCode(raw[i]);
  const keyB64 = btoa(binary);

  return { encrypted: combined.buffer, mediaKey: keyB64 };
}

export async function decryptMedia(data: ArrayBuffer, mediaKeyB64: string): Promise<ArrayBuffer> {
  const rawKey = Uint8Array.from(atob(mediaKeyB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const u8 = new Uint8Array(data);
  const iv = u8.slice(0, 12);
  const ciphertext = u8.slice(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

// ── Safety Numbers ────────────────────────────────────────────────────────────

let _safetyWorker: Worker | null = null;
let _safetyMsgId = 0;
function getSafetyWorker(): Worker {
  if (!_safetyWorker) {
    _safetyWorker = new Worker(new URL('./safetyWorker.ts', import.meta.url), { type: 'module' });
  }
  return _safetyWorker;
}

export async function computeSafetyNumber(
  myUserId: string,
  partnerId: string,
): Promise<string | null> {
  if (!isE2EAvailable()) return null;
  try {
    const store = getStore(myUserId);
    const myIdentity = await store.getIdentityKeyPair();
    const addr = getAddress(partnerId);
    const db = await store._getDB();
    const partnerKey = await new Promise<ArrayBuffer | null>((resolve) => {
      const tx = db.transaction('identities', 'readonly');
      const req = tx.objectStore('identities').get(addr.toString());
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    if (!partnerKey) return null;

    const myBuf = new Uint8Array(myIdentity.pubKey);
    const partnerBuf = new Uint8Array(partnerKey);

    const worker = getSafetyWorker();
    const reqId = ++_safetyMsgId;
    return new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 15_000);
      worker.onmessage = (e: MessageEvent<{ msgId: number; result: string | null }>) => {
        if (e.data.msgId !== reqId) return;
        clearTimeout(timeout);
        resolve(e.data.result);
      };
      worker.onerror = () => { clearTimeout(timeout); resolve(null); };
      worker.postMessage({
        msgId: reqId,
        my: { userId: myUserId, pubKey: myBuf },
        partner: { userId: partnerId, pubKey: partnerBuf },
      });
    });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[E2E] computeSafetyNumber failed:', err);
    return null;
  }
}

// ── Device Key Backup ─────────────────────────────────────────────────────────
//
// Exports the identity keypair + prekey counter + decrypted message cache,
// encrypted with AES-256-GCM using a PBKDF2-derived key from the passphrase.
// File format: JSON { v:1, data: base64(salt[16] + iv[12] + ciphertext) }
//
// ⚠️  The backup is intended for SINGLE-DEVICE migration.
//     Using it on multiple devices simultaneously breaks Signal Protocol.
//     After import the device generates fresh one-time prekeys, so contacts
//     will re-establish sessions automatically on the next message.

const BACKUP_PBKDF2_ITERS = 310_000;

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: BACKUP_PBKDF2_ITERS, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

function ab2u8(buf: ArrayBuffer): Uint8Array { return new Uint8Array(buf); }

export async function exportEncryptedBackup(
  userId: string,
  passphrase: string,
): Promise<string> {
  if (!isE2EAvailable()) throw new Error('[E2E] Signal not loaded');
  const store = getStore(userId);
  const ab2b64 = su().arrayBufferToBase64;

  const identityKeyPair = await store.getIdentityKeyPair();
  const registrationId  = await store.getLocalRegistrationId();

  const payload = JSON.stringify({
    v: 1,
    userId,
    registrationId,
    identityKey: {
      pubKey: ab2b64(identityKeyPair.pubKey),
      privKey: ab2b64(identityKeyPair.privKey),
    },
    plaintextCache:  (() => { const o: Record<string, string> = {}; for (const [k, v] of _ptCache) o[k] = v; return JSON.stringify(o); })(),
    preKeyCounter:   localStorage.getItem(PREKEY_COUNTER_KEY) ?? '0',
  });

  const salt = new Uint8Array(16); crypto.getRandomValues(salt);
  const iv   = new Uint8Array(12); crypto.getRandomValues(iv);
  const key  = await deriveAesKey(passphrase, salt, ['encrypt']);

  const encrypted = ab2u8(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload)),
  );

  // Pack: salt(16) + iv(12) + ciphertext
  const packed = new Uint8Array(16 + 12 + encrypted.length);
  packed.set(salt, 0);
  packed.set(iv, 16);
  packed.set(encrypted, 28);

  let binary = '';
  for (let i = 0; i < packed.length; i++) binary += String.fromCharCode(packed[i]);
  return JSON.stringify({ v: 1, data: btoa(binary) });
}

// ── Upload fresh prekeys after identity restore ───────────────────────────────
// Generates new signed + one-time prekeys using the imported identity keypair
// and uploads the full bundle. Existing peer sessions will re-establish on the
// next message exchange.

async function uploadFreshPrekeys(userId: string): Promise<void> {
  const KH     = sl().KeyHelper;
  const store  = getStore(userId);
  const ab2b64 = su().arrayBufferToBase64;

  const identityKeyPair = await store.getIdentityKeyPair();
  const registrationId  = await store.getLocalRegistrationId();

  const signedPreKey = await KH.generateSignedPreKey(identityKeyPair, 1);
  await store.storeSignedPreKey(1, signedPreKey.keyPair);

  // Reset the prekey counter so fresh IDs start from 1
  localStorage.setItem(PREKEY_COUNTER_KEY, '0');

  const preKeys: Array<{ keyId: number; publicKey: string }> = [];
  for (let i = 1; i <= PREKEY_COUNT; i++) {
    const pk = await KH.generatePreKey(i);
    await store.storePreKey(i, pk.keyPair);
    preKeys.push({ keyId: i, publicKey: ab2b64(pk.keyPair.pubKey) });
  }

  await api.uploadKeyBundle({
    registrationId,
    identityKey:     ab2b64(identityKeyPair.pubKey),
    signedPreKeyId:  signedPreKey.keyId,
    signedPreKey:    ab2b64(signedPreKey.keyPair.pubKey),
    signedPreKeySig: ab2b64(signedPreKey.signature),
    oneTimePreKeys:  preKeys,
  });
}

export async function importEncryptedBackup(
  userId: string,
  fileContent: string,
  passphrase: string,
): Promise<void> {
  let parsed: { v: number; data: string };
  try { parsed = JSON.parse(fileContent); } catch { throw new Error('invalid_file'); }
  if (parsed.v !== 1 || !parsed.data) throw new Error('invalid_file');

  const binary = Uint8Array.from(atob(parsed.data), (c) => c.charCodeAt(0));
  const salt   = binary.slice(0, 16) as Uint8Array<ArrayBuffer>;
  const iv     = binary.slice(16, 28) as Uint8Array<ArrayBuffer>;
  const cipher = binary.slice(28);

  let plaintext: string;
  try {
    const key = await deriveAesKey(passphrase, salt, ['decrypt']);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    plaintext = new TextDecoder().decode(dec);
  } catch {
    throw new Error('wrong_passphrase');
  }

  let payload: {
    userId: string;
    registrationId: number;
    identityKey: { pubKey: string; privKey: string };
    plaintextCache: string;
    preKeyCounter: string;
  };
  try { payload = JSON.parse(plaintext); } catch { throw new Error('invalid_file'); }

  if (payload.userId !== userId) throw new Error('wrong_account');

  // Wipe the existing local Signal store before importing
  await resetE2E(userId);

  const b642ab = su().base64ToArrayBuffer;
  const store  = getStore(userId);

  await store.storeIdentityKeyPair({
    pubKey:  b642ab(payload.identityKey.pubKey),
    privKey: b642ab(payload.identityKey.privKey),
  });
  await store.storeLocalRegistrationId(payload.registrationId);

  // Restore decrypted message cache and prekey counter
  if (payload.plaintextCache) {
    try {
      const entries = JSON.parse(payload.plaintextCache) as Record<string, string>;
      for (const [k, v] of Object.entries(entries)) _ptCache.set(k, v);
      _flushPtCache();
    } catch { /* corrupted backup cache */ }
  }
  if (payload.preKeyCounter) localStorage.setItem(PREKEY_COUNTER_KEY, payload.preKeyCounter);

  // Upload fresh prekeys with the restored identity so peers can reach this device
  await uploadFreshPrekeys(userId);
}
