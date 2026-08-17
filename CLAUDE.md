# COFTA 2026 — live tournament scores app

Live scores, tables, squads, leaderboards and trophies for the Coptic
Orthodox Football Tournament Association weekend, **12–13 September 2026**.
Eight church clubs, two groups of four (each plays each other once), top two
to semi-finals, final. Production: **https://cofta.co.uk** (www redirects to
the bare domain).

## Architecture

- **Frontend** `web/`: vanilla-JS single-page app, no build step, no framework.
  Modules: `app.js` (views + one delegated click handler), `model.js` (pure
  rules: standings, tie-breaks, clock, scorer lines, leaderboard ranking,
  trophy helpers — all unit-testable), `api.js` (Supabase REST + auth),
  `queue.js` (offline write queue, idempotent, survives restarts via
  localStorage), `crests.js` (id → webp path map).
- **Hosting**: Cloudflare Pages, project `cofta-2026`, auto-deploys `main`,
  output dir `web`. **A push to main IS a deploy** (~1 min).
- **Database**: Supabase, project ref `faodniafqglgzmdosgfq`. All writes go
  through security-definer SQL functions with `is_admin()` / role checks;
  spectators poll a single `snapshot()` RPC every 5s. RLS on everything.
- **Auth**: username-style accounts on reserved domain (`pitch1@cofta.example`).
  Roles: `organiser` (full, incl. reset and trophies) vs `pitch`. Allowlist
  table + trigger grants roles on user creation.
- **PWA**: `sw.js` — network-first for code/HTML (deploys land on first
  reload), cache-first for fonts/crests/icons. **Bump `VERSION` in sw.js
  whenever any cached asset changes** (fonts, crests, PWA icons), otherwise
  old devices keep stale copies forever.

## Workflow

- The repo is the source of truth and **git is the delivery path**: clone,
  branch or commit on `main`, push. Manual "Add files via upload" through the
  GitHub web UI is history, not practice — every commit since `74b896f`
  arrived this way.
- Commit messages say what changed **and why**, one concern per commit.
- Migrations live in `supabase/migrations/`, numbered, one concern each,
  currently `0001` … `0018`. Apply to the live DB via the Supabase dashboard
  SQL editor or the MCP connector. Note the connector records its own
  timestamped version strings (`20260817081714`), so a file numbered `0018`
  never "claims" 0018 in `supabase_migrations.schema_migrations`.
- The Supabase connector in the claude.ai chat remains read-capable and can
  apply migrations. It is read-write by design — treat `execute_sql` against
  production with the same care as the dashboard.
- `DRAFT_apply_real_draw.sql` is a fill-in template for draw day — not
  runnable until the ⟨TODO⟩s are filled.

## Conventions and hard-won gotchas

- **Any feature commit that changes architecture, conventions or workflows
  updates this file in the same commit.** A CLAUDE.md that lags the code is
  worse than none: it is confidently wrong.
- Supabase preloads `safeupdate` on API connections: any bulk
  `DELETE`/`UPDATE` inside functions needs an explicit `where true`.
- `DROP FUNCTION` kills grants; every migration that drops re-issues
  `revoke … / grant execute … to authenticated` (see 0006 onwards).
- Changing a function's signature: drop the old one first; PostgREST
  overloads cause ambiguity errors.
- Knockout rows are seeded with null teams; they are **pinned at kick-off**
  by `set_clock('start', …, p_home, p_away)`. Client resolves provisional
  slots from the tables (`resolveSlots`), display-only until then.
- One-off tie shoot-outs are records in `tie_shootouts` and act as the fifth
  tie-break in `standings()`. They are group-stage only and decide table
  order, never a match result. Slot overrides are only for disqualifications.
- Match penalties (`matches.pens_*`) are a different thing entirely and are
  knockout-only — `set_shootout()` refuses a stage of `A` or `B`, so `m.pd`
  already implies a knockout tie and needs no second guard in the client.
- Suspensions: two yellows in separate matches (per phase: group/KO don't
  combine) or a red → miss the club's own next fixture.
- The click handler is one delegated listener; **every tappable element's
  data-attribute must be in the `closest()` selector list** or it is dead.
  All club/player links are real `<button>`s (mobile tap reliability, and a
  div with a click handler is unreachable by keyboard).
- Fixture rows always open the match; club/player links exist everywhere else.
- **Navigation keeps a history stack** (`state.hist`, capped at 20). Forward
  moves into club, player and leaderboard pages push the page they leave;
  back buttons (`data-back="view:x"` / `data-back="sqteam:id"`) pop it and
  fall back to their old fixed destination when the stack is empty. The
  bottom nav clears the stack — a tab always opens at its own root. Matches
  are deliberately outside the stack: `state.from` already returns them.
- The Fixtures tab opens on Sunday once `groupStageComplete()` is true, and
  back on Saturday when it is not. The condition is symmetric on purpose: a
  phone boots from its cached snapshot before the first poll, so after a
  `reset_tournament()` a one-way rule would strand it on the wrong day.
  Choosing a day pins it (`state.dayPinned`).
- Themes: token overrides in `themes.css` keyed on `[data-theme]`.
  **Matchday is the public theme.** The other four are kept as a working
  fallback and the switcher is only rendered when signed in (either role);
  spectators never see it. Default is matchday, a stored choice still wins.
  Club `colour` + `text_colour` come from the DB.
- Never put credentials in the repo or chat. The publishable key in `api.js`
  is safe by design. Pitch passwords: set in Supabase dashboard only.

## Awards, leaderboards and trophies

- Three awards, each with a full leaderboard view: golden boot (goals),
  player of the tournament (man-of-the-match awards), golden glove (goals
  conceded, **by club**).
- `rankRows()` in `model.js` is standard competition ranking — 1, 2, 2, 4,
  not dense 1, 2, 2, 3. `lowerIsBetter` flips it for the glove. `leaders()`
  is the single definition of "top of a board"; `decidedByManagers()` holds
  the tie rule the app cannot resolve on its own.
- Leading is not winning. `trophy_awards` + `set_trophy(p_trophy, p_players)`
  (organiser-only, atomic replace, audit-logged) record the real winners
  against **players** — including the golden glove, whose board is clubs but
  whose trophy goes to a goalkeeper no column can identify. The UI only
  offers confirmation once the final is at full time or forfeited.
- `snapshot()` carries `trophies` as `{ trophy: [player_id, …] }`.
  `confirmedTrophies()` tolerates its absence, so a phone on a cached
  pre-trophies snapshot degrades instead of throwing.
- Confirmed winners replace the computed leader on the award card and add an
  Honours line to each winner's player profile.
- `reset_tournament()` clears `trophy_awards` along with events, shoot-outs
  and overrides.

## Current state (mid-August 2026)

- Feature-complete and load-tested: 1,000 concurrent spectators, 0 failures,
  p95 58ms on free tier. CDN layer deliberately not built (not needed).
- **The tournament is reset** — all 15 matches `scheduled`, no events, no
  trophies. This is the rehearsal baseline.
- Dummy squads (14/club) and placeholder managers are **deliberately still in
  place** so rehearsals have something to attribute goals to. Clear with
  `update public.players set active=false where true;` before entering real
  lists (paste-in screen: Organiser → Squads).
- Kidane Mihret replaced Hove (internal id stays `hove`); real crest pending
  (placeholder KM monogram at `web/crests/hove.webp`); confirm spelling.
- Waiting on association: final draw, timetable, squads, 2026 rules
  (2025 rules implemented meanwhile).

## September checklist

1. First week: Supabase **Pro upgrade (mandatory — weekend egress ~90GB vs
   5GB free)**, spend cap decision, leaked-password toggle.
2. Draw day: fill and apply `DRAFT_apply_real_draw.sql`; paste real squads
   and managers; `reset_tournament()` from the app clears any test scores.
3. Before the weekend: venue dry run on real phones, Amani's organiser
   account (allowlisted, user not yet created), poster with QR.

## Verification habits

Pure logic lives in `model.js` precisely so it can be tested headlessly.

```bash
node tests/model_test.mjs
```

`tests/model_test.mjs` covers the ranking and trophy helpers and is plain ESM
with no imports beyond `model.js`, so it also runs in a browser when no node
is installed. `tests/write_path_test.sql` covers the five database guarantees
and runs against the live project.

Any change to rules, ordering or the clock should come with a test beside it;
any change to `app.js` should at minimum be **executed** (not just parsed)
against a DOM before shipping — a module-evaluation crash ships as an
infinite "Loading…" screen. Visual work should be checked at 375px as well as
desktop, in Matchday first and then quickly across the other four to confirm
nothing regressed.
