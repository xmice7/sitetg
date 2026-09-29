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

const CACHE_NAME = 'fep-schedule-v9-absences';
const OFFLINE_PAGE = './index.html';

const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './script.js',
    './logo.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://telegram.org/js/telegram-web-app.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
];

const NETWORK_ONLY_PATTERNS = [
    'firebaseio.com',
    'firestore.googleapis.com',
    'firebase.googleapis.com'
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

async function getCachedIndex(request) {
    return (
        (await caches.match(request)) ||
        (await caches.match(OFFLINE_PAGE)) ||
        (await caches.match('./index.html')) ||
        (await caches.match('/index.html')) ||
        (await caches.match('./')) ||
        (await caches.match('/'))
    );
}

// Navigation handler: Opens immediately even on weak/no internet
async function handleNavigation(request) {
    const cachedResponse = await getCachedIndex(request);

    // Fast network race with 1500ms timeout
    const fetchWithTimeout = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        try {
            const response = await fetch(request, { signal: controller.signal });
            clearTimeout(timer);
            if (response && response.ok) {
                const clone = response.clone();
                const cache = await caches.open(CACHE_NAME);
                cache.put(request, clone);
                cache.put(OFFLINE_PAGE, response.clone());
            }
            return response;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    };

    if (cachedResponse) {
        try {
            return await fetchWithTimeout();
        } catch (e) {
            return cachedResponse;
        }
    }

    try {
        return await fetch(request);
    } catch (e) {
        const fallback = await getCachedIndex(request);
        return fallback || new Response('<h1>Офлайн</h1><p>Розклад доступний з кешу. Будь ласка, оновіть сторінку при наявності з\'єднання.</p>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }
}

// Local assets handler: Stale-While-Revalidate
async function handleLocalAsset(request) {
    const cached = await caches.match(request);
    const networkPromise = fetch(request).then(async (response) => {
        if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    }).catch(() => null);

    return cached || (await networkPromise);
}

// API handler (e.g. workers.dev for schedule/groups): Fast network with cache fallback
async function handleApiRequest(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timer);
        if (response && response.ok) {
            const clone = response.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, clone);
        }
        return response;
    } catch (e) {
        clearTimeout(timer);
        const cached = await caches.match(request);
        if (cached) return cached;
        throw e;
    }
}

// External assets & images: Cache-first with network fallback
async function handleExternalAsset(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
            const clone = response.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, clone);
        }
        return response;
    } catch (e) {
        if (request.destination === 'image') {
            return new Response('', { status: 204 });
        }
        throw e;
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const isNetworkOnly = NETWORK_ONLY_PATTERNS.some((p) => request.url.includes(p));
    if (isNetworkOnly) {
        event.respondWith(fetch(request));
        return;
    }

    // Navigation requests (HTML pages)
    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request));
        return;
    }

    const url = new URL(request.url);

    // Schedule / Groups API requests
    if (url.hostname.includes('workers.dev')) {
        event.respondWith(handleApiRequest(request));
        return;
    }

    // Local static assets
    const isLocalAsset = url.origin === self.location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.json') || url.pathname.endsWith('.png'));
    if (isLocalAsset) {
        event.respondWith(handleLocalAsset(request));
        return;
    }

    // External assets & CDN
    event.respondWith(handleExternalAsset(request));
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    if (event.data === 'getCacheVersion') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
});
