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
  table + trigger grants roles on user creation. The last confirmed role is
  cached in `localStorage` (`cofta.role.v1`) so an offline boot still renders
  the organiser's controls — see **Offline role trust** below.
- **PWA**: `sw.js` — network-first for code/HTML (deploys land on first
  reload), cache-first for fonts/crests/icons. **Bump `VERSION` in sw.js
  whenever any cached asset changes** (fonts, crests, PWA icons), otherwise
  old devices keep stale copies forever. Currently `cofta-v58`.

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
  currently `0001` … `0028`. Apply to the live DB via the Supabase dashboard
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
- **A club renders as its full church name with the city small underneath.**
  Everywhere — live pages and History alike, edition pages, standings,
  fixtures, leaderboards, awards, cabinets. Never a shortened form, never
  "Name, City" on one line. `clubBlock` and the standings row already did
  this live; `archTeamLink` does it for the archive. The one variant is
  `inline`, for the club shown *under* a player's name on a leaderboard,
  where a stacked block would out-shout the player.
- **Team names in History come from `archive_teams` and nothing else.**
  `archLabel` / `archTeamName` / `archTeamLink` are the only ways to put a
  club on screen. The same club is recorded as "Hounslow", "Pope Kyrillos,
  Hounslow", "SMPK" and "St Mary & Pope Kyrillos VI" across five editions; a
  reader must not have to work that out. `short_name` is **not** a display
  string — it survives only as the monogram's initials, because half these
  clubs are "St Mary & …" and canonical names would collide on "SM".
  `tests/naming_drill.html` walks every edition and fails if anything
  but a canonical name reaches a name line.
- **New views ship with their Matchday styling in the same commit, verified
  by computed-style assertions.** Not by geometry alone and not by eye —
  assert `getComputedStyle` values: that a grid resolves to the columns it
  should have, that an image renders at its intended size rather than
  inheriting a default, that stacked text is `display:block` rather than
  running together, that a drawn element is drawn rather than a text glyph.
  A view whose numbers line up can still be visually unfinished, and
  "positions measured correctly" has been mistaken for "it looks right"
  more than once here.
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
- **A standings row is only marked level once a shoot-out is actually owed.**
  `r.unresolved` is true from the first kick-off — after one match most of a
  group is level on everything, because almost nothing has happened yet — so
  the table used to tint four rows and pin a "LEVEL" badge on them before
  anything was at stake. The badge is gone and the `unres` highlight now
  follows `M.unresolvedPairs()`, which fires only when the group is complete
  and the tie decides qualification. Those are exactly the rows
  `unresolvedNotice` names for spectators and `tieShootoutPanels` offers to
  the organiser, so a highlighted row always has its explanation on the same
  screen. A 3rd/4th tie stays quiet: it sends nobody through, the rules
  separate nobody, and no shoot-out is offered.
- Match penalties (`matches.pens_*`) are a different thing entirely and are
  knockout-only — `set_shootout()` refuses a stage of `A` or `B`, so `m.pd`
  already implies a knockout tie and needs no second guard in the client.
- Suspensions: two yellows in separate matches (per phase: group/KO don't
  combine) or a red → miss the club's own next fixture.
- The nav is **six tabs** and scrolls horizontally below 768px rather than
  wrapping. **Organiser is not a tab** — it is a shield button in the
  masthead top-right (`.gear`, `aria-label="Organiser"`), muted while signed
  out and accent-tinted with a dot once signed in. It still carries
  `data-view="admin"`, so every existing route works unchanged.
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

**Matchday is locked as the public theme.**

The manifest's `theme_color` stays `#eef0f3` — Matchday's `--bg`, which
`app.js` also writes into the `theme-color` meta per theme, so browser chrome
matches the app rather than the icon. `background_color` is the PWA splash
behind the icon and is sampled from the artwork's cream (`#fbefed`): that is
the one surface where the icon's palette belongs.

Token overrides live in `themes.css` keyed on `[data-theme]`; club `colour`
and `text_colour` come from the DB.

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
- `km.webp` is Kidane Mihret. The id was `hove` until 0020 renamed it: Hove
  withdrew pre-draw and Kidane Mihret took the slot, and the alias was kept
  for convenience until History arrived and made "hove" genuinely ambiguous
  with the real Hove club. Still the placeholder KM monogram — real artwork
  pending, spelling to confirm.
- **PWA icons** (`icon-192`, `icon-512`, `icon-maskable`, `apple-touch-icon`)
  are cut from the association's own artwork, `cofta-icon-source.png` (1080px
  master, kept in `web/` but never referenced and deliberately **not**
  precached). Warm cream ground, maroon crest, church and ball inside a
  rectangular frame. All four are fully opaque — iOS fills any transparency
  it finds in an apple-touch icon.
  **The maskable is a separately padded cut, not a copy of the 512.** The
  standard icon runs its frame to the tile edge, which loses 12% of its ink
  to a circular mask; the maskable insets everything to a 13% margin and
  loses 0.12% — 51 pixels, the four corner tips of the frame. Never ship the
  standard file as the maskable one.

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

## Assists

`match_events.assist_player` (0019). An assist hangs off the goal it created
rather than living in a table of its own, because attribution is a second
pass and must never gate the score moving.

- **`edit_event` is a FULL REPLACE.** The client therefore sends the assist it
  is currently showing on *every* edit, or correcting a minute would silently
  clear the assist beside it. That failure is invisible from the UI, which is
  why `tests/assist_drill.html` asserts the payload of a minute-only edit.
- Assists exist on **goals only** — never an own goal, where there is nobody
  to credit, never a card. The editor shows no assist section for anything
  else, and the database refuses the rest.
- **Nobody assists their own goal.** The picker excludes the selected scorer,
  and changing the scorer to the current assister drops the assist rather
  than sending something the database will reject.
- **The scorer lines under the score stay goals-only.** The assist appears on
  the match report (`.asst`, muted, linking to the player) — that column is
  the scoreline's summary, and two names per goal would double its height for
  a secondary fact.
- `assistsBoard()` keys on the assist, not the scorer: `playerBoard()` takes a
  `keyOf` for exactly this. Assists is the second of five **player** boards on
  Stats, and the fifth stat tile on a player profile (`.stats.five`).

## History: the archive of previous tournaments

**Thirty-four finished tournaments, 2005–2026.** `0021` imported thirteen
from 2022–2026; `0026` backfilled twenty-one more reaching back to the first
COFTA in 2005. Five editions survive in full; the other twenty-nine are
sometimes no more than a year and a champion. **Thin records stay thin** — no
synthesised fixtures, no zero-filled stats, and `null` never rendered as `0`.

`tournament_archive.json` is the source of truth and is edited first; the
migration follows it. Adam's word is canonical, published sources fill in
around it and are cited on the row, and a published source that contradicts
him goes to the conflict register rather than into the data.

- **Two COFTA years have no tournament at all: 2013 and 2020.** There is no
  edition row for either. Their absence is recorded in
  `archive_meta.no_tournament_years`, because "we checked and it did not
  happen" is a different fact from "we have no record".
- **Two COFTA years have no champion: 2007 and 2008.** The tournaments were
  played; who won them is not recorded. The edition row exists with a null
  champion and the row renders **"Champion not recorded"** (`.nowin`) where
  the crest would go. An empty cell there read as a rendering fault and
  invited someone to fix it by guessing.
- **The competition page states origins only where they are known.** An
  edition carrying `notes.inaugural` makes its competition say so — COFTA
  2005, CONAFA 2014, Ark Cup 2026. COSTA carries `notes.origins_unrecorded`
  on every edition instead, because its founding year is genuinely unknown
  and the oldest row the archive holds (2022) must never be presented as the
  first. One competition owns its article: the sentence reads "The Ark Cup
  was first played in", not "The first The Ark Cup".
- **`is_published_summary` hides an award from every cabinet.** It marks a
  figure taken from a published summary table that the archive does not trust
  as the record, and both `fetchArchiveHonours` (`is_published_summary=eq.false`)
  and `trophyCabinet` drop those rows. It is a **distrust flag, not a
  citation** — cite the source in `source`/`notes` instead. `0026` set it on
  the COFTA 2014 awards because they came from the published report, which
  read as a citation; `0028` cleared it, because they are organiser-confirmed
  and therefore are the record. The genuinely flagged rows — the Ark Cup
  goalscorer table, the COSA WOTM totals, both of which contradict their own
  event data — keep it.
- **A thin edition can still have awards.** `viewHistEdition` used to return
  from the `minimal` branch before anything went looking, so COFTA 2015's top
  scorer sat in the database and on the club's cabinet but never on the
  edition's own page. Thin editions now render `thinAwards()`, sourced from
  the **honours read** rather than `loadEdition` — one query for the whole
  archive, already cached for the cabinets, where the per-edition read fires
  six and five come back empty for a record this thin.
- **Awards render `player_canonical`; `player_name` keeps the source string.**
  The column still holds the spelling its source printed, and match pages
  still render that. An award is a summary rather than a quotation, and a
  cabinet lists one club down the years — which is exactly where the 2014
  report's "Chilaki" sitting above the same man's "Chilaka" in 2026 reads as
  two players. `fetchArchiveHonours` must therefore **select
  `player_canonical`**; leaving it out fails silently back to the source
  spelling.
- **Notes are written for a reader, not for the compilation.** No note that
  reaches the screen names the organiser or the compiler — provenance lives
  in `source`, which is stored and deliberately never rendered. `0027`
  rewrote eighteen of them and asserts none come back. A note says what is
  missing or uncertain **about the tournament**, and stops. `notes.compiler_note`
  is the parking space for anything genuinely about the import; nothing
  renders it.
- A note printed beside the thing it qualifies is not repeated under **About
  this record**: `archNotes(e, { skip: [...] })`. A thin edition prints
  `teams_note` under its entrant list, where it explains that list, and skips
  it below.

**A sparse edition is not labelled as one.** Edition rows used to carry a
"THIN" pill; it is gone, and should not come back. It was internal vocabulary
on a public page, and it editorialised about a club's own tournament — the
1-1 and the shoot-out that decided COFTA 2023 are not a lesser record for
being all that survives. `data_confidence` still routes the edition to
`thinEdition()`, which shows what exists and stops. The page simply ends
sooner, which is the honest signal.

Two more of the same kind went with it, and the pattern is worth naming: **the
archive does not narrate its own coverage to the reader.** The History index
led with a paragraph explaining that records vary and nothing was filled in
where the source was silent — a caveat before a single tournament was shown,
answering a question nobody had asked. And every edition page ended with
`Source: Coptic_Football_Tournament_Archive_2024-2026.pdf, Section 1`, which
names the import's own working file and reads like a citation on a scoreboard.
`e.source` is still on the row, so provenance is recorded and "where did this
figure come from" stays answerable; it is simply not rendered. The
`known_gaps` and per-edition notes under **About this record** do stay — those
are about the tournament, not about the compiler.

- **Eleven `archive_*` tables**, relational rather than a blob. `0021`
  supersedes the `past_tournaments` jsonb table and `set_past_tournament()`
  from `0019`, which could not answer the questions History actually asks
  (this club across editions, this player under a canonical name). Both were
  dropped, after proving the table empty.
- **The archive must never ride in `snapshot()`.** Every phone polls that
  every five seconds and the weekend egress budget is sized without 99
  matches and 260 events in it. `0021` removed the `history` key that `0019`
  had added. History reads the tables directly under public-read RLS
  (`api.fetchArchiveIndex` / `fetchArchiveEdition`), only when opened, and
  caches hard in `localStorage`, with no expiry.
- **Bump `ARCHIVE_V` in `api.js` in any migration that touches an
  `archive_*` table.** The original rule said "if the shape ever changes",
  and that was wrong. Finished results are immutable; their presentation is
  not — `0022` split names from cities, `0023` added women's crests, `0024`
  corrected three church names, `0025` wired twelve crest files. Nothing else
  invalidates that cache, so a phone that opened History before a migration
  keeps the old copy for ever. This is not hypothetical: the archive crests
  shipped with the files deployed and the database correct, and devices went
  on drawing monograms. Local testing missed it precisely because the test
  drills clear `localStorage` on every run. Bumping prunes the previous
  version's keys on the next read.
- **A FAILED ARCHIVE READ IS NEVER RETRIED BY `render()`.** This was a hang,
  and the shape is easy to recreate, so it is worth stating as a rule: every
  History view calls `loadArchive()` at the top of its render, and
  `loadArchive()` calls `render()` when it settles. The guard used to be
  `state.archive || state.archiveBusy`, both false after a failure — so a
  failure was a hot loop: render, fetch, reject, render, fetch, bounded only
  by how fast the request failed. Offline a fetch rejects immediately, so it
  was bounded by nothing: it pinned the renderer and hammered the radio, on
  exactly the dead signal that caused it. Measured, it wedged the browser so
  completely that evaluating `1 + 1` in the page timed out.
  `state.archiveErr` (and `state.archiveEdErr[id]`, per edition) now latch the
  failure, and only a **Try again** tap clears it. Anything else that fetches
  from a render path needs the same latch. Verified offline: one attempt, no
  growth while sitting on the error or navigating away and back, one more per
  tap, and full recovery when the network returns.
  **All three loaders have it: `loadArchive`, `loadEdition`, `loadHonours`.**
  `loadHonours` had the same bug and a worse symptom — `cabinetBody` tested
  only `!state.archive` before showing the error, so when the index loaded and
  only the honours read failed, it skipped the error branch and sat on
  "Loading this club's record…" for ever while spinning the fetch. The guard
  there is now `(state.archiveErr && !state.archive) || state.honoursErr`.
  Anything added later that fetches from a render path needs the same latch
  and its own error branch; a loader that renders on failure without one is
  this bug again.
### The masthead belongs to the page

Opening the 2015 tournament and still reading "COFTA 2026" across the top puts
the reader in the wrong year. On the two views that **are** a tournament — a
competition and an edition — the masthead takes that name, and COFTA 2026
becomes the small line beneath it and the way back (`.tolive`, `data-live`).
A club's cabinet and the History index leave it alone: neither is a
tournament.

- **`data-live` leaves the archive; the back button walks it.** One clears the
  history stack and returns to Fixtures, the other steps back one page. They
  are not the same control and both are needed.
- **Neither view prints its own `<h2>` any more** (`.chead.bare`) — the
  masthead has the name, and repeating it two lines below is the same words
  twice.
- **`render()` must not assume any part of the chrome exists.** Every drill
  ships its own cut-down header, so `hd-title` and `hd-when` are read through
  `if` guards exactly as `nav-admin` is read through `?.`. Without them
  render() threw on a null element on every drill page — and a throw in
  render() is not a caught error, it is an infinite "Loading…".
- **Drills wait on `.chead[data-ed="…"]`, never on heading text.** The gender
  drill used to poll the `<h2>` for a change; when that heading moved to the
  masthead the selector matched nothing, the wait timed out, and the drill
  failed for a reason unrelated to anything it tests. An explicit hook cannot
  drift like that.

### Each competition is its own association, in its own diocese

The masthead's crest block names the body that runs the competition being
viewed, under whom, and shows that diocese's crest. All organiser-confirmed:

| | association | diocese |
|---|---|---|
| COFTA | Coptic Orthodox Football Tournament Association | London |
| CONAFA | Coptic Orthodox National **Annual** Football Association | **Midlands** |
| COSTA | Coptic Orthodox **Soccer** Tournament Association | London |
| COSA | Coptic Orthodox Soccer Association | London |
| The Ark Cup | *not an acronym* | London |
| Ladies COFTA | *not stated* | London |

- **Printing COFTA's name over a COSTA page was simply wrong**, and it did
  until `COMPS[].full` existed. Each competition names itself.
- **Where the association is not known the line falls back to the diocese**,
  never to another competition's name — the Ark Cup and Ladies COFTA read
  "Coptic Orthodox Diocese of London". A gap is a gap; borrowing would be an
  invention.
- **Every competition states its diocese explicitly; there is no default.** A
  host church happening to be in London is not the same statement as the
  competition running under that diocese, and only one of those is a thing
  anyone has confirmed.
- **A crest file that has not landed hides itself** (`onerror` →
  `visibility:hidden`) rather than rendering broken, and never falls back to
  another diocese's crest — the wrong one is worse than none.
- `web/diocese-midlands.webp`, 192×192 with transparency, to match
  `diocese.webp`. Both are cache-first, so adding it needs a `VERSION` bump.

### Who runs each competition

`COMPS[].host` carries the church that runs it, organiser-confirmed: COFTA and
Ladies COFTA to Stevenage, CONAFA to Nottingham, COSTA to Croydon, COSA to
SMPK, the Ark Cup to Golders Green. It is stored as the registry's
`short_name` and resolved at render time, so the host reads as its full church
name and opens that club's record rather than being a second place a club's
name is spelt by hand. Also in `archive_meta.competition_hosts`.

This is **competition-level**. An edition whose host differed carries its own
`notes.host_club`, as CONAFA 2015 and 2016 do.

### Identity guards, and the ones that nearly collided

- **THREE clubs carry St George, and two of them share a church name
  exactly.** St George, Stevenage; St Mary & St George, **Nottingham**; and
  St Mary & St George, **East London** (CONAFA 2016 debutants, added by
  `0026`). Nottingham and East London differ by *city alone*. Any dedupe pass
  that matches on `canonical_name` would merge two real clubs and destroy
  both records, so `0026` ends with an assertion that all three survive as
  separate rows, and `merge_guards` G1 in the JSON says so in the data.
  G2 restates the older SMPK / Worthing guard beside it.
- **"Brighton B" is not Brighton's second team.** The COSTA 2022 timetable
  prints "Brighton A" and "Brighton B"; per Adam the B side is in fact
  **Worthing**. That identification is scoped to `costa-2022` alone, in
  `notes.source_labels`, and deliberately is NOT a global alias — a genuine
  Brighton B may yet appear. `0026` asserts no team anywhere carries
  `Brighton B` in `aliases`.
- **Rotherham is spelt St Anthony here.** Adam's 2005–2021 roll writes
  "St Antony". Same club, one row; the roll's spelling is an alias.
- **Chilaka, not Chilaki.** Adam's spelling is canonical and lives in
  `player_canonical`; the 2014 report's spelling stays in `player_name`,
  which exists precisely to hold the string as its source printed it.

- **Read-only by construction.** No insert/update/delete policy and no RPC:
  the archive changes by migration or not at all.
- **Six competitions, not one renamed series.** COFTA, CONAFA, COSTA and The
  Ark Cup are men's; COSA and Ladies COFTA are women's. Confirmed by Adam,
  and worth stating because COSA / COSTA / Ladies COFTA read like the same
  event misspelt. Each has a scoped `[data-comp]` identity in `styles.css`.
- **Two colour tokens per identity.** `--ci` is the identity on a light card;
  `--cl` is the same identity as ink on a dark one. Broadcast switches to
  `--cl`, because measured against its card the deep values land at 1.9:1 —
  not a colour choice, invisible. All 6 × 5 combinations were measured; the
  worst is 6.67:1.
- **Crests: crosswalk, inherit, or monogram — never invented branding.**
  Clubs that still compete carry `live_team_id` (SMPK↔`smpk`,
  Stevenage↔`ste`, Croydon↔`cro`, Brighton↔`bri`, Golders Green↔`gg`,
  Rotherham↔`rot`, St Mark↔`stm`) and render the live crest and colours, so a
  future crest upgrade flows into the archive for free. **B teams** (PKSM,
  Golders Green B, St Mark B) inherit the parent's identity through the same
  crosswalk and add a small "B" — the parent's crest, never a fake one.
  Everyone else gets a deterministic monogram: initials on a tile whose
  colour is hashed from the canonical name out of one muted, obviously
  archival palette (`.mono-0` … `.mono-7`). Pure CSS and text, no image
  files. **Kidane Mihret is deliberately not mapped to anything historical.**
- **Future branding is data, not code.** When a real crest or colours arrive
  for a historical club, they land in that team's `display` jsonb (crest file
  under `web/crests/archive/`) with no schema and no UI change.

### Champions, and who holds it now

A competition page leads with every club that has ever won it — titles first,
then most recent — above the edition list, so the shape of a competition is
legible before you open a single year. `M.champions()` and
`M.reigningChampion()` are pure and tested.

- **"Reigning champion", not "last winners".** The competition cards said the
  latter, which is true of a defunct competition and wrong about a live one.
  The year is always shown beside the name, because for a tournament that
  skipped a year "reigning" alone would overstate how recent it is.
- **The holder is derived, never assumed to be first.** `reigningChampion()`
  takes the maximum year among editions that actually record a champion, so
  an edition added out of order, or one thin enough to have no champion,
  cannot become the holder. Editions are not stored sorted.
- **The year they currently hold is marked in their row** (`.cyr.now`) rather
  than repeated as a separate line — one club, one row, one badge.
- **The champion's crest is on the card, and the name is still not a link.**
  A competition card is itself a `<button>`, so the club stays plain text —
  but a crest is an `<img>` and nests perfectly well, so the badge goes in.
  `.cclw` exists only because `.ccl b` is a block: the crest and the name
  need their own flex row to share a line. Category is passed to `archCrest`
  explicitly here rather than left to `viewCategory()`, because one loop
  builds both the men's and the women's cards.
- **Thin records degrade quietly.** An edition with no recorded champion is
  simply absent from the roll, and the page says how many are unaccounted
  for instead of implying nobody won.

### Archive tables and goal lines

- **An archive table's club column is `tm`, not `nm`.** The base table sets
  `table-layout:fixed` with `th{width:26px}` and escapes it only for `th.nm`,
  so the archive's club column silently took the numeric width and every club
  rendered as one clipped letter. `.tbl.arch` uses `table-layout:auto`, which
  also matters because it carries eight numeric columns to the live table's
  six. Do not add a column to it without re-checking a 7-row group at 375px.
- **Goal lines never name a club.** A match has exactly two clubs, both on the
  row above with their crests, so the club under every goal was pure
  repetition — and, as a full church name over a city, it wrapped to two
  lines. Scorers now sit in two columns, home left and away right, with each
  player's minutes collapsed onto one line. `M.archScorerLines()` is the pure
  split and is tested.
- **Own goals are placed by the scoreline, never by `team_id`.** The archive
  does not mean the same thing by that column twice: in `CONAFA26-A-R3-03` it
  is the side the goal counted for (six normal goals plus one own goal makes
  the published 7-0), and in `ARK26-L07` it is the side that conceded it (0-3,
  where the away side's one normal goal plus two own goals makes three).
  Reading it directly would credit a club two goals in a match it lost to nil.
  Whichever side's normal goals fall short of its published score by exactly
  the number of own goals is the side they counted for; anything less certain
  than that, and any goal with no club at all, goes to `unplaced` and renders
  under both columns rather than inside one. Verified across all 75 matches
  with a complete event record: every column sums to its published scoreline.

### The trophy cabinet

Every club History names is a real `<button>` through to its whole archive
record: finals won and lost newest first, the individual honours its players
took grouped by edition, and an "Also competed" line so a cabinet is quiet
about a barren year rather than silent about the club's history.
`M.trophyCabinet()` is the pure aggregation and is tested.

**Where it opens depends on whether the club still competes.**

- The **seven crosswalked clubs** already have a page — Squads → the club — so
  the cabinet is a **second tab there**, not a second page about the same
  club. `.ctabs`, Squad first, and the choice **never persists**: every route
  into a club page resets `state.clubTab` to `squad`.
- **Everyone else** gets the standalone `archteam` page, because there is no
  live page to tab within.
- **B teams take the standalone route too**, even though they carry a
  `live_team_id`. That id exists so they can borrow the parent's crest; it
  does not make them the parent. `archiveTeamForLive()` therefore matches on
  `live_team_id` **and** `parent_club is null`, or PKSM's record would appear
  under SMPK's name — and the two have played each other.
- **Kidane Mihret has no History tab at all.** Nothing in the archive
  crosswalks to them, and an empty tab would imply a record that does not
  exist.

Two details that bit:

- **The B marker must appear exactly once.** Several canonical names already
  end in a B ("St Mark B", "PKSM (SMPK B)"), and a crest carries its own
  badge — so `archTeamName` suppresses the tag when the name already says it,
  and `archTeamLink` suppresses it again when it is drawing a crest. Without
  both, a B team reads "St Mary's B B".
- **A trophy that was awarded is not a board somebody topped.** Honours from
  `archive_awards` are marked `award`; a club merely leading a published
  board is marked `led` and says so. Leading is not winning, in the archive
  as anywhere else.

### Ink on the accent is `--accfg`, never `#fff`

Broadcast's `--acc` is a light orange: white on it measures 2.85:1. Every
theme already defines `--accfg` for exactly this, and it clears AA in all
five (worst 5.28:1). Any new filled-accent surface uses it.

### One church, two sides

SMPK, St Mark and Golders Green field a men's and a women's team under one
name. They are **one `archive_teams` row** — one church — so the difference
lives in fields on that row, not in a second row.

- **B teams inherit the parent's crest, including the women's one.** St Mark
  B on a Ladies COFTA page was falling through to the live men's crest — the
  one badge it must not wear. `archCrest` resolves the parent through
  `archiveTeamForLive` and reads its `crest_women` before giving up.
- **Crest by category.** `display.crest_women` is used only on an edition
  whose `category` is women, falling back to `display.crest`, then the live
  crest, then the monogram. `viewCategory()` derives the category from the
  view rather than threading it through every call site, and there is exactly
  one answer per view. A supplied crest carries an `onerror` back to the live
  crest, so a file that has not landed yet degrades instead of breaking.
- **The cabinet was pooling them, and that was a bug.** `trophyCabinet()` was
  called with every edition, so SMPK's record showed the Ark Cup and COSA in
  a single trophy count — a record neither side would recognise. Root cause:
  the join was on the club alone, with no category filter. `trophyCabinet()`
  now takes a `category` and scopes editions, awards, boards and entrants to
  it; `cabinetBody` passes one.
  **This was the only cross-edition roll-up missing the filter.** Everything
  else in History is scoped by `edition_id`, or by competition — and a
  competition is single-category by definition.
- **A cabinet opens on the side you came from.** From a Ladies COFTA page you
  see the women's record; from the live club page you see the men's, because
  the live tournament is men's. A **Men/Women toggle** inside allows a
  deliberate switch, and renders only where the church actually fielded both.
- **Dependency:** the live app has no women's squads — `public.teams` has no
  gender column — so the live club page's History tab can only be entered
  from a men's context today. When women's live teams exist, that entry point
  should set `state.cabCat` from the squad's own category instead of `'men'`.

### Uploading an archive crest

Same manual pattern as the live crests, and the same warning: **drop files in
the local clone, never through the GitHub web UI.**

Directory: **`web/crests/archive/`**, `.webp`, 224×224.

| case | filename |
|---|---|
| crosswalked club | `<live_team_id>.webp` — `smpk.webp`, `stm.webp` |
| women's crest | `<live_team_id>-w.webp` — `smpk-w.webp` |
| club with no live row | slug of `canonical_name`: lowercase, `&` dropped, spaces to hyphens — `st-mary-st-george.webp` |

A file is inert until the club's `display` points at it:

```sql
update public.archive_teams
   set display = coalesce(display, '{}'::jsonb)
               || jsonb_build_object('crest', './crests/archive/st-mary-st-george.webp')
 where canonical_name = 'St Mary & St George' and city = 'Nottingham';
```

Use `crest_women` for a women's crest. A crest replaces that club's monogram
tile; the monogram keys stay on the row and are simply no longer read. Bump
`VERSION` in `sw.js` in the same push — crests are cache-first, so without it
no installed device ever fetches them. `web/crests/archive/README.md` carries
the same table, and `DRAFT_wire_womens_crests.sql` is the ready statement for
the three women's crests.

### Archive club colours are data, not a hash

`archive_teams.canonical_name` holds the **full church name only** and `city`
is its own column (0022). For the seven crosswalked clubs the name matches
`teams.name` exactly, enforced by an assertion in that migration. Two
different churches share a name — Golders Green and Birmingham are both
"St Mary & Archangel Michael" — so uniqueness is on `(canonical_name, city)`,
which is the whole reason the city is a column rather than part of the string.

Newcastle, Hove and Liverpool were named by Adam in 0024 — St George &
St Athanasius, Archangel Michael and St Mary & St Cyril. Until then they
carried bare place names with a null city, because inventing a church name
would have broken the archive's first rule; a person who knows is not
inference.

**Liverpool & Bolton is the one row with no single church name.** It is a
joint side of two churches, so renaming it to either would be wrong and
stacking both on the primary line runs to 45 characters and truncates on a
fixture row. The team keeps its own name and `display.joint` records the two
churches, which `archSubtitle()` renders on its cabinet.

**Eight clubs off the circuit have confirmed colours**, stored in their
`display` jsonb rather than computed:

| club | colour | ink |
|---|---|---|
| St Mary & St Abanoub, Leeds | `#4B2E83` purple | white |
| Newcastle | `#16305C` dark blue | white |
| St Mary & St George, Nottingham | `#A31621` deep red | white |
| St Mary & St Mina, Manchester | `#D6402A` red + `#FFD9D2` ring | white |
| St Mina, Ireland | `#1B7A4B` green | white |
| Hove *(historical club)* | `#6B7280` grey | white |
| St Paul, London | `#E8A0C0` pink | `#3A1F2B` |
| St Mary & Archangel Michael, Birmingham | `#1F6FB2` blue | white |

Worst ink-on-tile contrast is 4.54:1. **Nottingham and Manchester are both
red**, so they take clearly different reds and Manchester carries a ring the
other does not — a second, non-colour cue, which also serves anyone who
cannot tell the two reds apart. The ring is data like the colour.

**A future club gets an explicit entry here, not a hash.** The deterministic
palette (`.mono-0` … `.mono-7`, keyed on the row id so a name correction
cannot reshuffle it) is only for clubs nobody has assigned yet, and stays
muted precisely so an unassigned club never looks like it has real branding.
Every monogram carries a hairline, because the pink and the muted fallbacks
are otherwise close enough to a white card to vanish against it.

The historical **Hove** here is the club that withdrew before the 2026 draw.
It is a distinct row from anything in the live `teams` table and is unrelated
to the `hove` → `km` rename in 0020.

### Identity rules that must not be relaxed

- **SMPK (Hounslow) and Worthing are two different clubs**, and both carry
  "Pope Kyrillos VI" in their name. Worthing appears in six editions under
  five alias spellings. No fuzzy match may ever collapse them; the import
  guards it explicitly and the verification suite proves two separate rows.
- Team strings resolve by **exact match against `aliases`**, never fuzzily.
- `player_name` is the string exactly as published; `player_canonical` is the
  merged identity, and every aggregate groups on the canonical. Twelve merges
  plus two of Adam's rulings; two pairs deliberately held back.

### Adam's rulings, recorded

- **Q5** — the extra Ark Cup goalscorer entries were shoot-out conversions.
  The event-derived figures are **canonical** (`is_canonical`), the published
  leaderboard is inflated, and both are stored. Shoot-out conversions are
  never goals anywhere.
- **Q10** — separate `archive_*` tables. The only link to the live tournament
  is `archive_teams.live_team_id`.
- **Q11 (partial)** — Kiro Khir and Kyrelos Khir are the same St Mark player
  (canonical *Kyrelos Khir*); Fady Khir stays separate; the Rizkalla /
  Rizkallah pair stays held back as two players.
- **"Myven" is Myven Gaied.** The published string is preserved as
  `player_name`; the canonical carries the surname.

### One contradiction in the source, resolved by reading

`team_registry.player_name_variants` marks eight pairs `flag_do_not_merge`,
and `player_registry.merges` then merges seven of them — the only pair left
unmerged being exactly the one in `held_back`. That is coherent only if
`flag_do_not_merge` means "never merge these **automatically**", with Q9
recording each manual decision. The import follows that reading;
`player_registry` is the merge authority. Recorded in `ARCHIVE_CONFLICTS.md`,
which is the readable copy of the `archive_conflicts` table.

**Conflicts are never silently resolved.** Both sides are stored, the row
carries a `flag`, and flags render **for organisers only**.

## Offline role trust

Found in a venue drill: an organiser's phone restarting on a dead signal came
up as a spectator. The boot-time role check is a network call, and a failed
network call is indistinguishable from "not an admin" — so failing closed,
which looked like the safe choice, locked an organiser out of their controls
during exactly the outage the offline queue exists for.

So the answer is remembered:

- `api.checkRole()` is the **only** door to `is_admin` / `my_role`. It writes
  what the server said to `cofta.role.v1`. The individual wrappers were
  deleted on purpose, so no future caller can check the role without
  refreshing the cache.
- `boot()` asks the server first. Only if that throws does it adopt the
  cached role, leaving `state.roleVerified = false`.
- `reverifyRole()` settles it: after the first poll that succeeds, and again
  on any `online` event (with `force`, since that transition is where a
  revocation lands). Agreement refreshes the cache; disagreement downgrades
  the UI immediately.
- `signOut()` removes the cache with the session, or the next person to open
  that phone inherits the last organiser's buttons.

**The trust is cosmetic.** It decides which buttons render, nothing else.
Every write still goes through an RPC that checks the role in the database,
so a revoked admin can tap whatever they like and the queue fails those
events on drain — which is the correct outcome, not a leak.

## What this runs on

Hundreds of strangers' phones, once, with no chance to tell them to update
anything. Audited against that rather than against the machine it was built on.

- **JavaScript floor: Safari 14 / Chrome 85 (2020).** The tightest feature in
  the codebase is `??=`; there is no `.at()`, `structuredClone`,
  `Object.hasOwn`, private field or top-level await. `crypto.randomUUID` is the
  one modern API used and it already falls back. Keep it there: a parse error
  in `app.js` is not a broken feature, it is an infinite "Loading…" on that
  phone with no way back.
- **Matchday must never depend on `oklch()`.** The `:root` palette is oklch
  throughout, but `[data-theme="matchday"]` — what the public actually sees —
  redefines **every** colour token in hex, so the default theme renders on a
  browser too old for oklch. That is not a coincidence to rely on silently:
  any new token, or any component rule using a colour function directly, needs
  a Matchday override in hex. A custom property holding an unparseable colour
  fails *at computed-value time*, so `background:var(--bg)` becomes
  transparent rather than falling back — which is how a page ends up as black
  text on black.
- `color-mix()` survives only in `:active` tints and one club-block
  background, where losing it costs a press highlight and nothing else.
  `subgrid` is already behind `@supports`. `:has()` and `dvh` degrade to
  ordinary spacing and height.
- **320px is a real width** (iPhone SE), and the archive standings table has
  ten columns. It scrolls inside `.tscroll`; without that it was clipped, not
  scrollable, and Pts — the column a reader opens a table for — was
  unreachable. Any table wider than about six columns needs the same wrapper.
- **Never let `localStorage` throw on a path a person is waiting on.** It
  throws in private browsing and on a full disk. `setSession` was unguarded
  and sat on the sign-in path, so an organiser tapping Sign in got a raw
  `QuotaExceededError`. The session now also lives in memory, so sign-in works
  regardless and only fails to survive a reload. Every other call site was
  already wrapped; keep it that way.
- **Timestamps must stay ISO with a `T`.** `snapshot()` emits
  `2026-08-20T13:30:34.580079+00:00` for `now` and `clock_anchor` because both
  are `timestamptz` rendered by `to_jsonb`. Postgres's space-separated `::text`
  form does not parse in Safari, and `Date.parse` returning `NaN` there would
  poison the clock offset and turn every minute on every phone into `NaN`.

## Verification habits

Pure logic lives in `model.js` precisely so it can be tested headlessly.

```bash
node tests/model_test.mjs
```

`tests/model_test.mjs` covers the ranking and trophy helpers and is plain ESM
with no imports beyond `model.js`, so it also runs in a browser when no node
is installed. `tests/write_path_test.sql` covers the five database guarantees
and runs against the live project. `tests/boot_drill.html` covers what
model.js cannot — what `app.js` decides at boot when the network will not
answer — by stubbing `fetch` and asserting the rendered controls. Serve the
repo root and open it, plus `?mode=nosession`; read `__drillSummary`.
`tests/archive_flags.html` covers the other half of the archive's flag rule:
a spectator seeing zero flags is easy to measure, so that drill stubs only
the role check, leaves every other request going to the real database, and
asserts an organiser does see them. Read `__flagSummary`.
`tests/assist_drill.html` drives the goal editor as an organiser and captures
the edit_event payload instead of sending it, which is the only way to prove
the full-replace rule holds. Read `__assistSummary`.

Two rules that drill had to learn, and both apply to any drill that navigates:

- **Re-query rows by index; never hold a node across a re-render.** It cached
  `[data-match]` once and clicked back to Fixtures between tries, which
  re-renders the view and detaches every cached node — so from the second
  iteration it clicked nothing. It passed for weeks because the first fixture
  happened to hold a goal, and only failed when the rehearsal data moved its
  goals later. A loop that "searched twelve rows" had opened one.
- **A stub that swallows a write must also play the write back.** The app
  keeps polling the real snapshot every five seconds, and each poll overwrites
  the optimistic state — so an assist set in step one was gone before the
  assertions about editing it a second time ran, and the drill reported the
  exact failure it exists to catch. The `edit_event` stub now remembers each
  edit and replays it into every following snapshot, which is what the real
  RPC would have caused. Without that the drill was timing-dependent on a
  five-second poll and passed only by being fast enough.
`tests/naming_drill.html` walks every edition and fails if any
alias-only team spelling reaches the DOM, or if a B-team render loses its
marker. Read `__namingSummary`.

**Run each drill in a fresh tab.** They are not isolated from one another:
every drill stubs `window.fetch` and clears `localStorage`, and running six in
sequence in one tab produced four spurious failures in the boot drill that
vanished on a clean load. An hour went into chasing that as a regression
before `git stash` showed the same failures did *not* appear at HEAD and the
same code passed 8/8 in a new tab. If a drill fails, reload it alone before
believing it.

**KNOWN FLAKE: the boot drill's four recovery assertions.** They fail perhaps
half the time, in fronted and background tabs alike, and — checked by
stashing — **identically at HEAD**, so a failure there is not evidence about
whatever you are working on. Confirm at HEAD before spending an hour on it, as
has now happened twice.

What is established: on a failing run `cofta.session.v1` is already gone by
the time the `online` handler runs, so `reverifyRole` takes its
`!api.isSignedIn()` early return and never re-checks. What is ruled out:
`signOut()` (it would take `cofta.role.v1` with it, and that survives),
`refreshSession()` (only reachable from a 401 or a 45-minute timer, and the
captured call list on a failing run is one `is_admin` and some snapshots — no
auth request at all), and any app call to `clear()` (there is none). A
`Storage.prototype.removeItem` patch never fires on a failing run, and adding
one makes the drill pass, which is why this is still open.

Do NOT instrument it by assigning `localStorage.removeItem = fn`. Storage's
named-property setter stores that as a *key* rather than shadowing the method,
so the patch silently never runs — an hour went into a "nothing removed it"
reading that was purely an artefact of that.

**Computed-style assertions must disable transitions first.** `getComputedStyle`
returns the in-flight value during a transition, and transitions are frozen
while the browser pane is hidden — so a colour read mid-transition returns the
*start* value indefinitely and looks exactly like a rule that is not applying.
An hour went into `.gear.on` before that turned out to be the explanation.

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
