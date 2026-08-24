const CACHE_NAME = 'olycity-shell-20260824-refresh-recovery';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

// The worker is intentionally notification-only. Let the browser load every
// page, module and JSON file directly: intercepting them made some Chromium
// sessions keep an incomplete application shell after a normal refresh.

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
