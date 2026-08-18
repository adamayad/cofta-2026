/**
 * COFTA 2026 — model tests.
 *
 *   node tests/model_test.mjs
 *
 * Plain ESM with no imports beyond model.js itself, so the same file also
 * runs unchanged inside a browser (import it and call `summary()`), which is
 * how it gets executed on a machine with no node installed.
 *
 * Scope: the leaderboard ranking and trophy helpers added for the awards
 * work. The ranking is the part worth pinning down — standard competition
 * ranking is one off-by-one away from dense ranking, and the difference only
 * shows up on a joint place.
 */
import * as M from '../web/model.js';

/* ── the smallest test harness that still reports usefully ── */
const results = [];
let failures = 0;

function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) {
    failures++;
    results.push({ name, ok: false, error: e && e.message ? e.message : String(e) });
  }
}

const show = (v) => JSON.stringify(v);

function eq(actual, expected, what = 'value') {
  if (show(actual) !== show(expected))
    throw new Error(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

/* Places only — the part every ranking test is really asserting. */
const places = (ranked) => ranked.map(r => r.place);
const joints = (ranked) => ranked.map(r => r.joint);

/* ── rankRows: standard competition ranking ──────────────── */
const n = (x) => x.n;

test('rankRows orders descending and numbers from one', () => {
  const r = M.rankRows([{ n: 1 }, { n: 5 }, { n: 3 }], n);
  eq(r.map(x => x.score), [5, 3, 1], 'scores');
  eq(places(r), [1, 2, 3], 'places');
  eq(joints(r), [false, false, false], 'joint flags');
});

test('rankRows gives 1, 2, 2, 4 — not 1, 2, 2, 3', () => {
  const r = M.rankRows([{ n: 5 }, { n: 3 }, { n: 3 }, { n: 1 }], n);
  eq(places(r), [1, 2, 2, 4], 'places');
  eq(joints(r), [false, true, true, false], 'joint flags');
});

test('rankRows skips the whole run: joint first is followed by third', () => {
  const r = M.rankRows([{ n: 4 }, { n: 4 }, { n: 2 }], n);
  eq(places(r), [1, 1, 3], 'places');
  eq(joints(r), [true, true, false], 'joint flags');
});

test('rankRows handles a three-way joint place', () => {
  const r = M.rankRows([{ n: 9 }, { n: 4 }, { n: 4 }, { n: 4 }, { n: 2 }], n);
  eq(places(r), [1, 2, 2, 2, 5], 'places');
  eq(joints(r), [false, true, true, true, false], 'joint flags');
});

test('rankRows: everyone level is joint first', () => {
  const r = M.rankRows([{ n: 2 }, { n: 2 }, { n: 2 }], n);
  eq(places(r), [1, 1, 1], 'places');
  eq(joints(r), [true, true, true], 'joint flags');
});

test('rankRows: a single row is first and not joint', () => {
  const r = M.rankRows([{ n: 7 }], n);
  eq(places(r), [1], 'places');
  eq(joints(r), [false], 'joint flags');
});

test('rankRows: nothing to rank is not an error', () => {
  eq(M.rankRows([], n), [], 'empty');
  eq(M.rankRows(undefined, n), [], 'undefined');
});

test('rankRows: lowerIsBetter still produces 1, 2, 2, 4', () => {
  const r = M.rankRows([{ n: 3 }, { n: 1 }, { n: 0 }, { n: 1 }], n, { lowerIsBetter: true });
  eq(r.map(x => x.score), [0, 1, 1, 3], 'scores ascending');
  eq(places(r), [1, 2, 2, 4], 'places');
});

test('rankRows: tieBreak orders joint rows but does not split the place', () => {
  const rows = [{ k: 'Zoe', n: 2 }, { k: 'Adam', n: 2 }, { k: 'Mina', n: 5 }];
  const r = M.rankRows(rows, n, { tieBreak: (a, b) => a.k.localeCompare(b.k) });
  eq(r.map(x => x.item.k), ['Mina', 'Adam', 'Zoe'], 'display order');
  eq(places(r), [1, 2, 2], 'places');
});

/* ── golden boot / player of the tournament ──────────────── */
const PLAYERS = {
  p1: { name: 'Mina Gerges',  team: 'stm' },
  p2: { name: 'Andrew Ramzy', team: 'cro' },
  p3: { name: 'Abanoub Adel', team: 'bri' },
  p4: { name: 'Kirollos Y',   team: 'gg'  },
};

const GOALS = [
  { t: 'goal', p: 'p1' }, { t: 'goal', p: 'p1' }, { t: 'goal', p: 'p1' },
  { t: 'goal', p: 'p2' }, { t: 'goal', p: 'p2' },
  { t: 'goal', p: 'p3' }, { t: 'goal', p: 'p3' },
  { t: 'goal', p: 'p4' },
  { t: 'goal', p: 'p1', voided: true },   // undone, must not count
  { t: 'goal', p: null },                 // nobody named, cannot rank
  { t: 'yellow', p: 'p1' },               // not a goal
  { t: 'own_goal', p: 'p2' },             // never credited as a goal
];

test('goldenBootBoard ranks scorers and ignores voided, unattributed and non-goals', () => {
  const r = M.goldenBootBoard(GOALS, PLAYERS);
  eq(r.map(x => x.item.id), ['p1', 'p3', 'p2', 'p4'], 'order');
  eq(r.map(x => x.score), [3, 2, 2, 1], 'goal counts');
  eq(places(r), [1, 2, 2, 4], 'places');
});

test('goldenBootBoard breaks a joint place by name, alphabetically', () => {
  const r = M.goldenBootBoard(GOALS, PLAYERS);
  eq(r[1].item.name, 'Abanoub Adel', 'first of the joint second');
  eq(r[2].item.name, 'Andrew Ramzy', 'second of the joint second');
  eq([r[1].place, r[2].place], [2, 2], 'both are second');
});

test('goldenBootBoard carries the club through for linking', () => {
  const r = M.goldenBootBoard(GOALS, PLAYERS);
  eq(r[0].item.team, 'stm', 'team id');
});

test('goldenBootBoard with no goals at all is empty', () => {
  eq(M.goldenBootBoard([], PLAYERS), [], 'empty board');
});

test('playerOfTournamentBoard counts man-of-the-match awards only', () => {
  const evts = [
    { t: 'motm', p: 'p2' }, { t: 'motm', p: 'p2' },
    { t: 'motm', p: 'p1' },
    { t: 'motm', p: 'p3', voided: true },
    { t: 'goal', p: 'p1' },
  ];
  const r = M.playerOfTournamentBoard(evts, PLAYERS);
  eq(r.map(x => x.item.id), ['p2', 'p1'], 'order');
  eq(r.map(x => x.score), [2, 1], 'award counts');
  eq(places(r), [1, 2], 'places');
});

/* ── golden glove ────────────────────────────────────────── */
const GTEAMS = [
  { id: 'a', city: 'Ashford' }, { id: 'b', city: 'Bexley' },
  { id: 'c', city: 'Croydon' }, { id: 'd', city: 'Dover' },
];
const GMATCHES = [
  { home: 'a', away: 'b', hs: 1, as: 0, status: 'full_time' },
  { home: 'c', away: 'a', hs: 2, as: 2, status: 'full_time' },
  { home: 'b', away: 'c', hs: 0, as: 3, status: 'scheduled' },  // not played yet
];

test('goldenGloveBoard ranks fewest conceded first', () => {
  const r = M.goldenGloveBoard(GTEAMS, GMATCHES);
  eq(r.map(x => x.item.team.id), ['b', 'a', 'c'], 'order');
  eq(r.map(x => x.score), [1, 2, 2], 'conceded');
  eq(places(r), [1, 2, 2], 'places');
  eq(joints(r), [false, true, true], 'joint flags');
});

test('goldenGloveBoard leaves out clubs that have not played', () => {
  const r = M.goldenGloveBoard(GTEAMS, GMATCHES);
  eq(r.some(x => x.item.team.id === 'd'), false, 'Dover absent');
  eq(r.map(x => x.item.played), [1, 2, 1], 'matches played');
});

test('goldenGloveBoard ignores matches with an open knockout slot', () => {
  const r = M.goldenGloveBoard(GTEAMS, [
    ...GMATCHES,
    { home: null, away: 'a', hs: 0, as: 9, status: 'full_time' },
  ]);
  eq(r.map(x => x.score), [1, 2, 2], 'conceded unchanged');
});

test('goldenGloveBoard before any match is empty', () => {
  eq(M.goldenGloveBoard(GTEAMS, []), [], 'empty board');
});

/* ── leading a board, and a tie at the top ───────────────── */
test('leaders returns the sole first place', () => {
  const r = M.goldenBootBoard(GOALS, PLAYERS);
  eq(M.leaders(r).map(x => x.item.id), ['p1'], 'one leader');
});

test('leaders returns every joint first, not just the first row', () => {
  const r = M.rankRows([{ n: 4 }, { n: 4 }, { n: 2 }], n);
  eq(M.leaders(r).map(x => x.score), [4, 4], 'both leaders');
});

test('leaders on an empty or missing board is empty', () => {
  eq(M.leaders([]), [], 'empty');
  eq(M.leaders(undefined), [], 'undefined');
});

test('decidedByManagers is false when one club leads the glove outright', () => {
  // Bexley alone on 1 conceded.
  eq(M.decidedByManagers(M.goldenGloveBoard(GTEAMS, GMATCHES)), false, 'sole leader');
});

test('decidedByManagers is true when clubs are level at the top of the glove', () => {
  // Ashford and Bexley both finish on 1 conceded; Croydon on 2.
  const board = M.goldenGloveBoard(GTEAMS, [
    { home: 'a', away: 'b', hs: 1, as: 1, status: 'full_time' },
    { home: 'c', away: 'a', hs: 0, as: 2, status: 'full_time' },
  ]);
  eq(M.leaders(board).map(x => x.item.team.id), ['a', 'b'], 'level at the top');
  eq(M.decidedByManagers(board), true, 'managers decide');
});

test('decidedByManagers before any match is false, not a tie of nobody', () => {
  eq(M.decidedByManagers(M.goldenGloveBoard(GTEAMS, [])), false, 'empty board');
  eq(M.decidedByManagers(undefined), false, 'no board');
});

test('a club level further down the glove does not invoke the managers', () => {
  // Ashford clear on 0; Bexley and Croydon joint second on 2.
  const board = M.goldenGloveBoard(GTEAMS, [
    { home: 'a', away: 'b', hs: 2, as: 0, status: 'full_time' },
    { home: 'c', away: 'a', hs: 0, as: 2, status: 'full_time' },
  ]);
  eq(places(board), [1, 2, 2], 'joint second');
  eq(M.decidedByManagers(board), false, 'only a tie at the top counts');
});

/* ── trophies ────────────────────────────────────────────── */
test('confirmedTrophies tolerates a snapshot cached before trophies existed', () => {
  eq(M.confirmedTrophies(undefined), {}, 'no snapshot');
  eq(M.confirmedTrophies({}), {}, 'no trophies key');
  eq(M.confirmedTrophies({ trophies: null }), {}, 'null');
  eq(M.confirmedTrophies({ trophies: [] }), {}, 'wrong shape');
});

test('confirmedTrophies drops empty lists and unknown trophies', () => {
  eq(M.confirmedTrophies({ trophies: { golden_boot: [] } }), {}, 'empty list');
  eq(M.confirmedTrophies({ trophies: { golden_boot: ['p1'], made_up: ['x'] } }),
     { golden_boot: ['p1'] }, 'known keys only');
});

test('confirmedTrophies keeps every winner of a shared trophy', () => {
  eq(M.confirmedTrophies({ trophies: { golden_glove: ['p1', 'p2'] } }),
     { golden_glove: ['p1', 'p2'] }, 'both winners');
});

test('honoursFor labels a trophy and marks a shared one', () => {
  const t = { golden_glove: ['p1', 'p2'], golden_boot: ['p3'] };
  eq(M.honoursFor('p1', t), [{ key: 'golden_glove', label: 'Golden Glove', shared: true }], 'shared');
  eq(M.honoursFor('p3', t), [{ key: 'golden_boot', label: 'Golden Boot', shared: false }], 'sole');
  eq(M.honoursFor('p9', t), [], 'no honours');
  eq(M.honoursFor(null, t), [], 'no player');
});

test('honoursFor lists multiple trophies in presentation order', () => {
  const t = { golden_glove: ['p1'], golden_boot: ['p1'], player_of_tournament: ['p1'] };
  eq(M.honoursFor('p1', t).map(h => h.key),
     ['golden_boot', 'player_of_tournament', 'golden_glove'], 'order');
});

test('finalComplete is false until the final is actually over', () => {
  eq(M.finalComplete([]), false, 'no final');
  eq(M.finalComplete([{ stage: 'FINAL', status: 'scheduled' }]), false, 'not started');
  eq(M.finalComplete([{ stage: 'FINAL', status: 'second_half' }]), false, 'in play');
});

test('finalComplete counts a forfeited final as complete', () => {
  eq(M.finalComplete([{ stage: 'FINAL', status: 'full_time' }]), true, 'played out');
  eq(M.finalComplete([{ stage: 'FINAL', status: 'scheduled', ff: 'home' }]), true, 'forfeited');
});

/* ── group stage complete: when Sunday becomes the default day ─ */
/* Two clubs per group here rather than four; groupComplete only asks whether
   every match of that stage has finished, not how many there were. */
const GROUPS = [
  { stage: 'A', status: 'full_time' }, { stage: 'A', status: 'full_time' },
  { stage: 'B', status: 'full_time' }, { stage: 'B', status: 'full_time' },
];

test('groupStageComplete is false while either group is unfinished', () => {
  eq(M.groupStageComplete([...GROUPS.slice(0, 3), { stage: 'B', status: 'second_half' }]),
     false, 'B still playing');
  eq(M.groupStageComplete([{ stage: 'A', status: 'scheduled' }, ...GROUPS.slice(1)]),
     false, 'A not started');
});

test('groupStageComplete is true once both groups are played out', () => {
  eq(M.groupStageComplete(GROUPS), true, 'both done');
});

test('groupStageComplete counts a forfeit as finished', () => {
  eq(M.groupStageComplete([...GROUPS.slice(0, 3),
      { stage: 'B', status: 'scheduled', ff: 'away' }]), true, 'forfeited');
});

test('groupStageComplete ignores the knockout rounds entirely', () => {
  eq(M.groupStageComplete([...GROUPS,
      { stage: 'SF1', status: 'scheduled' },
      { stage: 'FINAL', status: 'scheduled' }]), true, 'knockouts pending');
});

test('groupStageComplete is false with no fixtures at all', () => {
  eq(M.groupStageComplete([]), false, 'empty');
  eq(M.groupStageComplete(undefined), false, 'undefined');
  eq(M.groupStageComplete([{ stage: 'A', status: 'full_time' }]), false, 'no group B');
});

/* ── card boards ─────────────────────────────────────────── */
test('yellowCardBoard and redCardBoard count only their own attributed cards', () => {
  const evts = [
    { t: 'yellow', p: 'p1' }, { t: 'yellow', p: 'p1' }, { t: 'yellow', p: 'p2' },
    { t: 'yellow', p: 'p3', voided: true },
    { t: 'yellow', p: null },              // unattributed: on the report, not the board
    { t: 'red', p: 'p2' },
    { t: 'goal', p: 'p1' },
  ];
  const y = M.yellowCardBoard(evts, PLAYERS);
  eq(y.map(x => x.item.id), ['p1', 'p2'], 'yellow order');
  eq(y.map(x => x.score), [2, 1], 'yellow counts');
  const r = M.redCardBoard(evts, PLAYERS);
  eq(r.map(x => x.item.id), ['p2'], 'red board');
  eq(r.map(x => x.score), [1], 'red count');
});

test('card boards are empty when nobody has been booked', () => {
  eq(M.yellowCardBoard([], PLAYERS), [], 'no yellows');
  eq(M.redCardBoard([{ t: 'goal', p: 'p1' }], PLAYERS), [], 'no reds');
});

/* ── team boards ─────────────────────────────────────────── */
/* Ashford keep two clean sheets, Bexley one, Croydon none. The fourth match
   is a forfeit: a result, but nobody kept anything out, so it must not earn
   Dover a clean sheet even though the awarded score reads 3-0. */
const TT_MATCHES = [
  { home: 'a', away: 'b', hs: 1, as: 0, status: 'full_time' },
  { home: 'a', away: 'c', hs: 2, as: 0, status: 'full_time' },
  { home: 'b', away: 'c', hs: 3, as: 0, status: 'full_time' },
  { home: 'd', away: 'c', hs: 3, as: 0, status: 'full_time', ff: 'away' },
  { home: 'a', away: 'd', hs: 5, as: 5, status: 'scheduled' },   // not played
];

test('cleanSheetsBoard counts full-time shut-outs, most first', () => {
  const r = M.cleanSheetsBoard(GTEAMS, TT_MATCHES);
  // Ashford 2, Bexley 1, then Croydon and Dover level on 0 — tie-broken by
  // city, so Croydon precedes Dover and both are third.
  eq(r.map(x => x.item.team.id), ['a', 'b', 'c', 'd'], 'order');
  eq(r.map(x => x.score), [2, 1, 0, 0], 'clean sheets');
  eq(places(r), [1, 2, 3, 3], 'places');
});

test('cleanSheetsBoard does not award a forfeit as a clean sheet', () => {
  const r = M.cleanSheetsBoard(GTEAMS, TT_MATCHES);
  const dover = r.find(x => x.item.team.id === 'd');
  eq(dover.score, 0, 'Dover won 3-0 by forfeit and kept nothing out');
  // the same fixture played out properly would count
  const played = TT_MATCHES.map(m => (m.ff ? { ...m, ff: null } : m));
  eq(M.cleanSheetsBoard(GTEAMS, played).find(x => x.item.team.id === 'd').score, 1, 'played out');
});

test('cleanSheetsBoard ignores matches that have not started', () => {
  const r = M.cleanSheetsBoard(GTEAMS, TT_MATCHES);
  eq(r.some(x => x.item.team.id === 'd' && x.item.played > 1), false, 'scheduled match not counted');
});

test('goalsScoredBoard ranks most scored first and agrees with conceded', () => {
  const s = M.goalsScoredBoard(GTEAMS, TT_MATCHES);
  const c = M.goalsConcededBoard(GTEAMS, TT_MATCHES);
  const total = (b, k) => b.reduce((t, r) => t + r.item[k], 0);
  eq(total(s, 'for'), total(c, 'against'), 'every goal scored is a goal conceded');
  // Ashford, Bexley and Dover all on 3, Croydon on none
  eq(s.map(x => x.item.team.id), ['a', 'b', 'd', 'c'], 'order');
  eq(s.map(x => x.score), [3, 3, 3, 0], 'goals scored');
  eq(places(s), [1, 1, 1, 4], 'a three-way joint first is followed by fourth');
});

test('goalsConcededBoard is the golden glove board under another name', () => {
  eq(M.goalsConcededBoard, M.goldenGloveBoard, 'same function, so they cannot disagree');
});

/* ── different goalscorers ───────────────────────────────── */
const DS_TEAMS = [
  { id: 'stm', city: 'Kensington' }, { id: 'cro', city: 'Croydon' },
  { id: 'bri', city: 'Brighton' },   { id: 'gg',  city: 'Golders Green' },
];
const DS_EVENTS = [
  { t: 'goal', p: 'p1' }, { t: 'goal', p: 'p1' }, { t: 'goal', p: 'p1' },  // one man, three goals
  { t: 'goal', p: 'p2' }, { t: 'goal', p: 'p3' },                          // two clubs, one each
  { t: 'goal', p: 'p4' },
  { t: 'goal', p: 'p2', voided: true },
  { t: 'goal', p: null },                       // no name: cannot be distinct from anyone
  { t: 'own_goal', p: 'p4' },                   // credited to the other side, nobody's goal
  { t: 'yellow', p: 'p1' },
];

test('distinctScorersBoard counts players, not goals', () => {
  const r = M.distinctScorersBoard(DS_TEAMS, DS_EVENTS, PLAYERS);
  const n = Object.fromEntries(r.map(x => [x.item.team.id, x.score]));
  eq(n.stm, 1, 'Kensington: three goals from one player is one scorer');
  eq(n.cro, 1, 'Croydon');
  eq(n.bri, 1, 'Brighton');
  eq(n.gg, 1, 'Golders Green');
});

test('distinctScorersBoard excludes own goals and unattributed goals', () => {
  const only = M.distinctScorersBoard(DS_TEAMS,
    [{ t: 'own_goal', p: 'p1' }, { t: 'goal', p: null }], PLAYERS);
  eq(only, [], 'neither creates a scorer');
});

test('distinctScorersBoard ranks more scorers higher and omits clubs with none', () => {
  const evts = [
    { t: 'goal', p: 'p1' },                       // stm: 1
    { t: 'goal', p: 'p2' }, { t: 'goal', p: 'p3' } // cro, bri: 1 each
  ];
  const r = M.distinctScorersBoard(DS_TEAMS, evts, PLAYERS);
  eq(r.length, 3, 'Golders Green absent, having no scorer');
  eq(places(r), [1, 1, 1], 'all level on one');
});

/* ── report ──────────────────────────────────────────────── */
export function summary() {
  return { total: results.length, failures, results };
}

const lines = results.map(r => (r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.ok ? '' : `\n         ${r.error}`));
const report = `${lines.join('\n')}\n\n${results.length - failures}/${results.length} passed`;

if (typeof console !== 'undefined') console.log(report);
if (failures && typeof globalThis.process !== 'undefined' && globalThis.process.exit)
  globalThis.process.exit(1);
