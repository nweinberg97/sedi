// Sedi service worker: caches the app shell so Sedi opens instantly and works fully offline.
// Bump VERSION whenever app files change so browsers pick up the new build.

const VERSION = 'sedi-v1.2.0';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './brain/master_library.json',
  './js/util.js', './js/store.js', './js/dnd.js', './js/sound.js', './js/cards.js', './js/shell.js', './js/home.js',
  './js/taskly.js', './js/boardly.js', './js/timely.js', './js/brainly.js', './js/speech.js', './js/assistant.js',
  './js/brain.js', './js/onboarding.js', './js/commands.js', './js/glass.js',
];
const RUNTIME = 'sedi-runtime'; // Sovereign Brain runtime files from the CDN

self.addEventListener('install', event => {
  // cache: 'reload' bypasses the browser's HTTP cache so a new version never precaches stale files.
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sedi-v') && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App shell: network first (always the newest version when online), cached copy when offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true }))
          || (req.mode === 'navigate' ? await cache.match('./index.html') : null)
          || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Transformers.js + ONNX runtime from jsDelivr: keep a local copy once downloaded.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
  // Everything else (weather, model weights) goes straight to the network;
  // model weights are cached by Transformers.js itself.
});
