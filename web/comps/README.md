# Competition logos

The badge for a competition — COFTA, CONAFA, COSTA, COSA, the Ark Cup — as
distinct from a *club's* crest, which lives in `../crests/`.

Drop files here in the local clone — **never through the GitHub web UI**, which
lands cache-first assets without a `VERSION` bump so no device already holding
the old cache ever fetches them (see CLAUDE.md → Workflow).

## Naming

One file per competition, named by its `COMPS[].id` in `web/app.js`:

| competition | filename |
|---|---|
| COFTA | `cofta.webp` |
| Ladies COFTA | *(none — shares `cofta.webp`)* |
| CONAFA | `conafa.webp` |
| COSTA | `costa.webp` |
| COSA | `cosa.webp` |
| The Ark Cup | `ark.webp` |

**Ladies COFTA has no file of its own.** It is COFTA's women's competition
under the same association and the same badge, so it reads `cofta.webp`
rather than a duplicate that could drift out of step.

## What the file should be

- **Square, 192×192, transparent background.** The slot renders at roughly
  24–32px, so a square badge fills it and a landscape one letterboxes to
  something noticeably smaller — that is exactly what happened to
  `../diocese-midlands.webp`, which is 203×150.
- **Emblem only, no wordmark.** A logo with "COSTA" or the full association
  name baked into it will be illegible at this size *and* will sit directly
  beside the same words set in real type, saying it twice — once unreadably.

## A competition with no logo

**Do not invent one.** The archive's standing rule for clubs applies here:
a club with no crest gets a deterministic monogram, never fabricated
branding. A competition with no file falls back to its name set in its own
identity colour, which every competition already has as `--ci` / `--cl` in
`styles.css`, scoped by `[data-comp]`.

COSTA has no logo as of August 2026 and is the case this fallback exists for.
A gap should look deliberate rather than broken, and neither should be filled
with a guess.

## Wiring a file in

Unlike club crests, these are not stored in the database — a competition is
frontend-level (`COMPS` in `web/app.js`), the same place its name, category,
host and diocese already live. Adding a file is picked up by filename; bump
`VERSION` in `sw.js` in the same commit.
