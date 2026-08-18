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
  old devices keep stale copies forever. Currently `cofta-v28`.

## Workflow

- The repo is the source of truth and **git is the delivery path**: clone,
  branch or commit on `main`, push.
- **Do not upload assets through the GitHub web UI.** It has been done
  repeatedly and it costs every time: it creates `Add files via upload`
  commits that diverge from work in progress (rebase onto them, never force
  over them), and it lands cache-first assets **without bumping `VERSION`**,
  so the new file deploys and no device already holding the old VERSION will
  ever fetch it. Put files into `web/crests/` in the repo instead. If an
  upload has already happened: `git fetch`, check whether it touched a cached
  asset, and bump `VERSION` in the next commit.
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
- **`themes.css` contains dead declarations overridden further down.**
  `.sl .bdg` declares a white pill near the top; `.midchip` is declared
  twice. Only the last declaration ships. Both have been reported as
  regressions by reading the file rather than the computed style — check
  DevTools, or the guard comments, before concluding anything.
- Never put credentials in the repo or chat. The publishable key in `api.js`
  is safe by design. Pitch passwords: set in Supabase dashboard only.

## Themes

**Matchday is locked as the public theme.** Token overrides live in
`themes.css` keyed on `[data-theme]`; club `colour` and `text_colour` come
from the DB.

The other four (Programme, Broadcast, Terrace, Swiss) are kept deliberately
as a working fallback and stay selectable, but the Appearance switcher only
renders when someone is **signed in**, either role — spectators never see it.
Default is matchday; an explicitly stored choice still wins.

Only Matchday needs to be beautiful. The other four need to render sanely,
which is what the cross-theme sweep at the end of a visual change is for.

## Matchday match header: settled layout

Four invariants, and they hold together — changing one usually breaks
another. They are stated in full above the rules in `themes.css` under the
marker **`SETTLED LAYOUT INVARIANTS`**, with the numeric assertions and
tolerances that confirm them.

1. **The halves share rows via subgrid.** `.stack` owns four rows (crest,
   name+city, score, scorer lines); each `.sl` spans all four with
   `grid-template-rows:subgrid`, so a wrapped name on one side cannot push
   that side out of step with the other and the scores stay on one line.
   Behind `@supports`; without subgrid the flex column still applies and
   degrades to the previous behaviour.
2. **The chip is an absolute overlay, dead-centre.** Never a grid item, never
   in flow, positioned against `.stack`'s `position:relative`.
3. **Content is centred with symmetric `padding-inline`**, never asymmetric
   padding to dodge the chip — that moves each half's content box off the
   half's own centre. `.sl` must also declare
   `grid-template-columns:minmax(0,1fr)`: left implicit, the track sizes to
   the widest item and sits at the start, which put content 15.75px adrift on
   whichever half's name happened not to wrap.
4. **No scores before kick-off.** A scheduled match shows crest and club
   only; the score row collapses and symmetric vertical padding holds the
   card at the height it will have once the clock starts, so nothing jumps at
   kick-off.

Spacing inside a half is a **margin per cell, not a row-gap** — a gap is
charged even when the track beside it is empty, which made the pre-match card
grow 18px.

**Verify numerically, not by eye.** An earlier pass checked only vertical
alignment and card height and so missed a 15.76px horizontal offset for
several rounds. The assertions are in the comment; run them from a DOM
against `getBoundingClientRect()`, at 375px and desktop, in every state
(pre-match, live with scorer lines, FT, penalties strip).

## Crests and icons

- **Crest presentation is settled**: the crest alone on the club colour, one
  soft drop shadow, **no plates, no rings, no contours**, on the split header
  and both phead club/player headers. Stated in `themes.css` under the marker
  **`CREST PRESENTATION IS SETTLED`**, which an instruction must name in
  order to change it. It has been reverted to this state more than once.
- **Separation problems are fixed in the asset, not in CSS.** Where a crest
  does not read against its own club colour, recut the artwork — `smpk.webp`
  carries its own ring and hairline edge for exactly this reason. A CSS
  filter has to be tuned per surface and gets reverted; one asset is correct
  everywhere it appears.
- Crests are **224×224** (10–18KB each). The header draws them at 62px CSS,
  so 224px is 3.6× — retina-true on a 3× phone, where the old 112px cuts were
  a 1.8× upscale and visibly soft. Fixtures tiles draw at 24px and are
  heavily oversampled; not worth maintaining a second size.
- `hove.webp` is Kidane Mihret's crest, not a Hove one: the club changed and
  the internal id did not. Still the placeholder KM monogram — real artwork
  pending, spelling to confirm.
- **PWA icons** (`icon-192`, `icon-512`, `icon-maskable`, `apple-touch-icon`)
  are in the Matchday language: the accent field `#38003c` carrying a white
  COFTA wordmark in Big Shoulders Display, nothing else — at 60px on a home
  screen there is room for one idea. Corner treatment differs by purpose:
  192/512 carry their own 22% rounding since "any" icons are shown as
  supplied; maskable is full-bleed square with the mark inside the 80% safe
  circle; apple-touch is full-bleed and fully opaque, because iOS applies its
  own squircle and fills any transparency it finds.

## Accessibility

Pragmatic, not ceremonial.

- Club blocks on a match header are real `<button>`s. A div with a click
  handler cannot be reached by keyboard and announces nothing.
- Icon-only controls carry `aria-label`: the ± in both shoot-out panels and
  the × on a trophy winner chip. Without it a screen reader offers several
  identical buttons.
- **Crests keep `alt=""`.** Every crest in this app sits directly beside the
  club's own name, so giving the image the name too makes a screen reader say
  it twice. These are not the elements carrying the meaning.
- Focus rings cover buttons, inputs, selects, textareas, links and anything
  with a tabindex. The split-colour header takes a white ring — the
  near-black purple accent disappears into a club's own colour.
- Matchday's `--dim` is `#65697b`, the smallest step that clears AA on
  **both** the white cards and the grey page background. The obvious lighter
  value passed on cards and failed at 4.24:1 on the page, which is where most
  of the small text actually sits.
- `prefers-reduced-motion` is respected globally.
- **No live region on the clock.** It changes every second; announcing that
  continuously is worse than announcing nothing.

## Stats hub, leaderboards and trophies

The fifth tab is **Stats** (the view id and `state.award` are still spelled
`awards`/`award` internally — renaming them is churn for no gain).

- **Eight boards**, four about players and four about clubs, each opening a
  full leaderboard and returning to Stats:

  | players | clubs |
  |---|---|
  | Goalscorers | Goals scored |
  | Man of the Match | Goals conceded (`lowerIsBetter`) |
  | Yellow cards | Clean sheets |
  | Red cards | Different goalscorers |

  `BOARDS` in `app.js` is the registry: label, whether rows are players or
  clubs (which decides whether a row links to a profile or a club page), and
  the empty state. `allBoards()` computes all eight once; the three trophy
  keys alias the board each is decided from, so a trophy and its stat can
  never drift apart.
- **Each card previews its board's top three rows** — crest, name, value —
  rather than summarising it in a sentence. `topRows()` in `model.js` takes
  rows, not places: four level at the top means the card shows three of them
  and the board tells the rest, so a card's height never depends on how
  level the tournament happens to be.
- Values on cards are **bare numerals**. The header already says what they
  count, so "1 clean sheet" under a card headed Clean sheets said it twice.
  Every row in **first place** gets the filled accent pill, not merely the
  first row: where two clubs are level at the top, calling one of them the
  leader because the tie-break sorted it first would invent a result.
- **Church names are the primary identity on Stats**, cards and full boards
  alike. A club's city is the small line beneath it; a player's club is the
  small line beneath them, matching what their profile already does.
- A stat card is a `div` carrying `data-award`, with a real `button` header
  carrying the same and real `button` rows for the players and clubs. A
  button inside a button is invalid HTML, so the card cannot be one: the
  delegated handler walks up from whatever was clicked, so a row wins over
  the card and the card wins over nothing. Pointer users get the whole card;
  keyboard users get the header.
- Definitions live in `model.js` as pure tested functions. A **clean sheet**
  needs a match played out to full time and not forfeited — a 3–0 awarded at
  a desk is a result, not a shut-out. **Different goalscorers** counts
  distinct players with an attributed goal, own goals excluded, since an own
  goal belongs to nobody as a scorer. **Card boards** count attributed cards
  only; a card logged without a name stays on the match report.
- Empty boards are normal and say so plainly. The card boards being empty all
  weekend is the good outcome, not a gap to apologise for.
  tells the reader less than the count does.
- **Trophy winners sit at the top of Stats** as an honours strip, once
  confirmed and not before: a leader is not a winner, and announcing one
  would be the loudest thing on a page whose job is the boards. One crest
  only when every winner shares a club.
- `rankRows()` in `model.js` is standard competition ranking — 1, 2, 2, 4,
  not dense 1, 2, 2, 3. `lowerIsBetter` flips it for conceded. `leaders()`
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

## Current state (18 August 2026)

- Feature-complete and load-tested: 1,000 concurrent spectators, 0 failures,
  p95 58ms on free tier. CDN layer deliberately not built (not needed).
- **Rehearsals are running against the live project**, so match state moves
  between sessions — goals, cards, shoot-outs and confirmed trophies appear
  and vanish. Do not treat any snapshot of it written here as current; query
  it. `reset_tournament()` from Organiser → Testing returns the baseline.
  What is durable: all 15 fixtures exist, both groups plus three knockouts,
  and the app opens on Sunday whenever `groupStageComplete()` is true.
- Dummy squads (116 active players across all 8 clubs) and placeholder
  managers (all 8 set) are **deliberately live** so rehearsals have something
  to attribute goals to. Clear with
  `update public.players set active=false where true;` before entering real
  lists (paste-in screen: Organiser → Squads).
- 3 admin accounts exist.
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
infinite "Loading…" screen.

Visual work is checked at **375px and desktop**, in Matchday first and then
across the other four to confirm nothing regressed. For anything touching the
match header, run the assertions under `SETTLED LAYOUT INVARIANTS` and print
the measured deltas. "Looks right" has been wrong in both directions here — a
real regression missed for several rounds, and regressions reported that
measurement showed did not exist.
