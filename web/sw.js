/**
 * COFTA 2026 service worker.
 *
 * The shell — HTML, scripts, styles, fonts, crests — is cached so the app
 * opens instantly and works with no signal at all. Live data is NOT touched
 * here: the snapshot goes to Supabase directly, and the app keeps its own
 * last-known copy for offline boot. Bump VERSION on any deploy that should
 * push a fresh shell.
 */
const VERSION = 'cofta-v73';
const SHELL = [
  './', './index.html', './diocese.webp',
  // Code and stylesheets carry the build token, because THE BROWSER'S OWN HTTP
  // CACHE SITS IN FRONT OF THIS WORKER and Pages serves them max-age=14400.
  // See the long note above `fresh` — an unversioned ./app.js is answered from
  // that cache without this file ever being consulted. A versioned URL cannot
  // be answered from it, because on a fresh deploy the URL is one the browser
  // has never seen. These must stay in step with index.html and app.js;
  // tools/check-build.sh fails if they drift.
  './styles.css?b=cofta-v73', './fonts.css?b=cofta-v73', './themes.css?b=cofta-v73',
  './app.js?b=cofta-v73', './api.js?b=cofta-v73', './model.js?b=cofta-v73',
  './queue.js?b=cofta-v73', './crests.js?b=cofta-v73',
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
 * the first real execution of that path would be a spectator's phone.
 *
 * AND `fresh` WAS NOT ENOUGH, because this worker was never asked. Measured on
 * production 2026-08-24, resource timing for one ordinary reload:
 *
 *     /            transferSize 3421   workerStart > 0    <- through the worker
 *     /app.js      transferSize 0      workerStart 0      <- NOT through it
 *     /model.js    transferSize 0      workerStart 0
 *     /styles.css  transferSize 0      workerStart 0      ... and so on
 *
 * The browser's HTTP cache sits IN FRONT of a service worker for subresource
 * loads. Pages serves the modules `max-age=14400`, so for four hours after a
 * deploy the browser answered every one of them itself and this file never ran.
 * A push landed on the CDN in twenty seconds and the phone went on executing
 * yesterday's code. Two reloads sometimes cured it only by accident: the
 * `cache: 'reload'` fetches below refresh the browser's HTTP entry as a side
 * effect, so the load AFTER that one saw new bytes. On a home-screen PWA that
 * is resumed rather than reloaded, the cure never arrives, which is why the
 * report was "I had to delete the app and clear site data".
 *
 * THE FIX IS IN THE URL, NOT IN THIS FILE. Every module and stylesheet now
 * carries `?b=<VERSION>`. A fresh deploy means a URL the browser has never
 * seen, so its cache cannot answer, and the header we are not allowed to set
 * stops mattering. `web/_headers` was the obvious lever and does nothing on
 * this project — proven twice, with a custom probe header that never appeared.
 *
 * Which flips the strategy for those files. A versioned URL is IMMUTABLE by
 * construction — its contents can never change, because changing them changes
 * the URL — so it is cache-first like the fonts, not network-first. That also
 * takes ~250KB per page load off the weekend's egress, which network-first
 * with `cache: 'reload'` would otherwise have re-downloaded in full every
 * single time now that the worker actually sees these requests.
 *
 * Only the navigation stays network-first, and it is the one thing that must:
 * it is what names the current build. Pages already serves `/` as
 * `max-age=0, must-revalidate`, so it revalidates on every load.
 *
 * The try/catch is the same instinct as everything else here. If an engine
 * dislikes any of this the fallback is the original request — an asset a
 * version behind, which is where we already were — and never a blank screen.
 * A caching optimisation must not be able to take the site down.
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

  // Cache-first covers two kinds of thing that cannot go stale.
  //
  //   * Fonts and crests, which do not change between deploys — and when one
  //     genuinely does change, VERSION moves and the whole cache is dropped.
  //   * ANYTHING CARRYING THE BUILD TOKEN. A `?b=cofta-vNN` URL is immutable by
  //     construction: its bytes cannot change, because changing them changes
  //     VERSION and therefore the URL. Serving those from cache is not a
  //     staleness risk, it is the entire point — a stale copy under an old
  //     token is simply never requested again, because the freshly revalidated
  //     index.html only ever names the current one.
  const immutable = /\.(?:woff2|webp|png)$/.test(url.pathname)
                 || url.searchParams.has('b');

  if (immutable) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(fresh(e.request)).then(res => {
        if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // What is left is the navigation and anything unversioned, and the
  // navigation is the one that matters: it is the document that names which
  // build the page should load. It MUST be network-first, because every
  // versioned URL above is only as current as the HTML that points at it.
  // The cache is the offline fallback, never the primary source.
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
