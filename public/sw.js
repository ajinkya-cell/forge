// Forge's offline layer. The app's own files: network first (so updates show up at once), the saved copy when offline.
// Board images and files: saved after the first view, so they show offline too. The API is never cached.
const APP = 'forge-app-v3', FILES = 'forge-files-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/ink.css', '/views.js', '/board.js', '/notes.js', '/timer.js', '/coach.js', '/cloud.js', '/app.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== APP && k !== FILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/files/')) {
    e.respondWith(caches.open(FILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(APP);
    try {
      const res = await fetch(req, { signal: AbortSignal.timeout(4000) });
      if (res.ok) c.put(req.mode === 'navigate' ? '/' : req, res.clone());
      return res;
    } catch {
      return (await c.match(req.mode === 'navigate' ? '/' : req)) || (await c.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
