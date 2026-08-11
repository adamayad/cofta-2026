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

/** Mini-league among the tied clubs, counting only matches between them. */
function headToHead(tied, matches) {
  const ids = new Set(tied.map(r => r.team.id));
  const sub = matches.filter(m => ids.has(m.home) && ids.has(m.away));
  const mini = tallyInto(tied.map(r => blankRow(r.team)), sub);
  return Object.fromEntries(mini.map(r => [r.team.id, r]));
}

/** Order a group of clubs already level on points. */
function breakTie(tied, matches) {
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

  // Anything still level after all four steps needs a shoot-out.
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const ha = h2h[a.team.id], hb = h2h[b.team.id];
    const sameH2H = !played || (ha.pts === hb.pts && ha.gd === hb.gd && ha.f === hb.f);
    if (sameH2H && a.gd === b.gd && a.f === b.f) { a.unresolved = true; b.unresolved = true; }
  }
  return sorted;
}

export function standings(teams, matches, group) {
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
      ? breakTie(bucket, matches)
      : bucket.sort((x, y) => x.team.city.localeCompare(y.team.city));
    out.push(...settled);
  }
  return out;
}

/* ── awards ──────────────────────────────────────────────── */
/**
 * Golden boot, player of the tournament and golden glove.
 * Ties are reported rather than resolved: the rules say a shared golden boot
 * gets a duplicate trophy, and a tied golden glove is decided by the managers.
 */
export function awards(teams, matches, events, players = {}) {
  const live = events.filter(e => !e.voided);

  const count = (pred, key) => {
    const tally = {};
    for (const e of live) if (pred(e)) {
      const k = key(e);
      if (k) tally[k] = (tally[k] || 0) + 1;
    }
    const best = Math.max(0, ...Object.values(tally));
    return {
      tally,
      winners: best ? Object.keys(tally).filter(k => tally[k] === best) : [],
      count: best,
    };
  };

  const boot = count(e => e.t === 'goal', e => e.p);
  const motm = count(e => e.t === 'motm', e => e.p);

  // Golden glove: fewest conceded, among clubs that have actually played.
  const conceded = {};
  for (const t of teams) conceded[t.id] = { team: t, played: 0, against: 0 };
  for (const m of matches) {
    if (!m.home || !m.away || !hasStarted(m)) continue;
    conceded[m.home].played++; conceded[m.home].against += m.as;
    conceded[m.away].played++; conceded[m.away].against += m.hs;
  }
  const eligible = Object.values(conceded).filter(c => c.played > 0);
  const fewest = eligible.length ? Math.min(...eligible.map(c => c.against)) : null;

  return {
    goldenBoot: {
      ...boot,
      shared: boot.winners.length > 1,
      names: boot.winners.map(id => players[id]?.name ?? id),
    },
    playerOfTournament: {
      ...motm,
      shared: motm.winners.length > 1,
      names: motm.winners.map(id => players[id]?.name ?? id),
    },
    goldenGlove: {
      conceded: eligible,
      winners: eligible.filter(c => c.against === fewest),
      count: fewest,
      // "Where there is a tie, it will be decided by the church managers."
      decidedByManagers: eligible.filter(c => c.against === fewest).length > 1,
    },
  };
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

/** Adjacent clubs the rules could not separate, once the group is over.
 *  Mid-group ties are transient noise and are deliberately not reported. */
export function unresolvedPairs(teams, matches, group) {
  if (!groupComplete(matches, group)) return [];
  const rows = standings(teams, matches, group);
  const out = [];
  for (let i = 0; i < rows.length - 1; i++)
    // Both flagged AND on equal points: two separate level pairs can sit
    // adjacent in the table, and clubs on different points are never a pair.
    if (rows[i].unresolved && rows[i + 1].unresolved
        && rows[i].pts === rows[i + 1].pts)
      out.push({ i, a: rows[i], b: rows[i + 1] });
  return out;
}

/** Who fills each knockout slot: a manual override if one is set, else the
 *  group tables — but ONLY once the group is complete and the rules have
 *  genuinely separated the top two. Until then the slot stays open, so a
 *  club never appears in a semi-final it has not yet earned. */
export function resolveSlots(teams, matches, overrides = {}) {
  const live = (r) => !r.team.disqualified;

  const decided = (g) => {
    if (!groupComplete(matches, g)) return null;
    const rows = standings(teams, matches, g).filter(live);
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
