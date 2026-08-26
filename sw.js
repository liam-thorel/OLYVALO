const CACHE_NAME = 'olycity-runtime-20260826-cold-load';
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    // Never delay the page while CacheStorage writes a copy. Waiting here made
    // a cold start serialize dozens of disk writes; F5 then looked magically
    // faster only because the cache had finally been populated.
    if (response.ok && response.type === 'basic') {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch:false })
      || (request.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (cached) return cached;
    throw error;
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
