// Guarda las pantallas para que la app abra aunque la señal sea mala. Los datos siempre se piden al servidor.
const CACHE = 'construir-v4';
const BASE = ['/', '/app.js', '/estilos.css', '/manifest.webmanifest', '/iconos/icono-192.png', '/fuentes/inter-regular.woff', '/fuentes/inter-medium.woff', '/fuentes/inter-semibold.woff'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/'))),
  );
});
