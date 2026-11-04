/* Service worker: makes the game installable and keeps the page shell available if the connection blips.
   Network first, so a new version is picked up as soon as the server has it. Game traffic and audio are never cached here. */
const V = 'dotd-v3.0';
const SHELL = ['/play', '/app.js', '/shared/engine.js', '/shared/catalog.js', '/shared/music.js', '/shared/commentary.js', '/shared/progress.js', '/shared/host.js', '/icon.svg', '/manifest.webmanifest'];
const SKIP = ['/socket.io/', '/api/', '/audio/', '/songs/', '/healthz'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || SKIP.some(p => u.pathname.startsWith(p))) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(r, copy)); } return res; }).catch(() => caches.match(r).then(m => m || caches.match('/play'))));
});
