# COFTA 2026 — web app

Static single-page app. No build step, no framework, no dependencies.
Drop the folder on any static host and it works.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell, fonts, meta |
| `styles.css` | The COFTA theme |
| `app.js` | Views, polling, admin controls |
| `model.js` | Clock maths and standings — pure functions |
| `api.js` | Supabase REST calls, auth, session refresh |
| `crests.js` | Club crests inlined as data URIs |

## How it stays fast under load

Spectators only ever call `snapshot()`, which returns the whole tournament in
one small payload. Behind a CDN with a 5-second TTL, hundreds of viewers
collapse into roughly one origin request every five seconds.

The clock is **derived locally** from the anchor timestamp on each match row,
so it ticks smoothly four times a second between polls. Polling latency never
shows up as a lagging clock. Each poll also carries the server's `now`, so
every device silently re-corrects its own clock drift.

## Deploying to Cloudflare Pages

1. Push this folder to GitHub.
2. Cloudflare Pages → Create project → connect the repo.
3. Framework preset **None**, build command empty, output directory `/`.
4. Add a Cache Rule for the snapshot response: edge TTL 5s,
   `stale-while-revalidate` 60s. **This is the step that matters** — without
   it every request falls through to the origin.

## Local preview

    python3 -m http.server 8080

then open http://localhost:8080. It talks to the live Supabase project, so
you will see real data immediately.

## Security notes

The publishable key in `api.js` is meant to be public — it identifies the
project, it does not grant anything. All write functions require a signed-in
admin, and there are no insert or update RLS policies at all, so the key alone
cannot change a single score.

## Not done yet

- Cache rule + custom domain
- Goalscorer attribution (needs squad lists in `players`)
- Offline write queue for the admin views
- PWA shell and icons
- Crests moved to Storage so they are not inlined in the JS
