import crypto from 'crypto';

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY ?? process.env.PHONE_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

function getHashSecret(): string {
  const secret = process.env.HASH_SECRET ?? process.env.PHONE_HASH_SECRET;
  if (!secret) throw new Error('HASH_SECRET is not set');
  return secret;
}

/**
 * AES-256-GCM encryption.
 * Stored format: base64(iv[12] + tag[16] + ciphertext)
 */
export function encryptValue(value: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptValue(data: string): string {
  const key = getKey();
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

/**
 * HMAC-SHA256 deterministic hash for DB lookups.
 */
export function hashValue(value: string): string {
  return crypto.createHmac('sha256', getHashSecret()).update(value).digest('hex');
}

/** @deprecated Use encryptValue */
export const encryptPhone = encryptValue;
/** @deprecated Use decryptValue */
export const decryptPhone = decryptValue;
/** @deprecated Use hashValue */
export const hashPhone = hashValue;
