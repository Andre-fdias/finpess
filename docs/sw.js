/**
 * Finpess PWA Service Worker
 * Fornece caching instantâneo para o shell do app e conformidade total com WebAPK no Chrome Android.
 */

const CACHE_NAME = 'finpess-shell-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

// Instalação: armazena os recursos do Shell local em cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[Finpess SW] Alguns assets não puderam ser cacheados:', err);
      });
    })
  );
  self.skipWaiting();
});

// Ativação: limpa caches antigos se houver nova versão
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptação de requisições
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Se for recurso local do shell do GitHub Pages, tenta o cache primeiro
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Atualiza em background para a próxima vez (Stale-While-Revalidate)
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(event.request);
      })
    );
    return;
  }

  // Requisições externas (Google Apps Script, cotações, etc.): sempre direto da rede
  event.respondWith(
    fetch(event.request).catch(() => {
      // Se offline e tentou carregar recurso crítico do shell, retorna cache
      return caches.match('./index.html');
    })
  );
});
