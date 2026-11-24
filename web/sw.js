// Service worker: guarda la app en el celular para abrirla sin conexión.
// Al publicar una versión nueva, cambie VERSION para que los celulares se actualicen.
const VERSION = 'inv-iesppa-1.0.0';
const ARCHIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/api.js', 'js/cola.js', 'js/config.js', 'js/db.js', 'js/scanner.js', 'js/store.js', 'js/ui.js',
  'js/views/ambiente.js', 'js/views/ambientes.js', 'js/views/buscar.js', 'js/views/escaner.js',
  'js/views/flujo.js', 'js/views/login.js', 'js/views/sobrante.js',
  'vendor/html5-qrcode.min.js', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // la API no se cachea
  // Red primero (para recibir actualizaciones), con espera máxima de 4 s; si no hay señal, la copia guardada.
  const desdeCache = () => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'));
  const red = fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
    return r;
  });
  const espera = new Promise((res) => setTimeout(res, 4000)).then(desdeCache).then((r) => r || red);
  e.respondWith(Promise.race([red.catch(desdeCache), espera]));
});
