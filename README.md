# COFTA 2026

Live tournament app for the **Coptic Orthodox Football Tournament Association**,
12–13 September 2026. Eight clubs, two groups of four, top two from each group
into the semi-finals.

Spectators open a link and watch scores update — no account, no sign-in.
Organisers sign in and run matches from their phones, one admin per pitch.

## Layout

```
web/                  static single-page app, no build step
supabase/migrations/  schema, write path, row level security
tests/                write-path verification
```

## Tournament format

- 20-minute halves
- Groups may end level — **no** shootouts in the group stage
- Semi-finals and the final go **straight to penalties** if level
- A shootout is stored apart from the score, so it never touches goal difference
- Forfeit awards 3–0 with no clock
- Standings: points, then goal difference, then goals scored

Head-to-head is the intended first tie-break but is not yet confirmed. Until it
is, qualification slots can be set by hand in the admin view, which also covers
disqualifications.

## How it survives a matchday

**The clock is timestamps, never a counter.** A match row stores an anchor
timestamp plus banked milliseconds. Every phone derives the minute locally, so
hundreds of spectators cost nothing, a refresh never loses the clock, and a
phone going to sleep does not matter.

**Nothing lives on a device.** If an organiser's phone dies mid-match, anyone
else opens the same match and the clock is still correct.

**A retry cannot double-count.** Event ids are generated client-side and are the
primary key, so the same goal sent three times on bad signal stores once.

**A second admin cannot corrupt a clock.** Clock writes carry the version they
believed they were acting on; a mismatch is rejected rather than applied.

**Undo cannot leave the score wrong.** Scores are recomputed from non-voided
events by trigger, so voiding an event moves the score back on its own.

All five are covered by `tests/write_path_test.sql`, which passes 9/9 against
the live database. The web app's own logic has 29 further tests covering
standings, qualification, shootouts, forfeits, the clock and the offline queue.

## Running it

Apply the migrations in order (`0001` … `0007`), then serve the web app:

```bash
cd web && python3 -m http.server 8080
```

It talks to the live Supabase project, so real fixtures appear immediately.

## Security

The key in `web/api.js` is the **publishable** key. It identifies the project
and grants nothing on its own. Every write goes through a `security definer`
function that checks admin membership, and there are no insert or update RLS
policies anywhere — so the key alone cannot change a single score.

Admin access is granted by email allowlist: an address is listed, and whoever
signs up with it is granted admin automatically by trigger. Real addresses are
not committed to this repo — see `0004_admin_allowlist.sql`.

## Still to do

- Cached snapshot route + CDN cache rule — the piece that handles hundreds of viewers
- Squad lists, for goalscorer attribution
- PWA shell, self-hosted fonts, crests moved to Storage
- Load test at 1,000 users, then a dry run at the venue
