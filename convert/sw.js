// FCO.TOOLS Service Worker — network-only (no offline cache yet)
const VERSION = 'fco-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() =>
      new Response('', { status: 503, statusText: 'Service Unavailable' })
    )
  );
});
