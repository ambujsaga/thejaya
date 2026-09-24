/* ================= THE JAYA — OFFLINE SERVICE WORKER =================
   Ye service worker app ke "shell" (HTML, manifest, logo, CDN se aane
   wali CSS/JS files) ko device ke andar cache kar leta hai, taaki Chrome
   se PWA shortcut add karne ke baad app bina internet ke bhi khul sake —
   bilkul WhatsApp jaisa. Asli data (posts, comments, likes, profile) ka
   offline kaam Firestore ki apni persistentLocalCache handle karti hai
   (jo index.html me already add kiya ja chuka hai) — ye service worker
   sirf app ki "skin" (design/files) ko offline available banata hai.
*/

const CACHE_VERSION = 'jaya-shell-v1';

// App shell: sabse zaroori files jo bina inke app khul hi nahi sakta.
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './logo.jpg?v=1.1',
    'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js'
];

// -------- INSTALL: app shell ko pehli baar cache karo --------
self.addEventListener('install', (event) => {
    self.skipWaiting(); // naya SW turant activate ho, purane ka wait na kare
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => {
            return Promise.all(
                APP_SHELL.map((url) =>
                    cache.add(url).catch((err) => {
                        // Ek asset fail ho jaye (jaise offline hi install ho raha ho) to
                        // poora install fail na ho — baaki files phir bhi cache ho jayengi.
                        console.log('SW: skip caching', url, err);
                    })
                )
            );
        })
    );
});

// -------- ACTIVATE: purane version ke caches saaf karo --------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_VERSION)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// -------- FETCH: network-first (fresh data), offline hote hi cache se serve --------
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Sirf GET requests handle karo — POST/PUT wagera (Firestore ke apne
    // requests) is service worker se bilkul untouched rehte hain.
    if (req.method !== 'GET') return;

    // Firestore/Auth ke live network calls ko is SW se bypass rakhna
    // behtar hai — Firestore ka apna offline cache (IndexedDB) unhe
    // already sambhalta hai, do systems ko clash nahi karna.
    const url = req.url;
    if (url.includes('firestore.googleapis.com') || url.includes('identitytoolkit') || url.includes('itunes.apple.com')) {
        return;
    }

    // HTML page navigation (jab user app kholta hai / reload karta hai)
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', clone));
                    return res;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Baaki static assets (logo, CDN CSS/JS, icons): cache-first, aur
    // background me fresh copy la kar cache update kar dena (stale-while-revalidate)
    event.respondWith(
        caches.match(req).then((cached) => {
            const networkFetch = fetch(req)
                .then((res) => {
                    if (res && res.status === 200) {
                        const clone = res.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
                    }
                    return res;
                })
                .catch(() => cached); // offline hai aur cache bhi nahi mila to yahi fail hoga

            return cached || networkFetch;
        })
    );
});
