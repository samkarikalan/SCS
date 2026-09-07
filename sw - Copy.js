/* =============================================
   CLUB Scheduler -- Service Worker
   Caches app shell for offline use
   ============================================= */

const CACHE_NAME = 'clubs-v1.10.2-organiser-more-only';

const ASSETS = [
  './index.html?v=171',
  './ui.css?v=186',
  './rounds.css?v=164',
  './snapshot.js?v=164',
  './supabase.js?v=165',
  './auth.js?v=164',
  './authUI.js?v=164',
  './subscription.js?v=164',
  './HomeScreen.js?v=165',
  './main.js?v=169',
  './engjap.js?v=177',
  './games.js?v=164',
  './rounds.js?v=164',
  './mbm.js?v=164',
  './players.js?v=164',
  './importPlayers.js?v=164',
  './settings.js?v=175',
  './summary.js?v=164',
  './help.js?v=164',
  './profile.js?v=164',
  './dashboard.js?v=164',
  './slots.js?v=190',
  './notifications.js?v=164',
  './viewer.js?v=164',
  './report.js?v=164',
  './manifest.json?v=164',
  './male.png?v=164',
  './female.png?v=164',
  './win-cup.png?v=164',
  './lock.png?v=164',
  './unlock.png?v=164',
  './icon-192.png?v=164',
  './icon-512.png?v=164',
  './help_en.json?v=164',
  './help_jp.json?v=164',
  './help_kr.json?v=164',
  './help_zh.json?v=164',
  './help_vi.json?v=164'
];

/* ── Install: cache all assets (safe -- one failure won't block install) ── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(
        ASSETS.map(function(url) {
          return cache.add(url).catch(function(e) {
            console.warn('SW: failed to cache', url, e);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* ── Message: SKIP_WAITING from page ── */
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Activate: clean up old caches and claim all clients ── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* ── Fetch: network first, cache as offline fallback ── */
self.addEventListener('fetch', function(event) {
  // Always go to network for API calls
  if (event.request.url.includes('supabase.co')) return;
  if (event.request.url.includes('workers.dev')) return;
  if (event.request.url.includes('/db/')) return;
  if (event.request.url.includes('/auth/')) return;
  if (event.request.url.includes('/sub/')) return;
  if (event.request.url.includes('/generate-round')) return;

  event.respondWith(
    fetch(event.request).then(function(response) {
      // Got fresh response — update cache and return it
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Offline — serve from cache
      return caches.match(event.request).then(function(cached) {
      return cached || caches.match('./index.html?v=171');
      });
    })
  );
});
