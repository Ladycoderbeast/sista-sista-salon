// sw.js
const CACHE_NAME = 'sista-sista-cache-v8';

const CORE_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './clients.html',
  './services.html',
  './reservations.html',
  './reports.html',
  './calendar.html',
  './reviews.html',
  './revenue.html',
  './notepad.html',          // ✅ new
  './offline.html',

  './style.css',
  './login.css',

  './app.js',
  './user-icon.js',
  './manifest.json',

  './assets/chart.min.js',
  './assets/chartjs-plugin-datalabels.min.js',

  // icons/images actually referenced by pages
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/sista-sista-home.jpeg',
  './assets/sista-sista-logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Tolerate a missing asset rather than failing the whole install
    await Promise.allSettled(
      CORE_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) await cache.put(url, res.clone());
        } catch (_) {}
      })
    );
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isHtmlNavigation = request.mode === 'navigate';
  const isAppShellAsset =
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'document' ||
    /\.(?:js|css|html)$/.test(url.pathname);

  const networkFirst = async () => {
    try {
      const res = await fetch(request, { cache: 'no-cache' });
      if (!res.ok) throw new Error('bad status');
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, copy));
      return res;
    } catch {
      return (
        (await caches.match(request)) ||
        (isHtmlNavigation ? await caches.match('./offline.html') : undefined)
      );
    }
  };

  const cacheFirst = async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, copy));
    }
    return res;
  };

  // HTML and active JS/CSS should not get stuck on an old cached version.
  if (isHtmlNavigation) {
    event.respondWith(networkFirst());
    return;
  }

  // Same-origin app shell assets: network-first so deploys can replace app.js/login/auth quickly.
  if (url.origin === self.location.origin && isAppShellAsset) {
    event.respondWith(networkFirst());
    return;
  }

  // Same-origin images/icons/etc: cache-first for offline speed.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst());
    return;
  }

  // Cross-origin (CDNs): network-first, fallback to cache.
  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, copy));
      return res;
    } catch {
      return caches.match(request);
    }
  })());
});

// optional: allow immediate activation from the page
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
