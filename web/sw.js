/**
 * COFTA 2026 service worker.
 *
 * The shell — HTML, scripts, styles, fonts, crests — is cached so the app
 * opens instantly and works with no signal at all. Live data is NOT touched
 * here: the snapshot goes to Supabase directly, and the app keeps its own
 * last-known copy for offline boot. Bump VERSION on any deploy that should
 * push a fresh shell.
 */
const VERSION = 'cofta-v2';
const SHELL = [
  './', './index.html', './styles.css', './fonts.css', './themes.css', './diocese.webp',
  './app.js', './api.js', './model.js', './queue.js', './crests.js',
  './manifest.webmanifest',
  './crests/smpk.webp','./crests/ste.webp','./crests/cro.webp','./crests/bri.webp',
  './crests/gg.webp','./crests/hove.webp','./crests/rot.webp','./crests/stm.webp',
  './fonts/big-shoulders-display-latin-700-normal.woff2',
  './fonts/big-shoulders-display-latin-800-normal.woff2',
  './fonts/big-shoulders-display-latin-900-normal.woff2',
  './fonts/saira-condensed-latin-500-normal.woff2',
  './fonts/saira-condensed-latin-600-normal.woff2',
  './fonts/saira-condensed-latin-700-normal.woff2',
  './fonts/spectral-latin-400-normal.woff2',
  './fonts/spectral-latin-400-italic.woff2',
  './fonts/spectral-latin-600-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Shell: cache first for speed, refresh in the background for next time.
  e.respondWith(
    caches.match(e.request).then(hit => {
      const refresh = fetch(e.request).then(res => {
        if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
