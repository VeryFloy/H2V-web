// Signal Protocol StorageType implementation backed by IndexedDB
// Each user gets their own DB keyed by `signal-store-{userId}`

const DB_VERSION = 1;
const STORES = ['identityKey', 'registrationId', 'preKeys', 'signedPreKeys', 'sessions', 'identities'];

function openDB(userId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`signal-store-${userId}`, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

class SignalStore {
  constructor(userId) {
    this._userId = userId;
    this._db = null;
  }

  async _getDB() {
    if (!this._db) {
      this._db = await openDB(this._userId);
    }
    return this._db;
  }

  async getIdentityKeyPair() {
    const db = await this._getDB();
    return dbGet(db, 'identityKey', 'identityKey');
  }

  async getLocalRegistrationId() {
    const db = await this._getDB();
    return dbGet(db, 'registrationId', 'registrationId');
  }

  async isTrustedIdentity(identifier, identityKey, _direction) {
    const db = await this._getDB();
    const trusted = await dbGet(db, 'identities', identifier);
    if (!trusted) return true;
    return arrayBufferEqual(identityKey, trusted);
  }

  async saveIdentity(encodedAddress, publicKey) {
    const db = await this._getDB();
    const existing = await dbGet(db, 'identities', encodedAddress);
    await dbPut(db, 'identities', encodedAddress, publicKey);
    return !!(existing && !arrayBufferEqual(existing, publicKey));
  }

  async loadPreKey(keyId) {
    const db = await this._getDB();
    return dbGet(db, 'preKeys', String(keyId));
  }

  async storePreKey(keyId, keyPair) {
    const db = await this._getDB();
    return dbPut(db, 'preKeys', String(keyId), keyPair);
  }

  async removePreKey(keyId) {
    const db = await this._getDB();
    return dbDelete(db, 'preKeys', String(keyId));
  }

  async loadSignedPreKey(keyId) {
    const db = await this._getDB();
    return dbGet(db, 'signedPreKeys', String(keyId));
  }

  async storeSignedPreKey(keyId, keyPair) {
    const db = await this._getDB();
    return dbPut(db, 'signedPreKeys', String(keyId), keyPair);
  }

  async removeSignedPreKey(keyId) {
    const db = await this._getDB();
    return dbDelete(db, 'signedPreKeys', String(keyId));
  }

  async loadSession(encodedAddress) {
    const db = await this._getDB();
    return dbGet(db, 'sessions', encodedAddress);
  }

  async storeSession(encodedAddress, record) {
    const db = await this._getDB();
    return dbPut(db, 'sessions', encodedAddress, record);
  }

  // Helpers for initialization
  async storeIdentityKeyPair(keyPair) {
    const db = await this._getDB();
    return dbPut(db, 'identityKey', 'identityKey', keyPair);
  }

  async storeLocalRegistrationId(id) {
    const db = await this._getDB();
    return dbPut(db, 'registrationId', 'registrationId', id);
  }

  async hasIdentityKeyPair() {
    const pair = await this.getIdentityKeyPair();
    return !!pair;
  }
}

function arrayBufferEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const v1 = new Uint8Array(a);
  const v2 = new Uint8Array(b);
  for (let i = 0; i < v1.length; i++) {
    if (v1[i] !== v2[i]) return false;
  }
  return true;
}

// ── Conversion helpers ──────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function textToArrayBuffer(str) {
  return new TextEncoder().encode(str).buffer;
}

function arrayBufferToText(buffer) {
  return new TextDecoder().decode(buffer);
}

window.SignalStore = SignalStore;
window.SignalUtils = {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  textToArrayBuffer,
  arrayBufferToText,
  arrayBufferEqual,
};
