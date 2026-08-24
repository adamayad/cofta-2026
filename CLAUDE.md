# COFTA 2026 — live tournament scores app

Live scores, tables, squads, leaderboards and trophies for the Coptic
Orthodox Football Tournament Association weekend, **12–13 September 2026**.
**Seven church clubs and uneven groups this year**: Group A is four clubs
playing a single round-robin, Group B is three clubs playing each other twice.
Both groups play six matches; the top two of each go to the semi-finals, then
the final. St Mark, Kensington are not entered in 2026. Production: **https://cofta.co.uk** (www redirects to
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
- **PWA**: `sw.js`. **Every module and stylesheet is loaded under a versioned
  URL** — `./app.js?b=cofta-vNN` — and those are cache-first, because a
  versioned URL is immutable by construction. Only the navigation is
  network-first, since it is the document that names the current build.
  **Never bump `VERSION` by hand: run `tools/bump-build.sh`**, which moves all
  sixteen references together, and `tools/check-build.sh`, which fails if they
  ever disagree. Currently `cofta-v82`. See **A deploy did not reach phones for
  four hours** below — the versioning is the fix, and it is not optional.

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
  currently `0001` … `0046`. Apply to the live DB via the Supabase dashboard
  SQL editor or the MCP connector. Note the connector records its own
  timestamped version strings (`20260817081714`), so a file numbered `0018`
  never "claims" 0018 in `supabase_migrations.schema_migrations`.
- The Supabase connector in the claude.ai chat remains read-capable and can
  apply migrations. It is read-write by design — treat `execute_sql` against
  production with the same care as the dashboard.
- **There was never a `DRAFT_apply_real_draw.sql`.** This file promised one for
  weeks; it existed in no commit and in no deleted path in history. The real
  draw went in as `0042`, written fresh against the schema on the day. If a
  future task wants a template, write one — do not go hunting for that file
  under time pressure.

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
- **A DEPLOY DID NOT REACH PHONES FOR FOUR HOURS, AND THE SERVICE WORKER HAD
  NOTHING TO DO WITH IT.** Reported as "I had to remove the home-screen app and
  clear site data to see changes". Three plausible causes were ruled out by
  measurement before anything was changed, and the real one was none of them.
  - *Not Cloudflare.* Three timed pushes reached the URL in **16s, 21s and
    ~50s**. Deploy latency is never what you are waiting for.
  - *Not an undeployed worker.* The live `sw.js` was byte-identical to the repo.
  - *Not really the two-reload quirk*, though it reproduced perfectly: after
    one reload the page still ran old code while the new worker sat there
    `activated` with the **new `app.js` already in its own cache**.

  **The browser's HTTP cache sits IN FRONT of a service worker for subresource
  loads.** Resource timing for one ordinary reload of production said it
  outright:

  | file | transferSize | workerStart |
  |---|---|---|
  | `/` | 3421 | > 0 — through the worker |
  | `/app.js` | **0** | **0 — never reached it** |
  | `/model.js`, `/api.js`, `/styles.css`, … | **0** | **0** |

  Pages serves the modules `max-age=14400`, so for four hours the browser
  answered every one of them itself and `sw.js` never executed. No cache
  strategy could fix that, because no cache strategy was running. The
  `fresh`/`cache:'reload'` work below is correct and was simply bypassed. Two
  reloads sometimes cured it **by accident** — the worker's `cache:'reload'`
  fetches refresh the browser's HTTP entry as a side effect, so the load after
  that one saw new bytes. A PWA that is resumed rather than reloaded never gets
  that far, which is exactly the reported symptom.
- **THE FIX IS IN THE URL.** Every module and stylesheet carries
  `?b=cofta-vNN`. A deploy asks for a URL the browser has never seen, so its
  cache cannot answer and the response header we are not permitted to set stops
  mattering. Verified end to end on production: a page running v71, one reload
  after a v72 deploy, `window.__build === 'cofta-v72'` — and every module now
  reports `viaSW: true`, the exact inverse of the table above.
- **Versioned URLs are cache-first, and that is the point.** Their bytes cannot
  change without the URL changing, so serving them from cache is not a
  staleness risk; an old token is simply never requested again, because the
  freshly revalidated `index.html` only ever names the current one. It also
  keeps ~250KB per page load off the weekend's egress — network-first with
  `cache:'reload'` would re-download the lot every single load now that the
  worker actually sees these requests.
- **`tools/bump-build.sh` or nothing.** Sixteen references across three files
  must agree, and the failure when they do not is silent: a stale `model.js`
  under a fresh `app.js` is a working page computing yesterday's standings, and
  nothing errors. `tools/check-build.sh` fails on drift and is the thing to run
  before any push that touches `web/`.
- **A page already open when a deploy lands cannot be saved by any of this** —
  its JavaScript is parsed and running. `watchForUpdates()` in `app.js` shows a
  "New version available / Tap to refresh" bar on `updatefound` and
  `controllerchange`, and calls `registration.update()` on `visibilitychange`
  so a phone left open all afternoon still asks. **Deliberately not an
  auto-reload**: someone mid-goal-entry must not have the page pulled from
  under them, and the organiser's write queue lives in memory. Guarded on
  `hadController`, so a first-time visitor is never greeted with it.
- **`web/_headers` does nothing on this project.** Proven twice, once with a
  custom probe header that never appeared on `/app.js` across seven checks over
  two and a half minutes. The CRLF theory for why was checked and is **wrong** —
  the stored blob has zero CR bytes. Do not reach for it again; version the URL
  instead.
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

## Current state (24 August 2026)

- **THE REAL DRAW IS IN.** `0042` replaced the rehearsal fixture list with the
  confirmed timetable: seven clubs, twelve group matches on Saturday, three
  knockouts on Sunday. Group A (gg, ste, km, smpk) plays a single round-robin,
  three games each. **Group B (bri, cro, rot) plays a DOUBLE round-robin, four
  games each** — organiser-confirmed, not a transcription slip, and the reason
  the two groups have different games-played while both play six matches.
- **St Mark, Kensington are not entered in 2026.** `stm` keeps its row, crest,
  colours and its whole History record; `group_letter` is null and it has no
  fixtures. **They are not listed on the Squads tab at all** - a club that is not playing
  has no squad and no fixtures, and is no more relevant to a list headed
  "Clubs" than any club that never entered. Their page is still reachable from
  their History cabinet, and reads **"Not entered this year"**. Before `0042`
  it read "Eliminated - group stage", which is neither true nor kind.
- **The rehearsal data is gone**: no played matches, no events, no active
  players, no managers. `reset_tournament()` remains for clearing scores
  mid-weekend; it is not what cleared this.
- **SQUADS AND MANAGERS ARE NOT IN YET** — the association has not submitted
  them. Every club currently reads "No squad list loaded". This is the last
  substantial thing outstanding, and it is a paste-in job: Organiser → Squads.
  Nothing else waits on it; goals cannot be attributed to a player until it is
  done, so it must land before kick-off.
- **Supabase is on Pro** as of 24 August. Measured egress for the weekend is
  ~29.5GB gzipped (1,000 devices × 8h × a 5,504-byte poll), comfortably inside
  250GB. The older ~90GB estimate was uncompressed.
- Feature-complete and load-tested: 1,000 concurrent spectators, 0 failures,
  p95 58ms. CDN layer deliberately not built (not needed).
- 3 admin accounts exist.
- Waiting on association: squads, managers, 2026 rules (2025 rules implemented
  meanwhile).

## September checklist

1. ~~Supabase Pro upgrade~~ **done, 24 August.** Still to decide: the spend
   cap. With it ON, exceeding quota RESTRICTS the project rather than billing
   — which on the day means the site goes down instead of costing a few
   pounds. Turn it off for the weekend. Leaked-password toggle also pending.
2. ~~Draw day~~ **done, 24 August** (`0042`, `0043`). Remaining: paste real
   squads and managers.
3. Before the weekend: venue dry run on real phones, Amani's organiser
   account (allowlisted, user not yet created), poster with QR.

## Add to home screen

Two platforms, two completely different features, and pretending otherwise is
how this gets built badly. `installBar()` and friends in `app.js`.

- **Android/Chrome** fires `beforeinstallprompt`. We `preventDefault()` its own
  banner, keep the event, and spend it when the reader taps ours — one tap, one
  real OS install dialog. **The listener is attached at module evaluation, not
  in `boot()`**: the event fires early, and a listener attached late silently
  never sees it, which looks exactly like the feature not existing.
- **iOS Safari has no such API** and never will. Installing means a trip
  through the share sheet, so the only honest offer is an instruction. That is
  not the afterthought here — it is the majority path, and it is also the
  **only** way iOS push can ever work, because Apple requires a home-screen app.
- **The share icon is drawn as an SVG.** The unicode characters for it render
  as a tofu box on plenty of devices, and an instruction whose icon is a blank
  square is not an instruction.
- **Every other iOS browser is suppressed entirely.** Chrome, Firefox and Edge
  on iOS are WebKit in a different wrapper; Add to Home Screen either is absent
  or produces something that does not behave like the app. Telling someone to
  tap a control that is not there is worse than saying nothing.
- **Never shown to someone already installed**, and never within seven days of
  a dismissal (`cofta.install.dismissed`). Dismissal is always available and
  always respected.
- **Never on the first painted page.** It appears on the second, or as soon as
  a match is opened.
- **ENGAGEMENT IS COUNTED IN `render()`, NOT IN `navigate()`,** and that was a
  real bug caught in testing. The bottom nav does *not* route through
  `navigate()` — it sets `state.view` directly — so counting there missed the
  most ordinary way anyone moves around the app and the offer never appeared
  for them at all. Counting distinct pages actually painted (`lastPageKey`)
  catches tabs, back buttons, deep links and `navigate()` alike, and the
  five-second repaint does not inflate it because the key does not change.
- **One bar at a time.** `canOfferInstall()` returns false while the new-build
  bar is up: that one is a problem to fix, this one is an offer, and stacking
  two fixed bars over the same thumb is worse than either.
- `tests/install_drill.html` stubs the user agent **before `app.js` evaluates**
  — `IOS` and `IOS_SAFARI` are module-level constants, so a later stub is too
  late — and drives five cases: `?m=` unset (iOS Safari), `crios`, `standalone`,
  `dismissed`, `notify`. 15/15, 4/4, 4/4, 4/4, 14/14.

### And once they are in, the alerts offer

`notifyBar()` / `canOfferNotify()` / `dismissNotifyBar()`, same shape and the
same `.installbar` styling as above, shown on the page after a reader has
installed.

- **The moment after installing is the only good moment to ask**, and on iOS it
  is the FIRST moment the question can be asked at all: Apple will not deliver
  push to a Safari tab, so before the install there was nothing to offer.
  Waiting for someone to discover the bell in the masthead on their own wastes
  that. Android's `appinstalled` needs no special handling — the tab it fires in
  is not `display-mode: standalone`, so the offer appears when they open the
  installed app, which is the same story on both platforms.
- **It is our bar first, and the OS dialog only after a tap.** Raising
  `Notification.requestPermission()` unprompted is how people end up tapping
  "Don't allow", which the app cannot undo and cannot ask about again.
- **THE TAP IS THE PERMISSION GESTURE.** The `data-notifybar` branch in the
  click handler calls `enablePush` with nothing in front of it — iOS silently
  refuses a permission request whose gesture has been spent on an await.
- **`permission !== 'default'` suppresses it entirely.** `denied` can only be
  undone in Settings; nagging about something the app cannot fix is noise.
  A dismissal is remembered for the same seven days
  (`cofta.notify.dismissed`), and a refusal at the OS dialog counts as one.
- **Unlike `installBar()`, this one also takes itself DOWN.** An install ends
  with the page being replaced, so that bar never has to remove itself; this
  one is answered in place, and the state it is asking about changes while it
  is still on screen. `notifyBar()` removes the node when `canOfferNotify()`
  goes false.
- The two bars cannot stack: that one only shows when NOT installed, this one
  only when installed.
- `?m=notify` in the install drill covers it. `requestPermission` answers
  `denied` on purpose — that path exercises gesture, request and teardown while
  returning from `enablePush` **before** `subscribe_push`, so the drill can
  never write a junk subscription into the production table.

## Goal and full-time notifications

Opt-in Web Push. `0044` and `0045`, `supabase/functions/notify`, the `push`
handler in `sw.js`, and `enablePush`/`notifySection` in `app.js`.

- **The VAPID public key lives in `api.js` and is public by design**, exactly
  like the publishable key beside it. Its private half is only ever in the
  Edge Function's secret store — which is why the keypair was generated at
  Adam's end and the private half was never in chat or in this repo.
- **GATED ON BEING INSTALLED, on both platforms.** Apple does not deliver Web
  Push to a Safari tab, only to a home-screen app on iOS 16.4+. A toggle in a
  tab would raise a permission dialog granting something that then never
  arrives. Android would tolerate it; both get the same rule so there is one
  story to tell, and anyone tapping early is told why.
- **Per-club by default.** Twelve group matches in a Saturday is a lot of
  buzzing for someone who came for one club. Changing club is the same call as
  subscribing — `subscribe_push` is idempotent on the endpoint, so switching
  never needs off-then-on-again.
- **The Edge Function does not trust its caller.** The request carries only a
  match id and `goal`/`full_time`; every word of the notification is read back
  out of the database. It checks `is_admin()` with the caller's own token
  first: verified against production, the publishable key alone gets **403 not
  an organiser** and no auth is refused at the gateway.
- **It is called by the organiser's device, not by a database trigger.** A
  trigger needs a Database Webhook configured by hand, or a service-role key
  in a migration — and the second puts a credential in the repo.
  `notifyMatch()` is deliberately **not awaited and silent on failure**: the
  score moving is the job, the notification is a courtesy, and it must never
  delay the tap that logged the goal or put an error in front of someone on a
  touchline.
- **Dead endpoints are deleted, never retried.** 404 and 410 mean the
  subscription is gone for good; retrying one every goal all weekend is a slow
  leak that ends with sends timing out for everybody else.
- **Every branch of the `push` handler is defensive.** A throw while handling a
  push can have iOS drop the subscription outright, and the reader then
  silently stops getting notifications with nothing to see or fix. A malformed
  payload must degrade to a dull-but-correct notification.
- **NEVER `navigator.serviceWorker.ready` in this code path.** That promise
  does not resolve when no worker is registered — it waits for ever. It hung
  `readPushState()`, left `state.push` null, and told a perfectly capable
  browser it "cannot show match notifications"; `enablePush` had the same await
  and would have hung *after* granting permission, leaving someone with
  permission given and no subscription. `swRegistration()` uses
  `getRegistration()`, which settles immediately.
- **Two locks on the subscriber list, not one.** `0044` enabled RLS with no
  policies, which returned an empty array rather than an error — but the
  schema-wide blanket GRANTs were still there, so anon held SELECT, INSERT,
  UPDATE and DELETE and RLS was the only thing standing. `0045` revokes them:
  a direct GET went 200/`[]` → **401**, a direct POST → **401**, and both RPCs
  still return 204.
- **The scoring club is marked by its COLOUR, at its end of the scoreline.**
  `🟠 Anba Abraam 2–1 St Shenouda` for a home goal, `… St Shenouda 🔵` for an
  away one. **Position carries the meaning and colour is the flavour, in that
  order**: Kidane Mihret and Pope Kyrillos VI both play in white and meet in
  Group A, so their circles are identical - and the notification is still
  unambiguous, because the circle sits at the scoring END rather than merely
  appearing somewhere in the line.
- **Circles are matched on HUE, not RGB distance.** Nearest-colour arithmetic
  turns Golders Green's #14532D and Rotherham's #1E2E63 BLACK - both really are
  closest to the dark grey circle, while being obviously green and blue to
  anyone looking at the shirt. Hue matching keeps dark green green and navy
  blue, and the whole current mapping is:
  **🟢 Archangel Michael · ⚪ Kidane Mihret · ⚪ Pope Kyrillos VI ·
  🔴 St George · 🟡 Anba Abraam · 🔵 St Shenouda · 🔵 St Anthony.**
- **NAVY IS BLUE AND THE COLLISION IS TOLERATED.** Unicode has one blue circle,
  so Croydon's light blue and Rotherham's navy are both 🔵 — and those two meet
  twice this year. Navy was briefly ⚫ to separate them and that was worse:
  Rotherham do not play in black, so the notification was **lying about a club
  to solve a problem position already solves.** The circle sits at the *scoring
  end* of the scoreline, so two identical circles still read differently. Same
  reasoning as the two white kits, and the general rule: **position carries the
  meaning, colour is the flavour** — never distort the colour to prop up the
  position.
- **The orange/yellow boundary is hue 35, not 45, and that is deliberate.**
  Anba Abraam's #C9A96A is a gold that sits at hue 40 and must read yellow; a
  true orange (#F4900C, hue 33) still lands orange. Moving that boundary is how
  a club's circle silently changes, so check both ends before touching it.
- **A notification names the CHURCH, not the town.** `teams.short_label`
  (`0046`) is the one-line name a club goes by where the usual full-name-over-
  city is impossible. It used to fall back to the city, which reads badly for
  half of them: "Willesden" is not what anyone calls Kidane Mihret, and
  "Hounslow 2–1 Croydon" names two places rather than two churches. Six labels
  are organiser-supplied; **`ste` was not given one and is inferred as "St
  George"** to match the pattern the other six set — a one-line UPDATE if that
  is wrong. Display only: nothing resolves a team FROM this string, so unlike
  an archive alias it cannot collide with anything.
- **Seven alert kinds, chosen per device.** `push_subscriptions.kinds`, an
  array: `goal`, `card`, `motm`, `start`, `half_time`, `second_half`,
  `full_time`. **The default is goals and full time**, and everything else is
  opt-in, because twelve matches of cards and kick-offs on one Saturday is a
  phone nobody wants in their pocket. The Edge Function filters with `@>`, so a
  device that chose goals never hears about a yellow card — **except a test
  push, which ignores the filter on purpose**: someone pressing "send me a
  test" wants to know the pipe works, whatever they subscribed to.
- **`subscribe_push` drops unknown kinds rather than rejecting the call**, so a
  device on an older build can still subscribe and a newer one asking for a
  kind this database has not heard of is not turned away. Asking for nothing
  usable falls back to the default rather than storing a row that can never
  fire, and the client does the same — a subscription that can never fire is a
  worse state than no subscription and looks exactly like a bug.
- **ONE PUSH PER GOAL, SENT AFTER A SEVEN-SECOND WAIT.** The first design sent
  two - the score at once, then the scorer, the second carrying `renotify:
  false` to rewrite the first in silence. Chrome honours that; **iOS does
  not**. iOS insists every push shows something, so the silent update landed as
  a second banner and every goal buzzed twice, which teaches people to ignore
  the first. The client now waits instead: `scheduleGoalPush` starts a timer,
  picking the scorer flushes it immediately, and only a goal nobody attributes
  runs the full seven seconds. In practice it is usually faster than the
  timeout, because picking is what fires it.
- **And a goal voided inside that window is never announced at all.** Before,
  a mis-tap went out instantly and could not be recalled - the correction just
  left a false notification on a few hundred lock screens. `cancelGoalPush` on
  void and on the own-goal conversion means a mistake corrected within seconds
  costs nobody a buzz. The timers are in memory on purpose: if the organiser
  closes the app mid-window, not announcing is the right outcome.
- **The tag is per match AND per kind.** `match-<id>-goal` and
  `match-<id>-card` are separate, so a booking does not overwrite the goal
  notification a reader has not looked at yet, while a second goal still
  replaces the first rather than stacking six from one game.
- **Cards and man of the match carry the club, always.** They are logged with
  their player already, so unlike a goal there is no follow-up to fill in — one
  push, once. A bare name means nothing to someone who does not know which side
  he plays for, which is most people reading it.
- **The masthead icon is a bell, not a shield.** Same button, same
  `data-view="admin"`, same panel behind it — but the shield spoke to the wrong
  person. It said "admin" or "security" to a spectator, who had no idea there
  was anything back there for them, and notifications are now the only reason
  most readers will ever open it. `aria-label` is "Alerts and organiser" so a
  screen reader still says both.
- **What is verified, and what is not.** The RFC 8291 encryption round-trips
  byte-identical (encrypt, then decrypt with the device's private key —
  emoji and en-dash included), the auth gate refuses non-organisers, the RPCs
  accept good input and reject bad, and the key imports as a valid P-256 point.
  **The actual send is not verified**: it needs `VAPID_PRIVATE_KEY` set in
  Supabase and a real handset, neither of which exists here.

## Nothing in this app is time-bombed, and it must stay that way

Matches run late. Audited on 24 August, and the result is clean: **`kickoff` is
used for display and for sorting, and is never compared against the real
clock.** Every gate in the app is driven by state that an organiser sets:

| gate | keyed on |
|---|---|
| a match is live | `status`, set by `set_clock` |
| the match minute | `clock_anchor` + `clock_accum_ms` — when START was pressed |
| group is over | every match with that stage is `full_time` or forfeited |
| semi-final teams | `resolveSlots`, from the completed tables |
| trophies can be confirmed | `finalComplete` — the FINAL is `full_time` or forfeited |
| which day opens | `groupStageComplete`, not the date |

The only date literal anywhere is the masthead's "12–13 September" label. A
fixture that kicks off forty minutes late behaves identically to one on time;
the scheduled time simply keeps showing as the printed timetable says.

**Do not introduce a comparison against `Date.now()` to decide whether
something may happen.** If a future feature needs "has this started", the
answer is `hasStarted(m)`, never the clock.

## Non-match events on the timetable

`schedule_events` (`0043`) holds the things on the weekend timetable that are
not fixtures — Vespers on the Saturday, Liturgy on the Sunday, both at St
George Cathedral.

- **They are NOT matches, deliberately.** A match row for Vespers would carry
  two empty team slots, a 0-0, a kick-off time, a tappable match page, and
  would be counted by every assertion that says "twelve group matches".
- **They render in the fixtures list, merged by time**, so Liturgy at 09:30
  sits above Sunday's semi-finals and Vespers at 17:30 after Saturday's last
  game. `scheduleRow` is a `<div>`, not a button: no crest, no score, no clock,
  nothing to tap. The 44px time gutter matches `.fx` so the times line up.
- **They ride in `snapshot()`, and that is a considered exception** to the rule
  that keeps the archive out of it. The rule is about size: the archive is
  ~250KB polled every five seconds; this is two rows, ~1% of a 5,504-byte
  poll. A separate cached read would have cost another loader, another failure
  latch and another cache version for a saving of ~0.3GB on a 250GB plan.
- **Why the database rather than a constant in `app.js`:** the organiser can
  move Vespers with a one-line `UPDATE` from the dashboard and it reaches every
  phone on the next poll. They cannot deploy; that asymmetry is the whole
  argument.
- `state.schedule` degrades to `[]` on a snapshot cached by an older build.

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

**Thirty-five finished tournaments, 2005–2026.** `0021` imported thirteen from
2022–2026, `0026` backfilled twenty-one reaching back to the first COFTA in
2005, `0029` added COSTA 2023, and `0033`–`0041` reworked nine areas at once:
the CONAFA gap, the last two unknown COFTA champions, three registry clubs,
five entrant lists and full narrative records for COFTA 2009, 2010, 2012 and
2014. Five editions survive in full; the rest range from a year and a champion
to a group table with named scorers. **Thin records stay thin** — no
synthesised fixtures, no zero-filled stats, and `null` never rendered as `0`.

`tournament_archive.json` is the source of truth and is edited first; the
migration follows it. Adam's word is canonical, published sources fill in
around it and are cited on the row, and a published source that contradicts
him goes to the conflict register rather than into the data.

- **Two COFTA years have no tournament at all: 2013 and 2020**, and **CONAFA
  did not run for five years, 2018 to 2022.** There is no edition row for any
  of them. Their absence is recorded in `archive_meta.no_tournament_years`,
  because "we checked and it did not happen" is a different fact from "we have
  no record" — and neither may ever render as a record being sought.
- **THE COFTA CHAMPIONS ROLL IS COMPLETE, 2005–2026.** `0034` filled the last
  two: 2007 Golders Green, 2008 Stevenage. Both were their club's first COFTA
  championship in the archive. The `.nowin` "Champion not recorded" rendering
  is now unreachable and is deliberately kept — a future backfill can add an
  edition whose winner is unknown, and an empty cell there reads as a
  rendering fault and invites someone to fix it by guessing.
- **`0033` reversed `0032`, and it is the only organiser-vs-organiser
  contradiction in the archive.** On 21 August Adam said Brighton won CONAFA
  2018 and 2019; on 24 August he confirmed CONAFA did not run at all between
  2017 and 2023. The later, more specific statement wins — and the earlier one
  is fully explained, because **`cofta`-2018 and `cofta`-2019 both already
  record Brighton as champion.** "Brighton won 2018 and 2019" was true of the
  wrong competition. Brighton's CONAFA titles went from seven to five. C16
  holds the reasoning; do not re-litigate it without a new source.
- **The competition page states origins only where they are known.** An
  edition carrying `notes.inaugural` makes its competition say so — COFTA
  2005, CONAFA 2014, COSTA 2022, Ark Cup 2026. A competition whose founding
  year is genuinely unknown carries `notes.origins_unrecorded` on every
  edition instead, so the oldest row the archive happens to hold is never
  presented as the first. **No competition needs that guard today**: COSTA
  did until `0031`, when its 2022 start was confirmed and the guard was
  removed as obsolete. Keep the mechanism — the next backfill will want it.
  One competition owns its article: the sentence reads "The Ark Cup was first
  played in", not "The first The Ark Cup".
- **"No tournament held" and "no record" are different facts, and so is
  "believed not held".** `archive_meta.no_tournament_years` carries a
  `confidence`: COFTA 2013 and 2020 are `confirmed`, CONAFA 2020–2022 are
  `believed` — Adam's own hedge, preserved rather than rounded up. Nothing
  renders differently; the distinction exists so a later source settles it
  instead of being assumed to have already agreed.
- **In the archive, topping the board IS winning the trophy.** Organiser
  ruling, 2026-08-21, and it reverses what this file used to say. These
  competitions gave the golden boot to whoever finished top of the scoring;
  a year whose write-up records the board and not the ceremony has a gap in
  its paperwork, not proof that nobody was given anything. `trophyCabinet`
  still fills a missing trophy from a rank-one board and still records which
  is which in `source`, but the cabinet no longer marks it: the small "led"
  pill and its "leading is not winning" footnote are gone. A caveat a reader
  has to decode, attached to something the organiser considers plainly true,
  costs more than it protects. **This is archive-only.** The live tournament
  keeps the opposite rule — see `trophy_awards` and `set_trophy` above, where
  leading is emphatically not winning until an organiser confirms it, because
  there the ceremony has not happened yet and the app is what records it.
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

### Artwork is downscaled before it is served

**Check the dimensions of any supplied image before committing it.** The
competition badges arrived at ~3464×3464 — 12 megapixels each — to be drawn at
24–46px. Served as-is that is 3.8 MB across seven files, but the download is
the smaller half: decoding a 12-megapixel image costs roughly **48 MB of
memory per image** whatever size it is painted at, and the archive shows
several at once. On a cheap phone at a venue that is the difference between a
page that scrolls and one that stutters.

- **224px longest side** for badges and crests, 192px for the diocese crests —
  eight times the size they render at, so still crisp on retina, and matching
  the archive crests already in the repo. 3,833 KB became 139 KB.
- **Originals go in `source-art/`, never `web/`.** Everything under `web/` is
  published by Cloudflare Pages whether or not anything references it.
- There is no image tooling on this machine. The downscale runs in the browser
  (`OffscreenCanvas` → `convertToBlob`) and POSTs to `scratchpad/upload.ps1`,
  a temporary local sink, so megabytes of base64 never cross the transcript.
  See `source-art/README.md`.

### History lists competitions by how seasoned they are

Most editions first, so COFTA's nineteen do not sit level with a competition
played once. **Derived from the data, not from `COMPS` order** — that array was
only coincidentally right for the men's side and already wrong for the
women's, where Ladies COFTA's two editions sat below COSA's one.

Ties break on the older competition — the same idea measured another way —
then on name, so the order is never arbitrary. `.filter()` returns a new array,
so the `.sort()` does not reorder `COMPS` itself; verified by switching
categories repeatedly and confirming the order does not drift.

### Competition badges

`COMP_LOGO` in `app.js`, files in `web/comps/<comp id>.webp`. On the History
cards at 34px and the competition page at 46px.

- **Ladies COFTA has no file of its own** — it is COFTA's women's competition
  under the same association and the same badge, so it points at
  `cofta.webp` rather than a duplicate that could drift.
- **COSTA has no badge and none is invented**, the same rule the archive
  applies to a club with no crest. Its card keeps the original three-column
  grid rather than a badged four-column one with a hole in it, so the absence
  reads as deliberate rather than as a card that failed to load.

### Each competition is its own association, in its own diocese

The masthead's crest block names the body that runs the competition being
viewed, under whom, and shows that diocese's crest. All organiser-confirmed:

| | association | diocese |
|---|---|---|
| COFTA | Coptic Orthodox Football Tournament Association | London |
| CONAFA | Coptic Orthodox National **Annual** Football Association | **Midlands** |
| COSTA | Coptic Orthodox **Southern** Tournament Association | London |
| COSA | Coptic Orthodox Soccer Association | London |
| The Ark Cup | *not an acronym* | London |
| Ladies COFTA | Coptic Orthodox Football Tournament Association (COFTA's women's competition) | London |

- **Printing COFTA's name over a COSTA page was simply wrong**, and it did
  until `COMPS[].full` existed. Each competition names itself.
- **Where the association is not known the line falls back to the diocese**,
  never to another competition's name — the Ark Cup reads
  "Coptic Orthodox Diocese of London". A gap is a gap; borrowing would be an
  invention.
- **Every competition states its diocese explicitly; there is no default.** A
  host church happening to be in London is not the same statement as the
  competition running under that diocese, and only one of those is a thing
  anyone has confirmed.
- **A crest file that has not landed hides itself** (`onerror` →
  `visibility:hidden`) rather than rendering broken, and never falls back to
  another diocese's crest — the wrong one is worse than none.
- **The crest slot sizes by HEIGHT, not as a square**, because the artwork is
  not guaranteed to be square. An earlier Midlands file was 203×150 and a
  square slot letterboxed it to 24×18 — a third smaller on the axis carrying
  its detail. `height:24px;width:auto;max-width:46px` treats any shape at the
  same scale, and the masthead is the same height either way. Both files
  happen to be 192×192 today; the rule is what keeps the next one safe.
- **A diocesan seal is cropped to its emblem before it is served.** The
  Midlands artwork as supplied is a full seal: the coat of arms inside a ring
  of lettering. It loaded and rendered correctly and still looked like nothing
  — at 24px the ring is sub-pixel and averages to grey haze, and the emblem
  that carries the identity was left occupying about a third of the frame.
  `web/diocese-midlands.webp` is now a square crop of the central emblem
  (source 587×587, centre 294,295, half-side 180 → 192×192), which doubles the
  emblem on screen: dark pixels in a 24×24 render go from 86 to 158, against
  100 for London's. **`source-art/` keeps the uncropped seal** — the crop is a
  rendering decision for a 24px slot, not a correction to the artwork, and the
  original has to survive for the next time it is needed at a readable size.
  Measure this the same way rather than by eye: render to a 24×24 canvas,
  composite over white and count pixels below 180 luminance. "The file is
  there and the img element is visible" is not the same claim as "a reader can
  see it", and only the first of those had been checked.
- Both crests are cache-first, so replacing either needs a `VERSION` bump.

### Players on a History club page

A club's History page lists **every player the archive records for it** —
`rosterSection` in `app.js`, `teamRoster` in `model.js`, `fetchArchiveRoster`
in `api.js`. It appears on both surfaces the cabinet serves: the standalone
archive club page and the History tab of a live club.

- **It is not a squad list and the copy must never let it read as one.** There
  are no archive team sheets. Five of the thirty-seven editions carry match
  detail; the rest are a year and a champion. The list is reconstructed from
  goals, assists, cards, leaderboard rows and awards, so a player who turned
  out every year and never scored leaves no trace whatsoever. The note under
  the heading says that in the reader's words — nineteen names under a club
  badge will be read as the squad unless something says otherwise.
- **The live Squads tab is untouched and stays a real team sheet.** Only
  History has to hedge, because only History is reconstructing something
  nobody wrote down completely. Same word, two different kinds of claim.
- **Own goals are excluded from attribution.** `team_id` on an own-goal row
  means the scorer's club in some editions and the credited club in others —
  the same contradiction that makes `archScorerLines` place them by scoreline.
  Trusting it here would file a player under a club they never played for,
  which is worse than leaving them out.
- **Assists count as an appearance.** The assister on a goal is a teammate of
  the scorer, so the attribution is sound even though the row carries no team
  of its own.
- **Scoped by category, like the cabinet around it.** SMPK's men's page must
  not list COSA players. `teamRoster` takes `category` and filters editions
  before it reads a single event; the gender toggle re-renders it.
- **Names are folded on `player_canonical`**, so "D Ramsis", "Ramsis, D" and
  "Demas Ramsis" are one row. This is the same reason the cabinet renders
  honours canonically — a club's list down the years is exactly where two
  spellings of one man read as two people.
- **The read is not part of the render gate.** `loadRoster` latches its own
  failure and the section simply does not appear; a club's finals and honours
  must not vanish because one extra read timed out on venue wifi.

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
- **TWO MORE NAME COLLISIONS, both added on 2026-08-24 and both the same shape
  as the St George trio.** G4: **St Mary & St Mina, Manchester** and **St Mary
  & St Mina, Ireland** carry identical church names and differ only by city —
  Manchester won CONAFA 2016 and 2017, Ireland were 2015 debutants who could
  not attend in 2016. G5: **St Mark, Kensington** and **St Mary & St Mark,
  Birmingham** — a prefix or token match on "St Mark" collapses them. `0035`
  asserts all four survive as separate rows.
- **"Republic of Ireland" is a parish church.** Both CONAFA reports print it,
  and `0026` guessed at `St Mina, Ireland`. Adam confirms St Mary & St Mina,
  Ireland. `0035` renames it and keeps the report's string as an alias — **and
  keeps the row's id**, because ids are stable keys other rows point at and
  the uuidv5 scheme names a row at creation, it does not re-derive on rename.
- **BIRMINGHAM IS AN OPEN QUESTION, Q12, and both rows stand.** The registry
  holds St Mary & Archangel Michael, Birmingham (from CONAFA 2026) *and* St
  Mary & St Mark, Birmingham (from the CONAFA 2015 report and COFTA 2017's
  joint entrant). Whether the city has two Coptic churches or one of the names
  is wrong cannot be inferred, so neither was merged into the other. `0035`
  asserts the count is exactly 2, so a later tidy-up fails loudly.
- **A joint side is ONE club.** COFTA 2017's Rotherham & Birmingham entry gets
  its own registry row, exactly as Liverpool & Bolton already does — never
  split into its parishes, never merged into either. `0037` asserts the joint
  row is present and that neither parish appears separately that year.
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

### Held open, deliberately

- **Q12 — Birmingham: one Coptic church or two?** See the identity guards
  above. Both rows stand until Adam rules.
- **Q13 — is the Mina Muharib of COFTA 2014 the same man as CONAFA 2016's?**
  He opened Brighton's 2014 semi-final, described as his fourth of that
  tournament; Brighton's CONAFA 2016 top scorer carries the same name. Same
  club, same name, two years apart — which is precisely the evidence this
  archive has always refused to merge on. Neither merged nor split.
- **C18 — Nduoma Chilaka's five goals in 2014 are NOT recomputed.** The report
  attributes two of them explicitly (the headers against Croydon) and makes
  clear the final's free-kick was an OWN GOAL, not his. With no goal-by-goal
  record for 2014 the archive cannot tell whether the 5 ever included it, so
  the organiser-confirmed figure stands untouched and the own goal is stored
  separately with no player. The entry exists to stop both failure modes: a
  sixth Chilaka goal, or a quiet reduction to 4 to make the arithmetic close.

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

What every drill here has had to learn, and all of it applies to any drill that navigates:

- **THE BROWSER PANE THESE RUN IN IS A HIDDEN PAGE, AND ITS TIMERS ARE
  THROTTLED HARD.** Measured 2026-08-21: `document.hidden` is `true` and a
  single `setTimeout(…, 150)` actually takes about **three seconds** — ten of
  them ran to over 30s, roughly twenty times slow. `tabs_select` does not help;
  it fronts a tab inside a pane that is itself not displayed.
  The slowness was the visible half. The dangerous half was that every drill
  waited on a **fixed iteration budget** — `for (let i = 0; i < 60; i++) await
  wait(150)`, which reads as "nine seconds" and is really "sixty timers". Under
  throttling that ran out long before the page rendered, and then the loop
  simply carried on: no error, no timeout, no line in the report. The drill
  asserted against a half-built DOM and reported the result as though it had
  waited properly. **A drill that cannot fail honestly is worse than no drill.**
- **`tests/until.js` is the fix, and every navigating drill now uses it.**
  `untilOr(cond, label, timeout)` takes a **wall-clock** deadline, resolves off
  a `MutationObserver` so it fires the instant the app renders rather than on
  the next throttled tick, and **returns false on timeout** — callers push
  those into `__untilTimeouts`, and each drill ends with a
  `no wait timed out` check so a timeout appears in the report AS a timeout.
  The effect is not subtle: the naming drill went from **over 25 minutes to
  under a second**, and gender (14) and archive-flags (6) run instantly too.
  Any new drill uses `untilOr`; a counted `await wait(…)` loop is a bug.
- **A drill with `<base href="../web/">` must load the helper as
  `../tests/until.js`.** `gender_drill.html` sets that base so the app's
  relative crest paths resolve, which also rewrites `./until.js` into
  `web/until.js` — a 404 that leaves `untilOr` undefined and kills the drill on
  its first call, silently, because a dead drill sets no summary at all. It
  looked exactly like "still running".
- **Bare settle sleeps (`await wait(300)` after a click) are left alone.**
  `assist_drill` and `boot_drill` use only those and have no counted condition
  loops, so throttling makes them slow and never wrong — a sleep that runs long
  is safe in a way that a counted wait which gives up early is not.

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
