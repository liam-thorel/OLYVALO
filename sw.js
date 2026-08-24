const CACHE_NAME = 'olycity-shell-20260824-2';
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
