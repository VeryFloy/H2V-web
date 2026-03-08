const CACHE_NAME = 'h2v-v1';
const PRECACHE = ['/', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
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
