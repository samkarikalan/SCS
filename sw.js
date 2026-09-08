// SCS_BUILD_50_MYHUB_EMBEDDED_CLUBS_REPORT
/* Sports Club Scheduler service worker — complete installed-app updates. */
const CACHE_NAME = 'scs-app-build-1067-round-start-safearea-fix';
const APP_SHELL = './index.html?v=1067';

const ASSETS = [
  APP_SHELL,
  './ui.css?v=1067', './rounds.css?v=1004',
  './offline-db.js?v=917', './offline-rounds.js?v=979', './snapshot.js?v=891', './supabase.js?v=936', './auth.js?v=856',
  './authUI.js?v=1047', './subscription.js?v=856', './HomeScreen.js?v=1067',
  './engjap.js?v=864', './main.js?v=1067', './games.js?v=1019',
  './rounds.js?v=937', './mbm.js?v=856', './players.js?v=906',
  './importPlayers.js?v=985', './settings.js?v=987', './summary.js?v=856',
  './help.js?v=856', './profile.js?v=856', './dashboard.js?v=856',
  './slots.js?v=896', './notifications.js?v=856', './viewer.js?v=856',
  './report.js?v=856', './manifest.json?v=953',
  './male.png?v=856', './female.png?v=856', './win-cup.png?v=856',
  './welcome-default-myhub.png?v=1015', './welcome-default-round-manager.png?v=1015', './welcome-default-slot-manager.png?v=1015',
  './lock.png?v=856', './unlock.png?v=856', './icon-192.png?v=856',
  './icon-512.png?v=856', './clubs-brand.png?v=856', './google-g.svg?v=856', './help_en.json?v=857', './help_jp.json?v=857',
  './help_kr.json?v=857', './help_zh.json?v=857', './help_vi.json?v=857'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(ASSETS.map(function(url) {
        return fetch(new Request(url, { cache: 'reload' })).then(function(response) {
          if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status));
          return cache.put(url, response);
        });
      }));
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(key) { return key !== CACHE_NAME; })
        .map(function(key) { return caches.delete(key); }));
    }).then(function() { return self.clients.claim(); })
  );
});

function isApiRequest(url) {
  return url.includes('supabase.co') || url.includes('workers.dev') ||
    url.includes('/db/') || url.includes('/auth/') || url.includes('/sub/') ||
    url.includes('/generate-round');
}

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET' || isApiRequest(event.request.url)) return;
  const isNavigation = event.request.mode === 'navigate';

  event.respondWith((async function() {
    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(isNavigation ? APP_SHELL : event.request, response.clone());
      }
      return response;
    } catch (error) {
      if (isNavigation) return (await caches.match(APP_SHELL)) || Response.error();
      return (await caches.match(event.request)) ||
        (await caches.match(event.request, { ignoreSearch: true })) ||
        Response.error();
    }
  })());
});
