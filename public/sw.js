const CACHE_NAME = 'h2v-v6';
const RUNTIME_CACHE = 'h2v-runtime-v1';
const FONT_CACHE = 'h2v-fonts-v1';
const AVATAR_CACHE = 'h2v-avatars-v1';

const PRECACHE = [
  '/',
  '/icon-512.png',
  '/icon-192.png',
  '/offline.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  const keep = new Set([CACHE_NAME, RUNTIME_CACHE, FONT_CACHE, AVATAR_CACHE]);
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('/ws')) return;

  const url = new URL(event.request.url);

  // Google Fonts — cache-first (fonts rarely change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((resp) => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }

  // Avatars from /uploads/ — stale-while-revalidate
  if (event.request.url.includes('/uploads/')) {
    event.respondWith(
      caches.open(AVATAR_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((resp) => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Navigation — network-first, offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('/') || caches.match('/offline.html'))
    );
    return;
  }

  // JS/CSS bundles — stale-while-revalidate
  if (url.pathname.match(/\.(js|css)$/) || url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((resp) => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Everything else — network-first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  const { title, body, icon, data } = payload;
  event.waitUntil(
    self.registration.showNotification(title || 'H2V', {
      body: body || '',
      icon: icon || undefined,
      badge: icon || undefined,
      tag: data?.chatId || 'h2v',
      data: data || {},
      vibrate: [200, 100, 200],
      requireInteraction: false,
      silent: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if (chatId) client.postMessage({ type: 'open-chat', chatId });
          return;
        }
      }
      return self.clients.openWindow('/');
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'show-notification') {
    const { title, body, icon, tag, chatId } = event.data;
    self.registration.showNotification(title, {
      body,
      icon: icon || undefined,
      tag,
      badge: icon || undefined,
      data: { chatId },
      vibrate: [200, 100, 200],
      requireInteraction: false,
      silent: false,
    });
  }
});
