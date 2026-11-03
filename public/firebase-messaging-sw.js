// One-release cleanup shim for browsers that previously installed the retired
// Firebase Messaging worker. This worker intentionally loads no third-party SDK.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const registrations = await self.registration.unregister();
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => /firebase|fcm/i.test(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
    return registrations;
  })());
});
