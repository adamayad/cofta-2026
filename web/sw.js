/**
 * COFTA 2026 service worker.
 *
 * The shell — HTML, scripts, styles, fonts, crests — is cached so the app
 * opens instantly and works with no signal at all. Live data is NOT touched
 * here: the snapshot goes to Supabase directly, and the app keeps its own
 * last-known copy for offline boot. Bump VERSION on any deploy that should
 * push a fresh shell.
 */
const VERSION = 'cofta-v68';
const SHELL = [
  './', './index.html', './styles.css', './fonts.css', './themes.css', './diocese.webp',
  './app.js', './api.js', './model.js', './queue.js', './crests.js',
  './manifest.webmanifest',
  // The home-screen icons. Cache-first like every other asset, so a phone
  // that already installed the app only refetches them when VERSION moves.
  // cofta-icon-source.png is master art, never rendered, deliberately absent.
  './icon-192.png','./icon-512.png','./icon-maskable.png','./apple-touch-icon.png',
  // Archive crests are deliberately NOT precached. They are already
  // cache-first at runtime (the .webp branch in the fetch handler), so they
  // land on the first History visit and are then free. Precaching them would
  // make every spectator download ~190KB of art for a tab most never open,
  // on a weekend whose egress budget is the reason for the Pro upgrade.
  './crests/smpk.webp','./crests/ste.webp','./crests/cro.webp','./crests/bri.webp',
  './crests/gg.webp','./crests/km.webp','./crests/rot.webp','./crests/stm.webp',
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

/**
 * Every fetch this worker makes to FILL its cache bypasses the browser's own
 * HTTP cache, and it has to.
 *
 * Cloudflare Pages serves everything `max-age=14400, must-revalidate`. A plain
 * `fetch()` inside a service worker still reads that HTTP cache, so bumping
 * VERSION emptied the old cache and then refilled it from the browser's
 * four-hour-old copy of the very file the bump existed to replace. The bump
 * looked like it worked and changed nothing. That is how a corrected crest sat
 * on the CDN, verified by curl, while the phone kept drawing the old one.
 *
 * `cache: 'reload'` skips the HTTP cache on the way out and updates it on the
 * way back. It costs one real request per asset per VERSION, which is the
 * price of the bump meaning what it says.
 *
 * NAVIGATIONS ARE LEFT ALONE, deliberately. A Request whose mode is 'navigate'
 * cannot be re-constructed with an init — `new Request(navRequest, {…})` throws
 * TypeError in Chrome — and every page load is such a request. Rebuilding one
 * from its URL does work, but it silently changes mode and redirect handling on
 * the single code path that decides whether anyone sees the app at all, and
 * this cannot be tested locally: the dev server cannot register a worker, so
 * the first real execution of that path would be a spectator's phone. The HTML
 * gets its freshness from `Cache-Control: no-cache` in `web/_headers` instead,
 * which needs no code and cannot fail closed.
 *
 * The try/catch is the same instinct. If an engine dislikes any of this the
 * fallback is the original request — an asset a version behind, which is where
 * we already were — and never a blank screen. A caching optimisation must not
 * be able to take the site down.
 */
const fresh = (req) => {
  if (req.mode === 'navigate') return req;
  try {
    return new Request(req, { cache: 'reload' });
  } catch (_) {
    return req;
  }
};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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

  // Fonts and crests never change between deploys: cache first, instant.
  const immutable = /\.(?:woff2|webp|png)$/.test(url.pathname);

  if (immutable) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(fresh(e.request)).then(res => {
        if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Code and markup: network first, so a deploy lands on the very next
  // reload. The cache is the offline fallback, not the primary source —
  // the cache-first version of this handler left phones one deploy behind.
  //
  // "Network" has to mean the network, not the browser's four-hour copy of
  // it, or this is cache-first again wearing a different name: same URL, same
  // stale bytes, one layer down. Hence `fresh` here too.
  e.respondWith(
    fetch(fresh(e.request)).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit =>
        hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
    )
  );
});
