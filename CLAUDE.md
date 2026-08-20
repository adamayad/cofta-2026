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
  old devices keep stale copies forever. Currently `cofta-v38`.

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
  currently `0001` … `0022`. Apply to the live DB via the Supabase dashboard
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
  `tests/naming_drill.html` walks all thirteen editions and fails if anything
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
- `km.webp` is Kidane Mihret. The id was `hove` until 0020 renamed it: Hove
  withdrew pre-draw and Kidane Mihret took the slot, and the alias was kept
  for convenience until History arrived and made "hove" genuinely ambiguous
  with the real Hove club. Still the placeholder KM monogram — real artwork
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

Thirteen finished tournaments, 2022–2026, imported by `0021` from
`tournament_archive.json`. Five editions survive in full; eight are barely
more than a date and a champion. **Thin records stay thin** — no synthesised
fixtures, no zero-filled stats, and `null` never rendered as `0`.

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
  caches hard in `localStorage` — safe because the archive is immutable.
  Bump `ARCHIVE_V` in `api.js` if the shape ever changes.
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

### Archive club colours are data, not a hash

`archive_teams.canonical_name` holds the **full church name only** and `city`
is its own column (0022). For the seven crosswalked clubs the name matches
`teams.name` exactly, enforced by an assertion in that migration. Two
different churches share a name — Golders Green and Birmingham are both
"St Mary & Archangel Michael" — so uniqueness is on `(canonical_name, city)`,
which is the whole reason the city is a column rather than part of the string.

Where a source never recorded a church name (Newcastle, the historical Hove,
the joint Liverpool & Bolton entry) the source string stands and the city is
null. Inventing one would break the archive's first rule.

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
`tests/naming_drill.html` walks all thirteen editions and fails if any
alias-only team spelling reaches the DOM, or if a B-team render loses its
marker. Read `__namingSummary`.

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
