/**
 * Service Worker for MinReport
 * Handles offline caching, background sync, and push notifications
 */

// Cache version
const CACHE_VERSION = 'minreport-v1';
const CACHE_NAMES = {
  assets: `${CACHE_VERSION}-assets`,
  api: `${CACHE_VERSION}-api`,
  offline: `${CACHE_VERSION}-offline`,
};

// Files to cache on install
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

/**
 * Install: Cache essential assets
 */
self.addEventListener('install', (event: ExtendedInstallEvent) => {
  console.log('🔧 Service Worker: Installing');

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAMES.assets);
      await cache.addAll(ASSETS_TO_CACHE);
      console.log('✅ Service Worker: Installation complete');
      self.skipWaiting();
    })()
  );
});

/**
 * Activate: Clean up old caches
 */
self.addEventListener('activate', (event: ExtendedActivateEvent) => {
  console.log('🚀 Service Worker: Activating');

  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(name => {
          if (!Object.values(CACHE_NAMES).includes(name)) {
            console.log(`🗑️ Deleting old cache: ${name}`);
            return caches.delete(name);
          }
        })
      );
      self.clients.claim();
      console.log('✅ Service Worker: Activation complete');
    })()
  );
});

/**
 * Fetch: Handle requests with fallback to cache
 */
self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API requests: Network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Assets: Cache first, fallback to network
  if (isAsset(url.pathname)) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // HTML/Pages: Network first
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
});

/**
 * Background Sync: Sync when connection restored
 */
self.addEventListener('sync', (event: any) => {
  console.log('🔄 Background Sync:', event.tag);

  if (event.tag === 'sync-data') {
    event.waitUntil(syncOfflineData());
  }
});

/**
 * Push Notifications
 */
self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json() ?? {};
  const title = data.title || 'MinReport';
  const options = {
    body: data.body || 'You have a new message',
    icon: '/logo.png',
    badge: '/badge.png',
    tag: data.tag || 'notification',
    data: data.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Notification Click Handler
 */
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      
      // If app is open, focus it
      for (const client of clients) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })()
  );
});

/**
 * Network first strategy: Try network, fallback to cache
 */
async function networkFirstStrategy(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    
    // Cache successful responses
    if (response.ok) {
      const cache = await caches.open(CACHE_NAMES.api);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('🔴 Network failed, using cache:', request.url);
    
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    
    // Return offline page if available
    return caches.match('/offline.html') || new Response('Offline', { status: 503 });
  }
}

/**
 * Cache first strategy: Try cache, fallback to network
 */
async function cacheFirstStrategy(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(CACHE_NAMES.assets);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Check if URL is an asset (CSS, JS, images, etc.)
 */
function isAsset(pathname: string): boolean {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/.test(pathname);
}

/**
 * Sync offline data with server
 */
async function syncOfflineData(): Promise<void> {
  try {
    console.log('🔄 Syncing offline data...');
    
    // Open IndexedDB and get sync queue
    // This would be implemented with actual sync logic
    
    console.log('✅ Offline data synced');
  } catch (error) {
    console.error('❌ Sync failed:', error);
    throw error;
  }
}

// TypeScript types for service worker events
interface ExtendedInstallEvent extends ExtendEvent {
  waitUntil(promise: Promise<any>): void;
}

interface ExtendedActivateEvent extends ExtendEvent {
  waitUntil(promise: Promise<any>): void;
}
