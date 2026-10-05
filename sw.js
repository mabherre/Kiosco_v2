/**
 * Service worker: cachea los archivos estáticos de la app SOLO como
 * respaldo para cuando no hay conexión. Mientras haya internet, siempre
 * intenta traer la versión más nueva del servidor primero (network-first),
 * para que instalar la app en una tablet no la deje "pegada" en una
 * versión vieja para siempre.
 *
 * IMPORTANTE: cada vez que cambies este archivo (sw.js), subí un CACHE con
 * nombre distinto (v3, v4, ...) para forzar a los dispositivos ya
 * instalados a tomar la actualización.
 */
var CACHE = 'kiosco-v3';
var ARCHIVOS = [
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/db.js',
  './js/printer.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ARCHIVOS); })
      .then(function () { return self.skipWaiting(); }) // no esperar a cerrar pestañas viejas
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (nombres) {
        return Promise.all(
          nombres.filter(function (n) { return n !== CACHE; })
                 .map(function (n) { return caches.delete(n); }) // borra cachés viejas
        );
      })
      .then(function () { return self.clients.claim(); }) // toma control ya mismo
  );
});

self.addEventListener('fetch', function (event) {
  // Los pedidos al backend (Apps Script, otro dominio) y los que no son GET
  // no pasan por acá: así no se les agrega demora ni se intenta guardarlos
  // en el caché de archivos estáticos.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(function (respuestaRed) {
        // Actualiza la copia guardada con lo que acaba de llegar de internet.
        var copia = respuestaRed.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copia); });
        return respuestaRed;
      })
      .catch(function () {
        // Sin conexión: usa la copia guardada como respaldo.
        return caches.match(event.request);
      })
  );
});
