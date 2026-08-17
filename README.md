# COFTA 2026

Live tournament app for the **Coptic Orthodox Football Tournament Association**,
12–13 September 2026. Eight clubs, two groups of four, top two from each group
into the semi-finals, then a final.

Spectators open a link and watch scores update — no account, no sign-in.
Organisers sign in and run matches from their phones, one admin per pitch.

Production: **https://cofta.co.uk**

## Layout

```
web/                  static single-page app, no build step
supabase/migrations/  schema, write path, row level security
tests/                write-path and model verification
```

`web/` is the whole front end: `app.js` (views and one delegated click
handler), `model.js` (pure rules — standings, tie-breaks, clock, scorer
lines, leaderboards), `api.js` (Supabase REST and auth), `queue.js` (offline
write queue), `crests.js`. No framework, no bundler, no dependencies.

## Tournament format

- 20-minute halves
- Groups may end level — **no** shootouts in the group stage
- Semi-finals and the final go **straight to penalties** if level
- A shootout is stored apart from the score, so it never touches goal difference
- Forfeit awards 3–0 with no clock
- Standings: points, then head-to-head, then goal difference, then goals scored
- Anything those cannot separate goes to a one-off penalty shoot-out, recorded
  as a real result and used as the fifth tie-break

Head-to-head is a mini-league among only the tied clubs, not a pairwise
comparison — with three clubs level the comparison is not transitive, and a
naive comparator gets it wrong. Qualification slots can still be set by hand
for a disqualification.

## Discipline

Two yellows in separate matches, or one red, and the player misses their own
club's next fixture. Yellows are counted per phase: a booking in the group
stage and one in a semi-final do not combine.

## Awards and trophies

Three awards, each with its own leaderboard: golden boot (goals), player of
the tournament (man of the match awards), golden glove (goals conceded, by
club). Leaderboards use standard competition ranking, so joint second is
followed by fourth.

Leading a board is not the same as winning the trophy. Once the final is over,
an organiser confirms each trophy explicitly against a player — including the
golden glove, which is counted by club but presented to a goalkeeper that no
column in the database can identify. Confirmed winners appear on the award
card and on the player's own profile under Honours.

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

**A deploy reaches every phone.** The service worker is network-first for code
and markup, cache-first for fonts and crests. `VERSION` in `sw.js` is bumped
whenever a cached asset changes.

## Tests

```bash
node tests/model_test.mjs
```

covers the pure logic in `model.js` — the leaderboard ranking and the trophy
helpers. `tests/write_path_test.sql` covers the five database guarantees above
and runs against the live project.

Anything touching rules, ordering or the clock belongs in `model.js` with a
test beside it. Anything touching `app.js` should at minimum be *executed*
before shipping, not just parsed: a module-evaluation crash ships as an
infinite "Loading…" screen.

## Running it

Apply the migrations in order, then serve the web app from `web/`:

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
signs up with it is granted admin automatically by trigger. Roles are
`organiser` (full access, including reset and trophies) and `pitch` (run
matches, log events, enter shoot-outs). Real addresses are not committed to
this repo — see `0004_admin_allowlist.sql`.

## State

Feature-complete and load-tested: 1,000 concurrent spectators, no failures,
p95 58ms. Squads and managers currently in the database are **test data** and
are cleared before the real lists are entered.

Still outstanding: the final draw, timetable, squads and 2026 rules from the
association; the real Kidane Mihret crest; a venue dry run on real phones.
