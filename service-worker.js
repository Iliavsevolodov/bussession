const CACHE = 'business-session-v5';
const SHELL = [
  './',
  './index.html',
  './checkin.html',
  './styles.css',
  './config.js',
  './app.js',
  './checkin.js',
  './overnight.js',
  './copy-lists.js',
  './enhancements-v3.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('business-session-') && key !== CACHE)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(new Request(request, { cache: 'no-store' }));
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone()).catch(() => null);
      }
      return fresh;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;

      if (request.mode === 'navigate') {
        const fallback = url.pathname.endsWith('/checkin.html') ? './checkin.html' : './index.html';
        const page = await caches.match(fallback);
        if (page) return page;
      }

      throw error;
    }
  })());
});
