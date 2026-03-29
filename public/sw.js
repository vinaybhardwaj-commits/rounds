// ============================================
// Rounds — Service Worker (PWA)
// Step 7.1: Offline shell, push notifications
// ============================================

const CACHE_NAME = 'rounds-v1';
const OFFLINE_URL = '/offline';

// Static assets to precache for app shell
const PRECACHE_URLS = [
  '/',
  '/offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── Install: precache app shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first with offline fallback ──
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API calls — always go to network
  if (request.url.includes('/api/')) return;

  // Skip GetStream requests
  if (request.url.includes('stream-io') || request.url.includes('getstream')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses for Next.js pages
        if (response.ok && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(async () => {
        // Try cache first
        const cached = await caches.match(request);
        if (cached) return cached;

        // For navigation requests, serve offline page
        if (request.mode === 'navigate') {
          const offlinePage = await caches.match(OFFLINE_URL);
          if (offlinePage) return offlinePage;
        }

        // Return a simple offline response
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      })
  );
});

// ── Push Notifications ──
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Rounds', body: event.data?.text() || 'New notification' };
  }

  const title = data.title || 'Rounds — Even Hospital';
  const options = {
    body: data.body || 'You have a new update',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'rounds-notification',
    data: {
      url: data.url || '/',
      channelId: data.channelId || null,
    },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: data.urgent || false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: navigate to relevant page ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url,
            channelId: event.notification.data?.channelId,
          });
          return;
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(url);
    })
  );
});
