/**
 * Блэклист одноразовых email-доменов.
 * Источник: https://gist.github.com/adamloving/4401361
 * Обновляется раз в час автоматически.
 */

const GIST_URL =
  'https://gist.githubusercontent.com/adamloving/4401361/raw/';

let blockedDomains = new Set<string>();
let lastFetchAt    = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час

export async function loadDisposableDomains(): Promise<void> {
  const now = Date.now();
  if (blockedDomains.size > 0 && now - lastFetchAt < CACHE_TTL_MS) return;

  try {
    const res = await fetch(GIST_URL, {
      headers: { 'User-Agent': 'h2v-messenger/1.0' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    const domains = text
      .split('\n')
      .map(l => l.trim().toLowerCase())
      .filter(l => l && !l.startsWith('#') && l.includes('.'));

    blockedDomains = new Set(domains);
    lastFetchAt    = now;
    console.log(`[DisposableEmails] Loaded ${blockedDomains.size} blocked domains`);
  } catch (err: any) {
    // Не блокируем сервер если GitHub недоступен
    console.warn('[DisposableEmails] Failed to fetch list:', err.message);
  }
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return blockedDomains.has(domain);
}

// Запускаем автообновление каждый час
export function startDisposableEmailsAutoRefresh(): void {
  loadDisposableDomains().catch(() => {});
  setInterval(() => {
    loadDisposableDomains().catch(() => {});
  }, CACHE_TTL_MS);
}
