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

/* ── assists ──────────────────────────────────────────────
   An assist hangs off a goal and credits a different player from the one who
   scored it, so the tally must key on the assist, never on the scorer. The
   database refuses a self-assist and refuses an assist on anything but a
   goal; these cases prove the client agrees. */
const ASSISTED = [
  { t: 'goal', p: 'p1', a: 'p2' },
  { t: 'goal', p: 'p1', a: 'p2' },
  { t: 'goal', p: 'p3', a: 'p2' },
  { t: 'goal', p: 'p2', a: 'p1' },
  { t: 'goal', p: 'p4' },                          // scored, nobody assisted
  { t: 'goal', p: 'p1', a: 'p3', voided: true },   // undone, must not count
  { t: 'yellow', p: 'p1', a: 'p3' },               // not a goal, cannot assist
];

test('assistsBoard credits the assister, not the scorer', () => {
  const r = M.assistsBoard(ASSISTED, PLAYERS);
  eq(r.map(x => x.item.id), ['p2', 'p1'], 'order');
  eq(r.map(x => x.score), [3, 1], 'assist counts');
  eq(places(r), [1, 2], 'places');
});

test('assistsBoard ignores voided goals, unassisted goals and non-goals', () => {
  const r = M.assistsBoard(ASSISTED, PLAYERS);
  eq(r.find(x => x.item.id === 'p3'), undefined, 'p3 only assisted a voided goal and a card');
  eq(r.reduce((n, x) => n + x.score, 0), 4, 'four assists counted in total');
});

test('assistsBoard leaves the goalscorer board untouched', () => {
  const goals = M.goldenBootBoard(ASSISTED, PLAYERS);
  // p2, p3 and p4 are level on one goal, so they order by name:
  // Abanoub Adel (p3), Andrew Ramzy (p2), Kirollos Y (p4).
  eq(goals.map(x => x.item.id), ['p1', 'p3', 'p2', 'p4'], 'scorers ranked on goals');
  eq(goals.map(x => x.score), [2, 1, 1, 1], 'an assist is never a goal');
  eq(places(goals), [1, 2, 2, 2], 'three joint second');
});

test('assistsBoard with nothing assisted is empty', () => {
  eq(M.assistsBoard([{ t: 'goal', p: 'p1' }], PLAYERS).length, 0, 'no rows');
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

/* ── topRows: what a preview card shows ──────────────────── */
test('topRows takes three rows, not three places', () => {
  // four level on 5, then one on 2: the card shows three of the four
  const b = M.rankRows([{ n: 5 }, { n: 5 }, { n: 5 }, { n: 5 }, { n: 2 }], n);
  const t = M.topRows(b, 3);
  eq(t.length, 3, 'exactly three rows');
  eq(t.map(x => x.place), [1, 1, 1], 'all three are joint first');
  eq(b.length, 5, 'the full board still holds everyone');
});

test('topRows keeps the board order, so a card matches the board it previews', () => {
  const rows = [{ k: 'Zoe', n: 2 }, { k: 'Adam', n: 2 }, { k: 'Mina', n: 5 }, { k: 'Bea', n: 1 }];
  const b = M.rankRows(rows, n, { tieBreak: (a, c) => a.k.localeCompare(c.k) });
  eq(M.topRows(b, 3).map(x => x.item.k), ['Mina', 'Adam', 'Zoe'], 'same order as the board');
  eq(M.topRows(b, 3).map(x => x.item.k), b.slice(0, 3).map(x => x.item.k), 'identical to the head');
});

test('topRows shows what exists on a short board', () => {
  const b = M.rankRows([{ n: 3 }, { n: 1 }], n);
  eq(M.topRows(b, 3).length, 2, 'two rows, not padded');
  eq(M.topRows(M.rankRows([{ n: 9 }], n), 3).length, 1, 'one row');
});

test('topRows on an empty or missing board is empty, not an error', () => {
  eq(M.topRows([], 3), [], 'empty board');
  eq(M.topRows(undefined, 3), [], 'no board at all');
});

test('topRows defaults to three and honours a different n', () => {
  const b = M.rankRows([{ n: 5 }, { n: 4 }, { n: 3 }, { n: 2 }], n);
  eq(M.topRows(b).length, 3, 'default');
  eq(M.topRows(b, 1).map(x => x.score), [5], 'just the leader');
  eq(M.topRows(b, 99).length, 4, 'never invents rows');
});

test('topRows off a real board previews the same leaders it reports', () => {
  const b = M.goldenBootBoard(GOALS, PLAYERS);
  const t = M.topRows(b, 3);
  eq(t.map(x => x.item.id), ['p1', 'p3', 'p2'], 'three of the four scorers');
  eq(t.map(x => x.place), [1, 2, 2], 'places carried through');
  eq(t[0].item.id, M.leaders(b)[0].item.id, 'the card leader is the board leader');
});

/* ── the archive trophy cabinet ───────────────────────────
   A club's record has to hold three shapes at once: the same club winning one
   year and losing the final the next, a club with nothing but appearances,
   and a B team whose results must never be folded into its parent's. */
const CAB_EDITIONS = [
  { id: 'c24', competition: 'COFTA', year: 2024, champion_team_id: 'bri', runner_up_team_id: 'ste' },
  { id: 'c23', competition: 'COFTA', year: 2023, champion_team_id: 'ste', runner_up_team_id: 'bri' },
  { id: 'a26', competition: 'The Ark Cup', year: 2026, champion_team_id: 'smpk', runner_up_team_id: 'ste' },
  { id: 'c22', competition: 'COFTA', year: 2022, champion_team_id: 'bri', runner_up_team_id: 'cro' },
];
const CAB_ENTRANTS = [
  { edition_id: 'c24', team_id: 'ste' }, { edition_id: 'c23', team_id: 'ste' },
  { edition_id: 'a26', team_id: 'ste' }, { edition_id: 'c22', team_id: 'ste' },
  { edition_id: 'c24', team_id: 'wor' }, { edition_id: 'c23', team_id: 'wor' },
  { edition_id: 'a26', team_id: 'pksm' }, { edition_id: 'a26', team_id: 'smpk' },
];
const CAB_AWARDS = [
  { edition_id: 'c24', award_type: 'top_scorer', team_id: 'ste', player_name: 'A Tiwari', value: 5 },
  { edition_id: 'a26', award_type: 'player_of_the_tournament', team_id: 'smpk', player_name: 'Naty Musie' },
  { edition_id: 'a26', award_type: 'top_scorer', team_id: 'pksm', player_name: 'A B-teamer' },
  { edition_id: 'c23', award_type: 'WOTM', team_id: 'ste', player_name: 'Not a trophy' },
  { edition_id: 'c24', award_type: 'top_scorer', team_id: 'ste', player_name: 'Published table',
    is_published_summary: true },
];
const CAB_BOARDS = [
  { edition_id: 'c22', board_type: 'clean_sheets', rank: 1, team_id: 'ste', value: 4 },
  { edition_id: 'c24', board_type: 'goalscorer', rank: 1, team_id: 'ste', player_name: 'A Tiwari' },
  { edition_id: 'c22', board_type: 'goalscorer', rank: 3, team_id: 'ste', player_name: 'Not a leader' },
];
const cab = (id) => M.trophyCabinet(id, {
  editions: CAB_EDITIONS, entrants: CAB_ENTRANTS, awards: CAB_AWARDS, boards: CAB_BOARDS });

test('trophyCabinet holds a club that both won and lost finals', () => {
  const r = cab('ste');
  eq(r.finals.map(f => [f.edition.id, f.result]),
     [['a26', 'runner_up'], ['c24', 'runner_up'], ['c23', 'champion']], 'newest first');
});

test('trophyCabinet lists a club with no trophies but an entrant history', () => {
  const r = cab('wor');
  eq(r.finals.length, 0, 'never reached a final');
  eq(r.honours.length, 0, 'no honours');
  eq(r.alsoCompeted.map(e => e.id), ['c24', 'c23'], 'still competed, newest first');
  eq(r.entered, 2, 'entered two editions');
});

test('trophyCabinet counts a B team separately from its parent', () => {
  const b = cab('pksm'), parent = cab('smpk');
  eq(b.finals.length, 0, 'the B team reached no final');
  eq(b.honours.map(h => h.player), ['A B-teamer'], 'its own honour only');
  eq(parent.finals.map(f => f.result), ['champion'], 'the parent won it');
  eq(parent.honours.map(h => h.player), ['Naty Musie'], 'the parent keeps its own honour');
});

test('trophyCabinet maps archive award types onto the three trophies', () => {
  const r = cab('ste');
  const c24 = r.honours.find(h => h.editionId === 'c24');
  eq(c24.trophy, 'golden_boot', 'top scorer is the golden boot');
  eq(c24.source, 'award', 'it was awarded, not merely led');
  eq(r.honours.some(h => h.player === 'Not a trophy'), false, 'WOTM is not one of the three');
});

test('trophyCabinet never counts the flagged published table as an honour', () => {
  const r = cab('ste');
  eq(r.honours.filter(h => h.editionId === 'c24').length, 1, 'one honour, not two');
  eq(r.honours.some(h => h.player === 'Published table'), false, 'the flagged summary is skipped');
});

test('trophyCabinet separates topping a board from winning a trophy', () => {
  const r = cab('ste');
  const c22 = r.honours.find(h => h.editionId === 'c22');
  eq(c22.trophy, 'golden_glove', 'most clean sheets stands in for the golden glove');
  eq(c22.source, 'board', 'marked as led, not awarded');
  eq(r.honours.some(h => h.player === 'Not a leader'), false, 'rank 3 is not an honour');
});

test('trophyCabinet on an unknown club is empty rather than throwing', () => {
  const r = M.trophyCabinet(null, {});
  eq([r.finals.length, r.honours.length, r.alsoCompeted.length], [0, 0, 0], 'all empty');
});

/* ── a church that fields both sides ──────────────────────
   SMPK won the Ark Cup (men) and COSA (women). One church, one archive row,
   two records — and pooling them into a single trophy count is not a record
   either side would recognise. This is the regression test for that bug. */
const BOTH_EDITIONS = [
  { id: 'ark26',  competition: 'The Ark Cup',  year: 2026, category: 'men',
    champion_team_id: 'smpk', runner_up_team_id: 'ste' },
  { id: 'cosa26', competition: 'COSA',         year: 2026, category: 'women',
    champion_team_id: 'smpk', runner_up_team_id: 'gg' },
  { id: 'lc25',   competition: 'Ladies COFTA', year: 2025, category: 'women',
    champion_team_id: 'stm',  runner_up_team_id: 'smpk' },
  { id: 'cofta24',competition: 'COFTA',        year: 2024, category: 'men',
    champion_team_id: 'bri',  runner_up_team_id: 'smpk' },
];
const BOTH_ENTRANTS = [
  { edition_id: 'ark26', team_id: 'smpk' }, { edition_id: 'cosa26', team_id: 'smpk' },
  { edition_id: 'lc25',  team_id: 'smpk' }, { edition_id: 'cofta24', team_id: 'smpk' },
];
const BOTH_AWARDS = [
  { edition_id: 'ark26',  award_type: 'top_scorer', team_id: 'smpk', player_name: 'A man' },
  { edition_id: 'cosa26', award_type: 'top_scorer', team_id: 'smpk', player_name: 'A woman' },
];
const bothCab = (cat) => M.trophyCabinet('smpk', {
  editions: BOTH_EDITIONS, entrants: BOTH_ENTRANTS, awards: BOTH_AWARDS, boards: [],
  category: cat });

test('trophyCabinet scoped to men returns only men’s editions', () => {
  const r = bothCab('men');
  eq(r.finals.map(f => f.edition.id), ['ark26', 'cofta24'], 'men only');
  eq(r.finals.map(f => f.result), ['champion', 'runner_up'], 'won one, lost one');
  eq(r.honours.map(h => h.player), ['A man'], 'the women’s honour is not counted');
  eq(r.entered, 2, 'entered two men’s editions');
});

test('trophyCabinet scoped to women returns only women’s editions', () => {
  const r = bothCab('women');
  eq(r.finals.map(f => f.edition.id), ['cosa26', 'lc25'], 'women only');
  eq(r.honours.map(h => h.player), ['A woman'], 'the men’s honour is not counted');
  eq(r.entered, 2, 'entered two women’s editions');
});

test('trophyCabinet never returns a combined count for a club fielding both', () => {
  const men = bothCab('men'), women = bothCab('women'), all = bothCab(null);
  eq(men.finals.length, 2, 'men: two finals');
  eq(women.finals.length, 2, 'women: two finals');
  eq(all.finals.length, 4, 'unscoped would have pooled all four — the bug');
  eq(men.finals.some(f => f.edition.category === 'women'), false, 'no women in the men’s cabinet');
  eq(women.finals.some(f => f.edition.category === 'men'), false, 'no men in the women’s cabinet');
  eq(men.entered + women.entered, all.entered, 'the two halves account for the whole');
});

test('trophyCabinet keeps alsoCompeted inside the category too', () => {
  const eds = [...BOTH_EDITIONS,
    { id: 'costa25', competition: 'COSTA', year: 2025, category: 'men',
      champion_team_id: 'bri', runner_up_team_id: 'cro' }];
  const ents = [...BOTH_ENTRANTS, { edition_id: 'costa25', team_id: 'smpk' }];
  const men = M.trophyCabinet('smpk', { editions: eds, entrants: ents, category: 'men' });
  const women = M.trophyCabinet('smpk', { editions: eds, entrants: ents, category: 'women' });
  eq(men.alsoCompeted.map(e => e.id), ['costa25'], 'the men’s also-ran shows on the men’s side');
  eq(women.alsoCompeted.length, 0, 'and never on the women’s');
});

/* ── a competition's roll of honour ───────────────────────
   Who has won it, when, and how many times. Editions arrive in whatever
   order the caller had them, so the ordering must come from the function. */
const ROLL = [
  { id: 'c22', year: 2022, champion_team_id: 'bri' },
  { id: 'c23', year: 2023, champion_team_id: 'notts' },
  { id: 'c24', year: 2024, champion_team_id: 'bri' },
  { id: 'c25', year: 2025, champion_team_id: 'bri' },
  { id: 'c26', year: 2026, champion_team_id: 'ste' },
  { id: 'c21', year: 2021, champion_team_id: null },   // played, champion unrecorded
];

test('rollOfHonour counts titles and lists the years, most titles first', () => {
  const r = M.rollOfHonour(ROLL);
  eq(r.map(x => x.teamId), ['bri', 'ste', 'notts'], 'order');
  eq(r.map(x => x.titles), [3, 1, 1], 'title counts');
  eq(r[0].years, [2025, 2024, 2022], 'years newest first');
});

test('rollOfHonour breaks a tie on the most recent title', () => {
  const r = M.rollOfHonour(ROLL);
  const [ste, notts] = [r[1], r[2]];
  eq([ste.teamId, ste.years[0]], ['ste', 2026], 'the more recent winner leads');
  eq([notts.teamId, notts.years[0]], ['notts', 2023], 'the older one follows');
});

test('rollOfHonour ignores an edition whose champion was never recorded', () => {
  const r = M.rollOfHonour(ROLL);
  eq(r.reduce((n, x) => n + x.titles, 0), 5, 'five recorded champions, not six');
  eq(r.some(x => x.teamId == null), false, 'no null row');
});

test('rollOfHonour on a competition nobody has won yet is empty', () => {
  eq(M.rollOfHonour([{ id: 'x', year: 2026, champion_team_id: null }]).length, 0, 'empty');
  eq(M.rollOfHonour([]).length, 0, 'empty');
  eq(M.rollOfHonour().length, 0, 'empty');
});

test('reigningChampion is the winner of the most recent edition', () => {
  const r = M.reigningChampion(ROLL);
  eq([r.teamId, r.year], ['ste', 2026], 'Stevenage hold it');
});

test('reigningChampion skips a recent edition with no recorded champion', () => {
  const r = M.reigningChampion([...ROLL, { id: 'c27', year: 2027, champion_team_id: null }]);
  eq([r.teamId, r.year], ['ste', 2026], 'the last club actually recorded as winning');
});

test('reigningChampion of an unwon competition is null', () => {
  eq(M.reigningChampion([{ id: 'x', year: 2026, champion_team_id: null }]), null, 'null');
  eq(M.reigningChampion([]), null, 'null');
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
