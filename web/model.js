/**
 * COFTA 2026 — clock maths and standings.
 *
 * Nothing here ticks and nothing here writes. Every phone derives the minute
 * locally from the anchor timestamp on the match row, which is why polling
 * every few seconds still gives a clock that never lags.
 */

export const HALF_MIN = 20;
export const HALF_MS = HALF_MIN * 60 * 1000;

/* ── server time offset ──────────────────────────────────── */
let offset = 0;
/** The snapshot carries the server's `now`, so every poll re-corrects any
 *  drift between this device's clock and the database's. Free of charge. */
export function syncFromSnapshot(serverNowIso, requestSentAt) {
  const rtt = Date.now() - requestSentAt;
  offset = Date.parse(serverNowIso) + rtt / 2 - Date.now();
}
export const now = () => Date.now() + offset;
export const getOffset = () => offset;

/* ── clock ───────────────────────────────────────────────── */
export function elapsedMs(m) {
  if (!m.run || !m.anchor) return Number(m.accum || 0);
  return Number(m.accum || 0) + Math.max(0, now() - Date.parse(m.anchor));
}

export function minuteLabel(m) {
  const e = elapsedMs(m);
  if (m.status === 'first_half' && e > HALF_MS)
    return `${HALF_MIN}+${Math.floor((e - HALF_MS) / 60000) + 1}`;
  if (m.status === 'second_half' && e > 2 * HALF_MS)
    return `${HALF_MIN * 2}+${Math.floor((e - 2 * HALF_MS) / 60000) + 1}`;
  return String(Math.floor(e / 60000) + 1);
}

export function mmss(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const isLive = (m) => m.status === 'first_half' || m.status === 'second_half';
export const hasStarted = (m) => m.status !== 'scheduled';
export const isKnockout = (m) => m.stage !== 'A' && m.stage !== 'B';
/** A level knockout tie that has not yet been settled on penalties.
 *  `!m.pd` matters: without it the shootout panel would reappear after the
 *  result was confirmed, inviting someone to enter it twice. */
export const needsShootout = (m) =>
  isKnockout(m) && m.status === 'full_time' && m.hs === m.as && !m.ff && !m.pd;

/** What the badge on a fixture row should read. */
export function statusLabel(m) {
  if (m.ff) return 'Forfeit';
  switch (m.status) {
    case 'scheduled':  return m.kickoff;
    case 'half_time':  return 'Half time';
    case 'full_time':
      if (m.pd) return `${m.ph}\u2013${m.pa} on pens`;
      return needsShootout(m) ? 'Shootout pending' : 'Full time';
    default:
      return `${minuteLabel(m)}\u2032${m.run ? '' : ' stopped'}`;
  }
}

export function stageLabel(m) {
  return { A: 'Group A', B: 'Group B', SF1: 'Semi-final 1',
           SF2: 'Semi-final 2', FINAL: 'Final' }[m.stage] ?? m.stage;
}

/** Winner of a tie, or null if it is not settled. */
export function winnerOf(m) {
  if (!m) return null;
  if (m.ff) return m.ff === 'home' ? m.away : m.home;   // the OTHER side wins
  if (m.status !== 'full_time') return null;
  if (m.hs > m.as) return m.home;
  if (m.as > m.hs) return m.away;
  if (m.pd) return m.ph > m.pa ? m.home : m.away;
  return null;
}

/* ── standings, computed never stored ────────────────────── */
/**
 * COFTA rules, tie-breaks in order:
 *   1. points
 *   2. head-to-head between the tied clubs
 *   3. goal difference
 *   4. goals scored
 *   5. a one-off penalty shoot-out
 *
 * Head-to-head first is unusual and it is what makes this fiddly: it cannot
 * be a simple comparator, because with three clubs level the comparison is
 * not transitive. The standard resolution, and the one used here, is a
 * mini-league among only the tied clubs, using only the matches they played
 * against each other.
 *
 * Anything the rules cannot separate is flagged `unresolved`, because the
 * answer is then a penalty shoot-out arranged off the pitch — not something
 * the app should invent.
 */

function blankRow(t) {
  return { team: t, p: 0, w: 0, d: 0, l: 0, f: 0, a: 0, pts: 0, gd: 0, unresolved: false };
}

function tallyInto(rows, matches) {
  const by = Object.fromEntries(rows.map(r => [r.team.id, r]));
  for (const m of matches) {
    if (!m.home || !m.away || !hasStarted(m)) continue;
    const H = by[m.home], A = by[m.away];
    if (!H || !A) continue;
    H.p++; A.p++;
    H.f += m.hs; H.a += m.as; A.f += m.as; A.a += m.hs;
    if (m.hs > m.as) { H.w++; A.l++; }
    else if (m.as > m.hs) { A.w++; H.l++; }
    else { H.d++; A.d++; }
  }
  for (const r of rows) { r.pts = r.w * 3 + r.d; r.gd = r.f - r.a; }
  return rows;
}

/** The stored one-off shoot-out for a pair, if it has been played. */
function tieResult(ties, x, y) {
  const [lo, hi] = x < y ? [x, y] : [y, x];
  const t = (ties || []).find(t => t.a === lo && t.b === hi);
  if (!t) return null;
  return { ...t, winner: t.sa > t.sb ? t.a : t.b };
}

/** Mini-league among the tied clubs, counting only matches between them. */
function headToHead(tied, matches) {
  const ids = new Set(tied.map(r => r.team.id));
  const sub = matches.filter(m => ids.has(m.home) && ids.has(m.away));
  const mini = tallyInto(tied.map(r => blankRow(r.team)), sub);
  return Object.fromEntries(mini.map(r => [r.team.id, r]));
}

/** Order a group of clubs already level on points. */
function breakTie(tied, matches, ties) {
  if (tied.length === 1) return tied;

  const h2h = headToHead(tied, matches);
  const played = tied.every(r => h2h[r.team.id].p > 0);

  const sorted = [...tied].sort((x, y) => {
    if (played) {
      const a = h2h[x.team.id], b = h2h[y.team.id];
      if (b.pts !== a.pts) return b.pts - a.pts;   // head-to-head points
      if (b.gd  !== a.gd)  return b.gd  - a.gd;    // head-to-head goal difference
      if (b.f   !== a.f)   return b.f   - a.f;     // head-to-head goals scored
    }
    if (y.gd !== x.gd) return y.gd - x.gd;         // overall goal difference
    if (y.f  !== x.f)  return y.f  - x.f;          // overall goals scored
    return 0;
  });

  // Anything still level after all four steps needs a one-off shoot-out.
  // If that shoot-out has been played, it is the fifth and final tie-break:
  // the winner ranks above the loser and the pair is settled, not flagged.
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const ha = h2h[a.team.id], hb = h2h[b.team.id];
    const sameH2H = !played || (ha.pts === hb.pts && ha.gd === hb.gd && ha.f === hb.f);
    if (!(sameH2H && a.gd === b.gd && a.f === b.f)) continue;

    const t = tieResult(ties, a.team.id, b.team.id);
    if (t) {
      if (t.winner === b.team.id) { sorted[i] = b; sorted[i + 1] = a; }
      sorted[i].tie = 'W'; sorted[i + 1].tie = 'L';
    } else {
      a.unresolved = true; b.unresolved = true;
    }
  }
  return sorted;
}

export function standings(teams, matches, group, ties = []) {
  const rows = tallyInto(
    teams.filter(t => t.group_letter === group).map(blankRow),
    matches);

  // group by points, break each tie, then flatten
  const byPts = new Map();
  for (const r of rows) {
    if (!byPts.has(r.pts)) byPts.set(r.pts, []);
    byPts.get(r.pts).push(r);
  }
  const out = [];
  for (const pts of [...byPts.keys()].sort((a, b) => b - a)) {
    const bucket = byPts.get(pts);
    // clubs that have played nothing yet just sort by name, not by tie-break
    const settled = bucket.some(r => r.p > 0)
      ? breakTie(bucket, matches, ties)
      : bucket.sort((x, y) => x.team.city.localeCompare(y.team.city));
    out.push(...settled);
  }
  return out;
}

/* ── leaderboards ────────────────────────────────────────── */
/**
 * Standard competition ranking, the "1224" kind: rows level on the ranked
 * number share the higher place, and the places they consume are then
 * skipped — two joint seconds are followed by a fourth, never a third.
 * Dense ranking (1,2,2,3) would quietly promote whoever came next, which is
 * not what a trophy board means by "joint second".
 *
 * `scoreOf` pulls the number being ranked. The golden glove ranks upward —
 * fewest conceded wins — so `lowerIsBetter` flips the comparison rather than
 * keeping a second copy of this. `tieBreak` only orders rows that already
 * share a place; it never changes the place itself.
 *
 * Returns [{ item, score, place, joint }] in display order.
 */
export function rankRows(items, scoreOf, { lowerIsBetter = false, tieBreak } = {}) {
  const sorted = [...(items || [])].sort((a, b) => {
    const d = lowerIsBetter ? scoreOf(a) - scoreOf(b) : scoreOf(b) - scoreOf(a);
    if (d) return d;
    return tieBreak ? tieBreak(a, b) : 0;
  });

  const out = [];
  let place = 0, prev = 0, started = false;
  sorted.forEach((item, i) => {
    const score = scoreOf(item);
    if (!started || score !== prev) { place = i + 1; prev = score; started = true; }
    out.push({ item, score, place });
  });

  const held = {};
  for (const r of out) held[r.place] = (held[r.place] || 0) + 1;
  for (const r of out) r.joint = held[r.place] > 1;
  return out;
}

/** Count one kind of event per player, ranked. Players with none are absent
 *  — a leaderboard of nobodies on nought helps no one. */
function playerBoard(events, pred, players) {
  const tally = {};
  for (const e of (events || [])) {
    if (e.voided || !e.p || !pred(e)) continue;
    tally[e.p] = (tally[e.p] || 0) + 1;
  }
  const rows = Object.entries(tally).map(([id, n]) => ({
    id, n,
    name: players?.[id]?.name ?? id,
    team: players?.[id]?.team ?? null,
  }));
  return rankRows(rows, r => r.n, { tieBreak: (a, b) => a.name.localeCompare(b.name) });
}

/** Every player with at least one attributed goal. */
export const goldenBootBoard = (events, players = {}) =>
  playerBoard(events, e => e.t === 'goal', players);

/** Every player with at least one man-of-the-match award. */
export const playerOfTournamentBoard = (events, players = {}) =>
  playerBoard(events, e => e.t === 'motm', players);

/** Goals conceded per club — the golden glove board is club-level even though
 *  the trophy itself goes to a goalkeeper. Fewest conceded ranks first. */
export function goldenGloveBoard(teams, matches) {
  const conceded = {};
  for (const t of (teams || [])) conceded[t.id] = { team: t, played: 0, against: 0 };
  for (const m of (matches || [])) {
    if (!m.home || !m.away || !hasStarted(m)) continue;
    const H = conceded[m.home], A = conceded[m.away];
    if (!H || !A) continue;
    H.played++; H.against += m.as;
    A.played++; A.against += m.hs;
  }
  return rankRows(Object.values(conceded).filter(c => c.played > 0), r => r.against, {
    lowerIsBetter: true,
    tieBreak: (a, b) => a.team.city.localeCompare(b.team.city),
  });
}

/* ── who leads a board, and what a tie at the top means ──── */
/**
 * Everyone in first place on any of the three boards — one row normally, more
 * when the top is joint. Board rows already carry their place, so this is the
 * one place that decides what "leading" means, rather than each card deciding
 * again with its own filter.
 */
/** Every player with at least one attributed yellow. Cards logged without a
 *  name still count on the match report; they cannot appear on a board. */
export const yellowCardBoard = (events, players = {}) =>
  playerBoard(events, e => e.t === 'yellow', players);

/** Every player sent off. Usually empty, which is the good outcome. */
export const redCardBoard = (events, players = {}) =>
  playerBoard(events, e => e.t === 'red', players);

/**
 * Per-club match tallies, the base for the team boards.
 *
 * `played`, `for` and `against` follow the same rule the golden glove has
 * always used, so scored and conceded always agree with each other. A clean
 * sheet is stricter on purpose: it needs a match actually played out to full
 * time and not forfeited, because a 3–0 awarded at a desk is a result and
 * not a goalkeeping performance.
 */
function teamTally(teams, matches) {
  const by = {};
  for (const t of (teams || [])) by[t.id] = { team: t, played: 0, for: 0, against: 0, clean: 0 };
  for (const m of (matches || [])) {
    if (!m.home || !m.away || !hasStarted(m)) continue;
    const H = by[m.home], A = by[m.away];
    if (!H || !A) continue;
    H.played++; A.played++;
    H.for += m.hs; H.against += m.as;
    A.for += m.as; A.against += m.hs;
    if (m.status === 'full_time' && !m.ff) {
      if (m.as === 0) H.clean++;
      if (m.hs === 0) A.clean++;
    }
  }
  return Object.values(by).filter(r => r.played > 0);
}

const byCity = (a, b) => a.team.city.localeCompare(b.team.city);

/** Goals scored, most first. */
export const goalsScoredBoard = (teams, matches) =>
  rankRows(teamTally(teams, matches), r => r.for, { tieBreak: byCity });

/** Goals conceded, fewest first — the golden glove board under its plain
 *  name. One implementation, so the trophy and the stat can never disagree. */
export const goalsConcededBoard = goldenGloveBoard;

/** Clean sheets, most first. */
export const cleanSheetsBoard = (teams, matches) =>
  rankRows(teamTally(teams, matches), r => r.clean, { tieBreak: byCity });

/**
 * How many different players have scored for each club — a squad that shares
 * its goals around against one that relies on a single striker.
 *
 * Counts distinct players with at least one attributed goal. Own goals are
 * excluded: they are credited to the other side's score and belong to nobody
 * as a scorer. A goal logged without a name cannot count either, since there
 * is no player to be distinct from.
 */
export function distinctScorersBoard(teams, events, players = {}) {
  const sets = {};
  for (const t of (teams || [])) sets[t.id] = new Set();
  for (const e of (events || [])) {
    if (e.voided || e.t !== 'goal' || !e.p) continue;
    const team = players?.[e.p]?.team;
    if (team && sets[team]) sets[team].add(e.p);
  }
  const rows = (teams || [])
    .map(t => ({ team: t, n: sets[t.id].size }))
    .filter(r => r.n > 0);
  return rankRows(rows, r => r.n, { tieBreak: byCity });
}

/**
 * The first n rows of a ranked board, for a preview card.
 *
 * ROWS, not places. If four players tie for first, a three-row preview shows
 * three of them and the full board tells the rest — the alternative, showing
 * every row that shares a place, makes the card's height depend on how level
 * the tournament happens to be. The order is whatever rankRows settled, so it
 * is deterministic and the preview always matches the top of the board it
 * previews, tie-break and all.
 */
export const topRows = (board, n = 3) => (board || []).slice(0, n);

export const leaders = (board) => (board || []).filter(r => r.place === 1);

/**
 * The golden glove is the trophy the app cannot award on its own:
 * "Where there is a tie, it will be decided by the church managers."
 *
 * The other two duplicate instead — a shared golden boot means a second
 * trophy is bought — so only this one turns a joint lead into a decision
 * taken off the app. The organiser's trophy panel deliberately starts the
 * glove with nobody picked for exactly this reason.
 */
export const decidedByManagers = (gloveBoard) => leaders(gloveBoard).length > 1;

/* ── trophies ────────────────────────────────────────────── */
/** The three trophies, in the order they are presented. All go to players —
 *  the golden glove to a goalkeeper, even though its board is club-level. */
export const TROPHIES = [
  ['golden_boot',          'Golden Boot'],
  ['player_of_tournament', 'Player of the Tournament'],
  ['golden_glove',         'Golden Glove'],
];

export const trophyLabel = (key) =>
  (TROPHIES.find(([k]) => k === key) ?? [, key])[1];

/** Nothing is presented until the final is over, one way or the other. */
export function finalComplete(matches) {
  const f = (matches || []).find(m => m.stage === 'FINAL');
  return !!f && (f.status === 'full_time' || !!f.ff);
}

/**
 * Confirmed winners from a snapshot, as { trophy: [playerId, ...] }.
 * Deliberately tolerant: a snapshot cached by an older build has no
 * `trophies` key at all, and that must read as "none confirmed yet" rather
 * than throwing on a phone that has not reloaded since the deploy.
 */
export function confirmedTrophies(snap) {
  const raw = snap?.trophies;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key] of TROPHIES) {
    const ids = raw[key];
    if (Array.isArray(ids) && ids.length) out[key] = ids.filter(Boolean);
  }
  return out;
}

/** What a player's profile should list under Honours. */
export function honoursFor(playerId, trophies) {
  if (!playerId) return [];
  return TROPHIES
    .filter(([k]) => (trophies?.[k] || []).includes(playerId))
    .map(([k, label]) => ({
      key: k, label,
      shared: (trophies[k] || []).length > 1,
    }));
}

/* ── suspensions ─────────────────────────────────────────── */
/**
 * COFTA discipline:
 *   - two yellows in SEPARATE matches  -> miss the next match
 *   - one red                          -> miss the next match
 *   - a yellow in the group stage and a yellow in the semi-final do NOT
 *     combine, so yellows are counted per phase, not across the tournament
 *
 * A ban applies to the player's OWN CLUB's next fixture, not simply the next
 * match in the timetable — those are rarely the same thing when two pitches
 * are running.
 *
 * Needs player attribution on card events. Without it cards are still
 * recorded, but nobody can be suspended.
 */
export function suspensions(matches, events, players = {}) {
  const chrono = [...matches]
    .filter(hasStarted)
    .sort((a, b) => a.day - b.day || a.kickoff.localeCompare(b.kickoff));

  // every match a club is involved in, in order — including ones not yet played
  const fixturesFor = (teamId) => [...matches]
    .filter(m => m.home === teamId || m.away === teamId)
    .sort((a, b) => a.day - b.day || a.kickoff.localeCompare(b.kickoff));

  const phaseOf = (m) => (isKnockout(m) ? 'knockout' : 'group');
  const out = {};
  const yellows = {};

  for (const m of chrono) {
    const phase = phaseOf(m);
    for (const e of events.filter(x => x.m === m.id && !x.voided)) {
      if (!e.p) continue;                       // no player attributed
      const teamId = players[e.p]?.team
        ?? (e.s === 'home' ? m.home : e.s === 'away' ? m.away : null);

      const ban = (reason) => {
        if (out[e.p]) return;                   // already banned, do not stack
        const fx = fixturesFor(teamId);
        const here = fx.findIndex(x => x.id === m.id);
        out[e.p] = {
          player: players[e.p]?.name ?? e.p,
          team: teamId,
          reason,
          misses: here >= 0 ? (fx[here + 1] ?? null) : null,
        };
      };

      if (e.t === 'red') ban('Red card');

      if (e.t === 'yellow') {
        yellows[e.p] ??= { group: new Set(), knockout: new Set() };
        yellows[e.p][phase].add(m.id);
        if (yellows[e.p][phase].size >= 2) ban('Two yellow cards');
      }
    }
  }
  return out;
}

/** Players unavailable for one specific match. */
export function suspendedFor(matchId, matches, events, players = {}) {
  return Object.entries(suspensions(matches, events, players))
    .filter(([, s]) => s.misses?.id === matchId)
    .map(([id, s]) => ({ id, ...s }));
}

/* ── knockout slots ──────────────────────────────────────── */
/** Every match in the group finished, whether played or forfeited. */
function groupComplete(matches, g) {
  const ms = matches.filter(m => m.stage === g);
  return ms.length > 0 && ms.every(m => m.status === 'full_time' || !!m.ff);
}

/** Both groups played out. From this point Sunday is the day that matters,
 *  which is when the Fixtures tab should stop opening on Saturday. */
export const groupStageComplete = (matches) =>
  ['A', 'B'].every(g => groupComplete(matches || [], g));

/** Adjacent clubs the rules could not separate, once the group is over.
 *  Mid-group ties are transient noise and are deliberately not reported. */
export function unresolvedPairs(teams, matches, group, ties = []) {
  if (!groupComplete(matches, group)) return [];
  const rows = standings(teams, matches, group, ties);
  const out = [];
  // Only pairs that decide qualification: 1st/2nd or 2nd/3rd. A 3rd/4th tie
  // sends nobody through, so the rules require no shoot-out and none is
  // offered — those clubs simply stay marked level.
  for (let i = 0; i <= 1 && i < rows.length - 1; i++)
    if (rows[i].unresolved && rows[i + 1].unresolved
        && rows[i].pts === rows[i + 1].pts)
      out.push({ i, a: rows[i], b: rows[i + 1] });
  return out;
}

/** Who fills each knockout slot: a manual override if one is set, else the
 *  group tables — but ONLY once the group is complete and the rules have
 *  genuinely separated the top two. Until then the slot stays open, so a
 *  club never appears in a semi-final it has not yet earned. */
export function resolveSlots(teams, matches, overrides = {}, ties = []) {
  const live = (r) => !r.team.disqualified;

  const decided = (g) => {
    if (!groupComplete(matches, g)) return null;
    const rows = standings(teams, matches, g, ties).filter(live);
    if (rows[0]?.unresolved || rows[1]?.unresolved) return null;
    return rows;
  };

  const A = decided('A'), B = decided('B');
  const pick = (key, fallback) => overrides[key] || fallback || null;
  const sf1 = matches.find(m => m.stage === 'SF1');
  const sf2 = matches.find(m => m.stage === 'SF2');

  return {
    sf1_home: pick('sf1_home', A?.[0]?.team.id),
    sf1_away: pick('sf1_away', B?.[1]?.team.id),
    sf2_home: pick('sf2_home', B?.[0]?.team.id),
    sf2_away: pick('sf2_away', A?.[1]?.team.id),
    final_home: pick('final_home', winnerOf(sf1)),
    final_away: pick('final_away', winnerOf(sf2)),
  };
}

/** Canonical fixture order: day, kick-off, pitch. The snapshot must never be
 *  trusted for ordering — Postgres moves updated rows, so without this the
 *  matches being played kept sinking to the bottom of the list. */
export const fixtureOrder = (a, b) =>
  a.day - b.day
  || String(a.kickoff).localeCompare(String(b.kickoff))
  || String(a.pitch).localeCompare(String(b.pitch));

/* ── scorer lines, FotMob-style ──────────────────────────── */
/** Chronological key for a minute label: "20+2" sorts before "21". */
export function minuteKey(label) {
  const m = /^(\d+)(?:\+(\d+))?/.exec(String(label || ''));
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2] || 0);
}

/**
 * The lines under a team's score: one per scorer with every minute they
 * scored, own goals credited to the benefiting side and marked, and any
 * unattributed goals collapsed into a bare line of minutes.
 * Returns [{ name|null, og, mins: ['12\u2032', ...] }] in chronological order.
 */
export function scorerLines(events, matchId, sideKey, nameOf) {
  const mine = (events || []).filter(e =>
    e.m === matchId && !e.voided &&
    ((e.t === 'goal' && e.s === sideKey) ||
     (e.t === 'own_goal' && e.s && e.s !== sideKey)));

  const groups = new Map();
  for (const e of mine) {
    const og = e.t === 'own_goal';
    const name = e.p ? (nameOf ? nameOf(e.p) : e.p) : null;
    const key = (og ? 'og:' : 'g:') + (name ?? '\u2205');
    if (!groups.has(key)) groups.set(key, { name, og, mins: [], pid: e.p ?? null });
    groups.get(key).mins.push(e.min || '');
  }

  const out = [...groups.values()];
  for (const g of out) g.mins.sort((a, b) => minuteKey(a) - minuteKey(b));
  out.sort((a, b) => minuteKey(a.mins[0]) - minuteKey(b.mins[0]));
  return out;
}
