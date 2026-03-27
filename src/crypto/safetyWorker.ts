/**
 * Web Worker for computing safety number hashes (5200× SHA-512 per side).
 * Offloads heavy crypto to a background thread to avoid blocking the UI.
 */

interface HashRequest {
  userId: string;
  pubKey: Uint8Array;
}

async function hashIterations(userId: string, pubKey: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const idBytes = enc.encode(userId);
  let buf = new Uint8Array(2 + idBytes.length + pubKey.length);
  buf[0] = 0; buf[1] = 0;
  buf.set(idBytes, 2);
  buf.set(pubKey, 2 + idBytes.length);
  for (let i = 0; i < 5200; i++) {
    const h = await crypto.subtle.digest('SHA-512', buf);
    const u8 = new Uint8Array(h);
    const next = new Uint8Array(2 + pubKey.length + u8.length);
    next[0] = 0; next[1] = 0;
    next.set(pubKey, 2);
    next.set(u8, 2 + pubKey.length);
    buf = next;
  }
  return buf.slice(2 + pubKey.length);
}

self.onmessage = async (e: MessageEvent<{ msgId?: number; my: HashRequest; partner: HashRequest }>) => {
  try {
    const { msgId, my, partner } = e.data;
    const [myHash, partnerHash] = await Promise.all([
      hashIterations(my.userId, my.pubKey),
      hashIterations(partner.userId, partner.pubKey),
    ]);

    const combined = new Uint8Array(myHash.length);
    for (let i = 0; i < combined.length; i++) combined[i] = myHash[i] ^ partnerHash[i];

    const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
    const digits: string[] = [];
    for (let i = 0; i < 30 && i * 2 + 1 < combined.length; i++) {
      const val = view.getUint16(i * 2) % 100000;
      digits.push(val.toString().padStart(5, '0'));
    }
    self.postMessage({ msgId, result: digits.slice(0, 12).join(' ') });
  } catch {
    self.postMessage({ msgId: e.data?.msgId, result: null });
  }
};
