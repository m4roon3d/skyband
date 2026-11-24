// skyband service worker: intentionally does no caching.
// It exists so browsers treat skyband as an installable app. A caching layer would risk
// serving stale versions of the single-file app (and of live radio metadata), so every
// request goes straight to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only: no respondWith, the browser handles it */ });
