/**
 * Service Worker — Cancionero ICentral
 * Estrategia: Cache First para assets estáticos,
 * Network First con fallback a cache para el HTML principal.
 *
 * Al actualizar la versión del cancionero, cambiar CACHE_VERSION
 * para invalidar el cache anterior y forzar actualización.
 */

const CACHE_VERSION = 'cancionero-v18';
const CACHE_NAME = `${CACHE_VERSION}-static`;

// Recursos a pre-cachear en la instalación
const PRECACHE_URLS = [
  '/cancioneroicentral/',
  '/cancioneroicentral/index.html',
  // Fuentes de Google (se cachean dinámicamente en runtime)
];

// Dominios externos que NO se cachean (necesitan red)
const NETWORK_ONLY_ORIGINS = [
  'formspree.io',
  'docs.google.com',
  'raw.githubusercontent.com',
  'chordprostudio.netlify.app',
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // activar inmediatamente
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME) // eliminar caches viejos
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // tomar control de páginas abiertas
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorar extensiones de Chrome y peticiones no-HTTP
  if (!event.request.url.startsWith('http')) return;

  // Recursos externos que requieren red — pasar sin interceptar
  const isNetworkOnly = NETWORK_ONLY_ORIGINS.some(origin =>
    url.hostname.includes(origin)
  );
  if (isNetworkOnly) {
    event.respondWith(fetch(event.request).catch(() => {
      // Offline y necesita red — responder con mensaje de error JSON
      return new Response(
        JSON.stringify({ offline: true, error: 'Sin conexión a internet' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }));
    return;
  }

  // Fuentes de Google — Cache First (raramente cambian)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, 'cancionero-fonts'));
    return;
  }

  // HTML principal — Network First con fallback a cache
  // Así el usuario siempre recibe la versión más nueva si hay red,
  // y la versión cacheada si está offline.
  if (event.request.mode === 'navigate' ||
      (event.request.method === 'GET' && url.pathname === '/cancioneroicentral/' || url.pathname === '/cancioneroicentral') ||
      (event.request.method === 'GET' && url.pathname === '/cancioneroicentral/index.html')) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // Resto de assets estáticos — Cache First
  event.respondWith(cacheFirst(event.request, CACHE_NAME));
});

// ── ESTRATEGIAS ───────────────────────────────────────────────

/**
 * Cache First: busca en cache, si no está va a la red y guarda.
 */
async function cacheFirst(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline y no en cache — retornar respuesta vacía
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

/**
 * Network First: intenta red primero, si falla usa cache.
 * Siempre actualiza el cache cuando hay red.
 */
async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin red — servir desde cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // Ni red ni cache — página de error offline (no debería llegar aquí
    // después de la primera visita)
    return new Response(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Sin conexión — Cancionero ICentral</title>
        <style>
          body { font-family: sans-serif; display: flex; flex-direction: column;
                 align-items: center; justify-content: center; height: 100vh;
                 margin: 0; background: #f7f7f5; color: #3f3f46; text-align: center; padding: 2rem; }
          h1 { font-size: 1.5rem; margin-bottom: .5rem; }
          p  { font-size: .9rem; color: #71717a; max-width: 300px; }
          button { margin-top: 1.5rem; background: #4f46e5; color: #fff; border: none;
                   border-radius: 8px; padding: .75rem 1.5rem; font-size: .9rem;
                   cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>📵 Sin conexión</h1>
        <p>Abre el cancionero al menos una vez con internet para poder usarlo sin conexión.</p>
        <button onclick="location.reload()">Reintentar</button>
      </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 });
  }
}

// ── MENSAJE DESDE LA APP ──────────────────────────────────────
// La app puede enviar mensajes al SW, por ejemplo para forzar actualización
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
