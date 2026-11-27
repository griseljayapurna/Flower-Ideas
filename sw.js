// Keeps a copy of the app on the phone so it also works without internet
// (for example in church). When you change any file, raise VERSION by one so
// phones pick up the new version.

const VERSION = 'v1';
const CACHE = 'flower-ideas-' + VERSION;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'credits.html',
  'manifest.webmanifest',
  'js/app.js',
  'js/editor.js',
  'js/images.js',
  'js/library.js',
  'js/storage.js',
  'flowers/library.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    // Also keep every built-in flower picture.
    try {
      const list = await (await fetch('flowers/library.json', { cache: 'no-cache' })).json();
      await cache.addAll(list.map(f => f.file));
    } catch (err) {
      console.warn('Could not store flower pictures for offline use', err);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('flower-ideas-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isPicture = /\.(webp|png|jpg|jpeg)$/i.test(url.pathname);

  if (isPicture) {
    // Pictures rarely change: use the stored copy first.
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // Pages and code: try the internet first (to get updates), fall back to the stored copy.
  event.respondWith((async () => {
    try {
      // 'no-cache' = always ask the server if there is a newer copy (cheap when nothing changed).
      const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)]);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('index.html');
      throw new Error('offline');
    }
  })());
});
