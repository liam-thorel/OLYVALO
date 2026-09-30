// Le workflow Pages remplace ce marqueur par le SHA du commit. Le fichier du
// Service Worker change donc à chaque déploiement et les PWA déjà ouvertes
// peuvent enfin détecter la nouvelle version sans F5.
const BUILD_ID = '__OLYCITY_BUILD_ID__';
const CACHE_NAME = `olycity-runtime-${BUILD_ID}`;
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('olycity-runtime-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let fallbackTimer;
  const cachedResponse = () => cache.match(request, { ignoreSearch:false })
    .then(cached => cached || (request.mode === 'navigate' ? cache.match('./index.html') : null));
  const network = fetch(request, { signal:controller.signal }).then(response => {
    if (response.ok && response.type === 'basic') {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  }).finally(() => clearTimeout(timeout));
  // Une copie déjà chargée reste utilisable si le réseau est lent. Le réseau
  // continue en arrière-plan, mais aucune requête ne peut attendre indéfiniment.
  event.waitUntil(network.then(() => {}, () => {}));
  try {
    return await Promise.race([network, new Promise(resolve => {
      fallbackTimer = setTimeout(() => {
        cachedResponse().then(cached => { if (cached) resolve(cached); }).catch(() => {});
      }, 1_500);
    })]);
  } catch (error) {
    const cached = await cachedResponse();
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(fallbackTimer);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(request, event));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body:event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'OLYCITY', {
    body:payload.body || '',
    icon:'./assets/pwa-icon-192.png?v=20260824-icon-3',
    badge:'./assets/pwa-icon-192.png?v=20260824-icon-3',
    tag:payload.tag || 'olycity',
    data:{ url:payload.url || './' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(openClients => {
    const existing = openClients.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});
