// Service worker: deja la app disponible sin conexion.
// Estrategia "primero la red, y si no hay, lo guardado": con internet siempre se ve la ultima
// version publicada; sin internet se abre la copia guardada la ultima vez.
const CACHE = 'estirador-v1';
const ARCHIVOS = ['./', 'index.html', 'editor.js', 'worker.js', 'world.js',
                  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(ARCHIVOS.map((a) => c.add(a).catch(() => { /* si falta uno, sigue */ }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
