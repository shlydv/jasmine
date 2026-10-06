const CACHE_NAME = 'jasmine-residency-shell-v15';
const APP_SHELL = [
  './',
  './index.html',
  './history_data.js',
  './sync-merge.js?v=1',
  './tenant-details.js?v=5',
  './verification.js?v=2',
  './verification.css?v=2',
  './electricity.js?v=3',
  './attachments.js?v=2',
  './finance.js?v=3',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Cloud data must always be fresh and must carry the browser's Access cookie.
  // Never cache the D1 API response in the offline shell cache.
  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
