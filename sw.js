const CACHE_NAME = 'olycity-shell-20260824-boot-recovery';
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest', './assets/logo.svg',
  './assets/pwa-icon-192.png', './assets/pwa-icon-512.png',
  './assets/home/valorant-keyart.webp', './assets/home/league-champions-group.webp', './assets/home/peak-keyart.webp',
  './data/comps.json', './data/roster.json', './data/members.json', './data/roles.json',
  './data/agents-fr.json', './data/lineups.json', './data/meta.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(caches.match(request).then(cached => {
    const network = fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
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
