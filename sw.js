/*
      ██╗          ██╗     ██╗
      ██║          ╚██╗   ██╔╝
      ██║           ╚██╗ ██╔╝ 
      ██║            ╚████╔╝  
      ██║             ╚██╔╝   
      ██║             ██╔██╗  
      ██║            ██╔╝ ╚██╗ 
      ██║           ██╔╝   ╚██╗
      ██████████╗  ██╔╝     ╚██╗
      ██████████║  ╚═╝       ╚═╝
      ╚═════════╝               
*/

const CACHE_NAME = 'fep-schedule-v7';
const OFFLINE_PAGE = './index.html';

const PRECACHE_URLS = [
    './index.html',
    './manifest.json',
    './script.js',
    './logo.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

const NETWORK_ONLY_PATTERNS = [
    'firebaseio.com',
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'gstatic.com/firebasejs',
    'workers.dev',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            for (const url of PRECACHE_URLS) {
                try {
                    await cache.add(url);
                } catch (e) {
                    console.warn('[SW] Не вдалось закешувати:', url, e.message);
                }
            }
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => {
                        console.log('[SW] Видаляємо старий кеш:', key);
                        return caches.delete(key);
                    })
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const isNetworkOnly = NETWORK_ONLY_PATTERNS.some((p) => request.url.includes(p));
    if (isNetworkOnly) {
        event.respondWith(fetch(request));
        return;
    }

    // Navigation requests: Network-First with cache fallback
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(OFFLINE_PAGE);
                    return cached || new Response('<h1>Офлайн</h1><p>Відкрий сайт з кешу або підключись до мережі.</p>', {
                        headers: { 'Content-Type': 'text/html; charset=utf-8' },
                    });
                })
        );
        return;
    }

    const url = new URL(request.url);
    const isLocalAsset = url.origin === self.location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.json'));

    // Local application scripts/manifest: Network-first to ensure latest version, fallback to cache
    if (isLocalAsset) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // External assets & images: Cache-first with network fallback
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;

            return fetch(request)
                .then((response) => {
                    if (!response.ok || response.type === 'opaque') return response;
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => {
                    if (request.destination === 'image') {
                        return new Response('', { status: 204 });
                    }
                });
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    if (event.data === 'getCacheVersion') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
});
