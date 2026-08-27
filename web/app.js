/**
 * COFTA 2026 — application
 *
 * Spectators poll snapshot() every few seconds. The clock is derived locally
 * from timestamps, so it ticks smoothly at 60fps between polls and never
 * lags. Admins get the same views plus the write controls.
 */
import { CREST } from './crests.js?b=cofta-v98';
import * as api from './api.js?b=cofta-v98';
import * as M from './model.js?b=cofta-v98';
import { WriteQueue } from './queue.js?b=cofta-v98';

/** This build, read off our own module URL so it can never disagree with it. */
const BUILD = new URL(import.meta.url).searchParams.get('b') ?? 'dev';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const POLL_MS = 5000;

/* ── appearance ──────────────────────────────────────────── */
const THEMES = [
  ['matchday',  'Matchday'],
  ['',          'Programme'],
  ['broadcast', 'Broadcast'],
  ['terrace',   'Terrace'],
  ['swiss',     'Swiss'],
];
const THEME_COLOURS = { '': '#f6f1e7', matchday: '#eef0f3', broadcast: '#17191d',
                        terrace: '#f3ebda', swiss: '#ffffff' };
// Matchday is the default. A stored choice — including an explicit
// Programme ('') — always wins; only first-time devices get the default.
let theme = 'matchday';
try {
  const stored = localStorage.getItem('cofta.theme');
  if (stored !== null) theme = stored;
} catch {}

function applyTheme(v) {
  theme = v;
  try { localStorage.setItem('cofta.theme', v); } catch {}
  try {
    const root = document.documentElement;
    if (v) root.setAttribute('data-theme', v);
    else root.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOURS[v] ?? THEME_COLOURS['']);
  } catch { /* stub environments */ }
}

const state = {
  snap: null, teams: {}, matches: [], events: [], slots: {}, players: [], ties: [],
  trophies: {},        // confirmed winners, { trophy: [playerId, ...] }
  schedule: [],        // Vespers, Liturgy - timetable items that are not matches
  views: 0,            // page changes this session, for the install offer
  installEarned: false,// opening a match is engagement enough on its own
  push: null,          // { supported, permission, subscribed, endpoint } - read from the browser
  picker: null,        // { type, side } while an organiser chooses a player
  view: 'fixtures', day: 1, dayPinned: false, matchId: null, from: 'fixtures',
  sq: { team: null, player: null },
  award: null,         // which leaderboard is open, while view === 'award'
  hist: [],            // pages to come back to, newest last
  admin: false, role: null, roleVerified: false, squadTeam: null, editor: null,
  assistFor: null,   // a goal whose assist is being picked; applies on tap, no Save
  lastFetch: 0, error: null, busy: false, pens: null,
  tiePens: {},
  trophyPick: null,    // the organiser's working set, before confirming
  trophyTeam: null,    // which club's squad each trophy picker is showing

  // History. The archive is fetched on demand, never polled, and cached hard.
  // histCat resets to 'men' every time History is opened from the tab bar.
  archive: null, archiveEd: {}, archiveBusy: false, archiveEdBusy: null, archiveErr: null,
  // Which reads have already failed, so a failure is not retried forever.
  // See loadArchive(): the retry is driven by the user, never by render().
  archiveEdErr: {},
  histCat: 'men', histComp: null, histEd: null,
  archTeam: null,          // which club's standalone cabinet is open
  archiveHonours: null, honoursBusy: false, honoursErr: null,
  archiveRoster: null, rosterBusy: false, rosterErr: null,
  clubTab: 'squad',        // Squad or History on a live club page; never persists
  cabCat: 'men',           // which side's record a cabinet is showing
};

/** Events are queued so a tap on bad signal is never lost. The queue sends
 *  through the same RPC layer, so idempotency and auth still apply.
 *  Created AFTER `state`: subscribe fires its callback immediately, and that
 *  callback reads `state` — declaring the queue first was a TDZ crash that
 *  took the whole module down before boot() could run. */
const queue = new WriteQueue((fn, args) => api.rpc(fn, args, true));
let queueState = { depth: 0, failing: false };
queue.subscribe(s => { queueState = s; if (state.snap) render(); });

/* ── where "back" goes ───────────────────────────────────── */
/**
 * A club or player page can be opened from a fixture, a match report, a
 * table, a leaderboard or another player's card — so any single fixed back
 * target was always going to be wrong somewhere, and it was: every back
 * button led to the Squads root regardless of the way in.
 *
 * Forward navigation pushes the page it is leaving; a back button pops it.
 * The cap is high enough that no one reaches it by tapping around and low
 * enough that the stack cannot grow all weekend. With an empty stack the
 * back buttons fall back to exactly what they did before, so the first tap
 * of a fresh session still behaves.
 *
 * Matches are deliberately left out: `state.from` already returns them to
 * the tab they were opened from, and fixture rows only exist on those two
 * tabs. A match opened from Fixtures still goes back to Fixtures.
 */
const HIST_MAX = 20;

const here = () => ({
  view: state.view, matchId: state.matchId, from: state.from,
  day: state.day, award: state.award, sq: { ...state.sq },
  histComp: state.histComp, histEd: state.histEd, histCat: state.histCat,
  archTeam: state.archTeam, clubTab: state.clubTab, cabCat: state.cabCat,
});

const samePage = (a, b) =>
  a.view === b.view && a.matchId === b.matchId && a.award === b.award
  && a.sq.team === b.sq.team && a.sq.player === b.sq.player
  && a.histComp === b.histComp && a.histEd === b.histEd
  && a.archTeam === b.archTeam;

/** Move to another page, remembering the one being left — unless the tap
 *  lands on the page already showing, which must not stack a duplicate. */
function navigate(mutate) {
  const before = here();
  mutate();
  state.picker = null; state.editor = null;
  if (samePage(before, here())) return;
  state.hist.push(before);
  if (state.hist.length > HIST_MAX) state.hist.shift();
}

/** Step back one page. Returns false when there is nothing to go back to,
 *  leaving the caller to use its own fallback destination. */
function popHist() {
  const prev = state.hist.pop();
  if (!prev) return false;
  state.view = prev.view; state.matchId = prev.matchId; state.from = prev.from;
  state.day = prev.day; state.award = prev.award; state.sq = { ...prev.sq };
  state.histComp = prev.histComp; state.histEd = prev.histEd;
  state.archTeam = prev.archTeam;
  state.clubTab = prev.clubTab ?? 'squad';
  state.cabCat = prev.cabCat ?? 'men';
  if (prev.histCat) state.histCat = prev.histCat;
  state.picker = null; state.editor = null;
  return true;
}

/* ── data ────────────────────────────────────────────────── */
function applySnap(snap) {
  state.snap = snap;
  state.teams = Object.fromEntries((snap.teams || []).map(t => [t.id, t]));
  state.matches = snap.matches || [];
  state.events = snap.events || [];
  state.players = snap.players || [];
  state.slots = snap.slots || {};
  state.ties = snap.ties || [];
  // Non-match timetable items. Absent from a snapshot cached by an older
  // build, so it degrades to an empty list rather than throwing.
  state.schedule = snap.schedule || [];
  // A snapshot cached by a build that predates trophies simply has no key.
  state.trophies = M.confirmedTrophies(snap);

  // Once both groups are done, Sunday is the day worth opening on — Saturday
  // is finished and nobody arriving wants yesterday's results first. A reader
  // who has picked a day for themselves keeps it.
  //
  // Symmetric on purpose: a phone boots from its cached snapshot before the
  // first poll lands, so an organiser who has just run reset_tournament()
  // would otherwise open on Sunday off yesterday's cache and stay there,
  // because nothing would ever move the day back.
  if (!state.dayPinned) state.day = M.groupStageComplete(state.matches) ? 2 : 1;
}

/**
 * Settle the role against the server once the network is back.
 *
 * A role adopted from cache is a guess, and a guess has to be checked. This
 * runs after the first poll that succeeds, and again on any `online` event,
 * where `force` re-asks even if we already believed ourselves verified —
 * that transition is the moment a revocation would land.
 *
 * Downgrades are silent and immediate; the controls simply stop being there.
 */
async function reverifyRole(force = false) {
  if (!api.isSignedIn()) return;
  if (state.roleVerified && !force) return;
  try {
    const seen = await api.checkRole();
    const changed = seen.admin !== state.admin || seen.role !== state.role;
    state.admin = seen.admin;
    state.role = seen.role;
    state.roleVerified = true;
    if (changed) render();
  } catch { /* still offline — the remembered role stands until it is not */ }
}

async function poll() {
  const sent = Date.now();
  try {
    const snap = await api.fetchSnapshot();
    M.syncFromSnapshot(snap.now, sent);
    applySnap(snap);
    try { localStorage.setItem('cofta.snap.v1', JSON.stringify(snap)); } catch {}
    state.lastFetch = Date.now();
    state.error = null;
    reverifyRole();          // the network answered, so the role can be settled
  } catch (e) {
    state.error = e.message;
  }
  render();
}

const team = (id) => state.teams[id] || null;
const squadOf = (teamId) => state.players.filter(p => p.team === teamId);
const playerName = (id) => state.players.find(p => p.id === id)?.name ?? null;
const nameOf = (id) => team(id)?.name ?? 'To be confirmed';
const cityOf = (id) => team(id)?.city ?? '';
const colOf  = (id) => team(id)?.colour ?? 'transparent';
const txtOf  = (id) => team(id)?.text_colour ?? '#FFFFFF';
const crest  = (id) => CREST[id] || '';

/** Knockout ties whose teams are not yet set get filled from the tables. */
function resolvedMatches() {
  const list = state.matches.map(m => ({ ...m }));
  const teamsArr = Object.values(state.teams);
  if (!teamsArr.length) return list;
  const slots = M.resolveSlots(teamsArr, list, state.slots, state.ties);
  const put = (stage, h, a) => {
    const m = list.find(x => x.stage === stage);
    if (m && !M.hasStarted(m)) { m.home = m.home || h; m.away = m.away || a; }
  };
  put('SF1', slots.sf1_home, slots.sf1_away);
  put('SF2', slots.sf2_home, slots.sf2_away);
  put('FINAL', slots.final_home, slots.final_away);
  return list.sort(M.fixtureOrder);
}

const currentMatch = () => resolvedMatches().find(m => m.id === state.matchId);

/* ── shared bits ─────────────────────────────────────────── */
function clubBlock(id, cls = '', score = null, reds = 0, pens = null) {
  // Penalties ride alongside the score, in brackets, the way a results list
  // has always written them: 1 (3). Hidden with .ssc in the themes that show
  // a combined score on the right instead, where statusLabel already says
  // "3–2 on pens" in full.
  const pen = pens ? `<i class="spen ${pens.won ? 'won' : ''}">(${pens.n})</i>` : '';
  const sc = score != null ? `<span class="ssc tnum">${score}${pen}</span>` : '';
  const rc = '<i class="rc"></i>'.repeat(reds);
  if (!id) return `<span class="side tbc ${cls}" style="--c:var(--line2)">
    <span class="who"><b>To be confirmed</b></span>${sc}</span>`;
  return `<span class="side ${cls}" style="--c:${colOf(id)};--tc:${txtOf(id)}">
    <span class="tile" style="--c:${colOf(id)}"><img src="${crest(id)}" alt=""></span>
    <span class="who"><b>${esc(nameOf(id))}</b><i>${esc(cityOf(id))}</i>${reds ? `<span class="rcs">${rc}</span>` : ''}</span>${sc}</span>`;
}

/* ── fixtures ────────────────────────────────────────────── */
const redsFor = (m, side) =>
  state.events.filter(e => e.m === m.id && e.t === 'red' && e.s === side).length;

function fixtureRow(m) {
  const started = M.hasStarted(m) || m.ff;
  let score, sub;
  if (!started) {
    score = '<span class="pend">v</span>';
    sub = `<span class="st">${esc(m.kickoff)}</span>`;
  } else {
    score = `${m.hs}\u2013${m.as}`;
    const live = M.isLive(m);
    sub = `<span class="st ${live ? 'live' : ''}">${esc(M.statusLabel(m))}</span>`;
  }
  let tst = '', tstLive = false;
  if (m.ff) tst = 'FF';
  else if (M.isLive(m)) { tst = `${M.minuteLabel(m)}\u2032`; tstLive = true; }
  else if (m.status === 'half_time') tst = 'HT';
  // The shoot-out used to be a second line here, 9.5px wide in a 52px column
  // that the eye never reaches. It now sits beside the scores instead.
  else if (m.status === 'full_time') tst = 'FT';

  const pens = (sideKey) => m.pd
    ? { n:   sideKey === 'home' ? m.ph : m.pa,
        won: sideKey === 'home' ? m.ph > m.pa : m.pa > m.ph }
    : null;

  return `<button class="fx ${started ? 'started' : 'sched'}" data-match="${m.id}">
    <span class="t"><b>${esc(m.kickoff)}</b>${esc(M.stageLabel(m))}
      ${tst ? `<span class="tst ${tstLive ? 'live' : ''} tnum">${tst}</span>` : ''}</span>
    <span class="n">${clubBlock(m.home, '', started ? m.hs : null, redsFor(m, 'home'), pens('home'))}${clubBlock(m.away, '', started ? m.as : null, redsFor(m, 'away'), pens('away'))}</span>
    <span class="r tnum"><span class="rsc">${score}</span>${sub}</span></button>`;
}

const PHASE_LABEL = { group: 'Group matches', semi: 'Semi-finals', final: 'Final' };
const phaseOf = (m) => m.stage === 'FINAL' ? 'final' : M.isKnockout(m) ? 'semi' : 'group';

/**
 * A timetable item that is not a match: Vespers, Liturgy. Rendered in the
 * fixtures list at its own time, because that is where a player looks to find
 * out where to be — but deliberately NOT a fixture row. No crests, no score,
 * no tap target, no clock. It is a different kind of thing and it should not
 * be possible to mistake one for a game that has not kicked off.
 */
function scheduleRow(s) {
  return `<div class="schrow">
    <span class="t"><b>${esc(s.at)}</b></span>
    <span class="n"><b>${esc(s.title)}</b>
      ${s.where ? `<i>${esc(s.where)}</i>` : ''}
      ${s.detail ? `<span>${esc(s.detail)}</span>` : ''}</span>
  </div>`;
}

function viewFixtures() {
  const all = resolvedMatches().filter(m => m.day === state.day);
  const sched = (state.schedule || []).filter(s => s.day === state.day);

  // Sunday runs two semi-finals and then the final, and a flat list gave the
  // final no more weight than an 11:00 group game. Headings appear only where
  // a day actually holds more than one phase, so Saturday's twelve group
  // matches stay one uninterrupted list.
  const mixed = new Set(all.map(phaseOf)).size > 1;
  let last = null;
  let rows = all.map(m => {
    const p = phaseOf(m);
    const head = mixed && p !== last
      ? `<div class="sect ${p === 'final' ? 'crown' : ''}">${PHASE_LABEL[p]}</div>` : '';
    last = p;
    return { at: m.kickoff, html: head + fixtureRow(m) };
  });

  // Merged by time, not appended. Liturgy at 09:30 belongs above Sunday's
  // 14:00 semi-final; Vespers at 17:30 belongs after Saturday's last game.
  // A stable sort keeps the phase headings attached to the match they head.
  rows = rows.concat(sched.map(s => ({ at: s.at, html: scheduleRow(s) })))
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.i - b.i)
    .map(r => r.html).join('');

  return `<div class="daysel">
      <button data-day="1" class="${state.day === 1 ? 'on' : ''}">Sat 12 Sept</button>
      <button data-day="2" class="${state.day === 2 ? 'on' : ''}">Sun 13 Sept</button>
    </div>
    ${rows || '<p class="empty">No fixtures for this day.</p>'}`;
}

/* ── live now ────────────────────────────────────────────── */
function viewLive() {
  const inPlay = resolvedMatches().filter(m =>
    M.isLive(m) || m.status === 'half_time');
  if (!inPlay.length) return `<div class="sect">Live now</div>
    <p class="empty">No matches in play right now. Everything kicks off from the
      Fixtures tab \u2014 live games appear here the moment a clock starts.</p>`;
  return `<div class="sect">Live now</div>
    ${inPlay.map(fixtureRow).join('')}
    <p class="note">Scores update every few seconds. Tap a match for the clock
      and the full report.</p>`;
}

/* ── match ───────────────────────────────────────────────── */
function viewMatch() {
  const m = currentMatch();
  if (!m) return '<p class="empty">Match not found.</p>';

  // A forfeit counts as started: it has a 3–0 result to show and no clock.
  const started = M.hasStarted(m) || !!m.ff;
  const scheduled = !started;

  const lead = (a, b) => a > b ? 'lead' : '';
  const pendingGoals = (sideKey) => queue.pendingFor(m.id)
    .filter(w => w.args.p_type === 'goal' && w.args.p_side === sideKey).length;
  const hs = m.hs + pendingGoals('home');
  const as = m.as + pendingGoals('away');

  // Scorers under each score, FotMob-style: confirmed events plus anything
  // still in the queue, so a goal tapped offline shows its minute at once.
  const pendingEvts = queue.pendingFor(m.id)
    .filter(w => w.args.p_type === 'goal' || w.args.p_type === 'own_goal')
    .map(w => ({ m: m.id, t: w.args.p_type, s: w.args.p_side,
                 p: w.args.p_player, min: w.args.p_minute, voided: false }));
  const allEvts = [...state.events, ...pendingEvts];
  const lines = (sideKey) => M.scorerLines(allEvts, m.id, sideKey, playerName)
    .map(l => `<i class="gline" ${l.pid ? `data-player="${l.pid}"` : ''}>${l.name ? esc(l.name) + ' ' : ''}${l.mins.map(esc).join(', ')}${l.og ? ' (OG)' : ''}</i>`)
    .join('');

  /**
   * A club block on the header opens that club's squad, so where there is a
   * club it is a real <button>: a div carrying a click handler cannot be
   * reached by keyboard at all and announces nothing when it is. The crest
   * stays alt="" because the club's name sits right beside it — giving the
   * image the name too would just have every screen reader say it twice.
   * A knockout slot still to be confirmed has nothing to open, so it stays
   * an inert div rather than a focusable button that does nothing.
   */
  const side = (id, score, other, sideKey) => {
    const attrs = `class="sl ${lead(score, other)}" style="--c:${colOf(id)};--tc:${txtOf(id)}"`;
    // Nobody has scored yet, so nothing should say 0. The cell is omitted
    // rather than blanked: a blank one still sat at the bottom of the column
    // and pushed the crest and name above centre. The height it would have
    // occupied is given back as symmetric padding in themes.css, so the card
    // is the same size before kick-off as after it and the content is centred
    // rather than hanging off the top.
    const scoreCell = started ? `<span class="gl tnum">${score}</span>` : '';
    const inner = `
      ${id ? `<span class="bdg"><img src="${crest(id)}" alt=""></span>` : '<span class="bdg"></span>'}
      <span class="who"><b>${esc(nameOf(id))}</b><i>${esc(cityOf(id))}</i></span>
      ${scoreCell}
      ${started && lines(sideKey) ? `<span class="gls">${lines(sideKey)}</span>` : ''}`;
    return id ? `<button ${attrs} data-team="${id}">${inner}</button>`
              : `<div ${attrs}>${inner}</div>`;
  };

  let clock, phase;
  if (scheduled) { clock = '<div class="m idle">\u2014\u2014</div>'; phase = 'Awaiting kick-off'; }
  else if (m.status === 'half_time') { clock = '<div class="m idle">HT</div>'; phase = 'Half time'; }
  else if (m.status === 'full_time' || m.ff) { clock = '<div class="m idle">FT</div>'; phase = m.ff ? 'Forfeit' : 'Full time'; }
  else {
    clock = `<div class="m"><span id="mmin" class="tnum">${M.minuteLabel(m)}</span>\u2032</div>`;
    phase = (m.status === 'first_half' ? 'First half' : 'Second half') + (m.run ? '' : ' \u00b7 stopped');
  }

  const e = M.elapsedMs(m);
  let added = '';
  // Group B plays 15-minute halves, so "added time" starts five minutes
  // earlier there than anywhere else. Per match, never the tournament default.
  const halfMs = M.halfMsFor(m);
  if (m.status === 'first_half' && e > halfMs) added = 'Into added time at the end of the first half';
  if (m.status === 'second_half' && e > 2 * halfMs) added = 'Into added time at the end of the second half';

  // Anything still queued is shown immediately, marked as unsent, so the
  // organiser sees their tap register even with no signal.
  const queued = queue.pendingFor(m.id).map(w => ({
    id: w.args.p_id, m: m.id, t: w.args.p_type, s: w.args.p_side,
    min: w.args.p_minute, pending: true,
  }));
  const evts = [...queued, ...state.events.filter(x => x.m === m.id)];
  const timeline = evts.length ? evts.map(x => `
      <li class="${x.pending ? 'pending' : ''}">
        <span class="mk tnum ${x.t === 'goal' ? 'goal' : ''}">${x.t === 'motm' ? '' : esc(x.min || '')}</span>
        <span class="tx">${eventText(x, m)}${x.pending ? ' <em>sending\u2026</em>' : ''}</span>
        ${state.admin && !x.pending
          ? `<span class="rowacts">${
             // An assist needs a goal AND a named scorer: the database rejects
             // a self-assist and has nobody to hang one on when the goal is
             // recorded without a name. Own goals never take one — there is
             // nobody to credit. Where the button cannot appear, Edit still
             // reaches the same field.
             x.t === 'goal' && x.p
               ? `<button class="undo" data-assist="${x.id}">${x.a ? 'Assist' : '+ Assist'}</button>` : ''}
             <button class="undo" data-edit="${x.id}">Edit</button>
             <button class="undo" data-void="${x.id}">Undo</button></span>`
          : '<span></span>'}
      </li>`).join('')
    : '<div class="empty">Nothing to report yet.</div>';

  return `<button class="back" data-view="${state.from}">&larr; ${state.from === 'live' ? 'Live now' : 'All fixtures'}</button>
    <div class="stack ${scheduled ? 'pre' : ''}">${side(m.home, hs, as, 'home')}${side(m.away, as, hs, 'away')}
      <span class="midchip ${M.isLive(m) ? 'live' : ''}" id="midchip">${
        m.ff ? 'FT'
        : !M.hasStarted(m) ? esc(m.kickoff)
        : m.status === 'half_time' ? 'HT'
        : m.status === 'full_time' ? 'FT'
        : M.mmss(M.elapsedMs(m))}</span></div>
    ${penStrip(m)}
    ${motmLine(m)}
    <p class="kick"><span>${m.day === 1 ? 'Sat 12' : 'Sun 13'} Sept${
        scheduled ? '' : ` &middot; ${esc(m.kickoff)}`}
      &middot; ${esc(M.stageLabel(m))} &middot; ${esc(m.pitch)}</span>
      ${M.isLive(m) && m.run ? '<span class="lv"><i></i>Live</span>' : ''}</p>
    ${scheduled
      // Before kick-off the rail said "——", "Awaiting kick-off" and 00:00:
      // three ways of saying nothing, in the loudest part of the page. One
      // muted line instead. Live, HT and FT keep the full rail.
      ? `<div class="ck pre"><span class="kox">Kick-off ${esc(m.kickoff)}</span></div>`
      : `<div class="ck">
      <div>${clock}${added ? `<div class="stop">${added}</div>` : ''}</div>
      <div class="rail"><span class="ph">${esc(phase)}</span>
        <span class="el tnum" id="mel">${M.mmss(e)}</span></div>
    </div>`}
    ${suspensionNotice(m)}
    ${state.admin ? adminMatchControls(m) : ''}
    ${scheduled && !evts.length ? ''
      : `<div class="sect">Match report</div>
    ${state.editor ? editorPanel(m) : ''}
    ${state.assistFor ? assistPanel(m) : ''}
    <ol class="tl">${timeline}</ol>`}`;
}

/**
 * A tie settled on penalties was decided by that shoot-out, so it belongs on
 * the scoreboard and not in the note underneath, where it read as a footnote
 * to a 1–1 draw. One strip across the foot of the card, naming the winner:
 * repeating "pens" under each score was noise, and two bare numbers left the
 * reader working out which belonged to whom.
 *
 * The goals stay the score, because for goal difference the match really is
 * a draw. Group matches can never reach this — set_shootout() refuses a
 * stage of A or B — so m.pd already implies a knockout tie.
 */
function penStrip(m) {
  if (!m.pd) return '';
  const winner = m.ph > m.pa ? m.home : m.away;
  const hi = Math.max(m.ph, m.pa), lo = Math.min(m.ph, m.pa);
  return `<div class="pnstrip"><b>${esc(nameOf(winner))}</b> win
    <span class="tnum">${hi}–${lo}</span> on penalties</div>`;
}

/** Who cannot play in this match, and why. Shown before kick-off so an
 *  organiser finds out in time to do something about it. */
function suspensionNotice(m) {
  if (M.hasStarted(m)) return '';
  const byId = Object.fromEntries(state.players.map(p => [p.id, p]));
  const out = M.suspendedFor(m.id, resolvedMatches(), state.events, byId);
  if (!out.length) return '';
  const rows = out.map(s => `<li><span class="nmx plink" data-player="${s.id}">${esc(s.player)}</span>
      <span class="rs">${esc(s.reason)}</span></li>`).join('');
  return `<div class="sect">Unavailable</div>
    <ul class="susp">${rows}</ul>
    <p class="note" style="padding-top:8px">Suspended for this match under the
      tournament rules.</p>`;
}

/** The award line under the scoreboard, once a man of the match exists. */
function motmLine(m) {
  const ev = state.events.find(x => x.m === m.id && x.t === 'motm');
  if (!ev) return '';
  const nm = ev.p ? playerName(ev.p) : null;
  return `<p class="motmline"><span class="mstar">\u2605</span>${nm
    ? `${esc(nm)} \u2014 Man of the Match` : 'Man of the Match awarded'}</p>`;
}

function eventText(x, m) {
  const who = x.s === 'home' ? m.home : m.away;
  const nm = x.p ? playerName(x.p) : null;
  const by = nm ? `<b class="plink" data-player="${x.p}">${esc(nm)}</b>` : null;
  // The assist rides on the match report only. The scorer lines under the
  // score stay goals-only: that column is the scoreline's own summary, and
  // two names per goal would double its height for a secondary fact.
  const an = x.t === 'goal' && x.a ? playerName(x.a) : null;
  const assist = an
    ? ` <span class="asst">assist: <button class="plink" data-player="${x.a}">${esc(an)}</button></span>`
    : '';
  switch (x.t) {
    case 'goal':     return (by ? `${by} <i>(${esc(cityOf(who))})</i>` : `<b>${esc(nameOf(who))}</b> score`) + assist;
    case 'own_goal': return `Own goal \u2014 ${by ?? `<b>${esc(nameOf(who))}</b>`}`;
    case 'yellow':   return `${by ? by + ' &mdash; ' : ''}yellow card`;
    case 'red':      return `${by ? by + ' &mdash; ' : ''}<b>sent off</b>`;
    case 'motm':     return `${by ?? 'Man of the match'} &mdash; man of the match`;
    default:         return esc(x.t);
  }
}

/**
 * Edit a recorded event: minute and player, full replace. The crediting
 * squad is the event's own side — which for an own goal is the side whose
 * player put it in, exactly who should be listed.
 */
/**
 * The assist picker, reached from a goal that is already on the report.
 *
 * NO SAVE BUTTON, on purpose, and it is the same shape as logging a goal:
 * tap a name and it is applied. That flow has never had a confirm step — the
 * goal is logged the moment the button is pressed and the scorer attaches on
 * tap — and an assist is the same kind of act. A confirm step on a one-tap
 * choice is a second tap that can only ever agree with the first.
 *
 * The Edit panel keeps its Save and should: it carries a free-text minute
 * field, and there is no sane way to apply a half-typed minute per keystroke.
 * That is the difference between the two, not a stylistic inconsistency.
 *
 * EVERY TAP HERE SENDS THE SCORER AND MINUTE BACK UNCHANGED, because
 * edit_event is a FULL REPLACE. Sending only the assist would blank both, and
 * the failure would be invisible from this screen — the row would simply lose
 * its scorer. `tests/assist_drill.html` guards exactly this.
 */
/**
 * What undoing this event actually costs, put to the organiser before it
 * happens. Returns false to abandon.
 *
 * Written per event type rather than as one general warning, because the
 * consequences are genuinely different and a warning that says nothing
 * specific is one people learn to tap through. A goal moves the score and may
 * already have buzzed several hundred phones; a card feeds the suspension
 * rules and can change who is available on Sunday.
 */
function confirmVoid(id, m) {
  const ev = state.events.find(x => x.id === id);
  if (!ev) return true;                       // nothing known to warn about
  const who = ev.p ? playerName(ev.p) : null;
  const club = nameOf(ev.s === 'home' ? m.home : m.away);

  if (ev.t === 'goal' || ev.t === 'own_goal') {
    // The scoring side loses one. Own goals are logged against the side they
    // COUNT FOR, so this is the same arithmetic either way.
    // Queued-but-unsent goals count too, exactly as the header's score does —
    // `pendingGoals` there is a closure inside matchView, so the same rule is
    // spelled out again rather than reached for.
    const pending = (sideKey) => queue.pendingFor(m.id)
      .filter(w => w.args.p_type === 'goal' && w.args.p_side === sideKey).length;
    const hs = m.hs + pending('home') - (ev.s === 'home' ? 1 : 0);
    const as = m.as + pending('away') - (ev.s === 'away' ? 1 : 0);
    const what = ev.t === 'own_goal' ? 'this own goal'
               : who ? `${who}'s goal` : `this goal for ${club}`;
    // Still in the window means the push has not left. Anything else means it
    // has, and no undo can call it back.
    const announced = !pendingGoalPush.has(id);
    return confirm(
      `Undo ${what}?\n\n`
      + `The score goes back to ${nameOf(m.home)} ${hs}–${as} ${nameOf(m.away)}.\n\n`
      + (announced
          ? 'A notification for this goal has already gone out. Undoing it here '
            + 'does NOT recall the one people have already seen.'
          : 'It has not been announced yet, so nobody will be told about it.'));
  }

  if (ev.t === 'yellow' || ev.t === 'red') {
    const card = ev.t === 'red' ? 'red card' : 'yellow card';
    return confirm(
      `Undo this ${card}${who ? ` for ${who}` : ''}?\n\n`
      + 'Suspensions are worked out from cards, so this can change who is '
      + 'available for their next match.');
  }

  if (ev.t === 'motm') {
    return confirm(`Undo man of the match${who ? ` for ${who}` : ''}?`);
  }

  return confirm('Undo this entry from the match report?');
}

function assistPanel(m) {
  const ev = state.events.find(x => x.id === state.assistFor);
  if (!ev || ev.t !== 'goal' || !ev.p) { state.assistFor = null; return ''; }
  const teamId = ev.s === 'home' ? m.home : m.away;
  // Nobody assists their own goal — the database refuses it outright.
  const squad = squadOf(teamId).filter(p => p.id !== ev.p);
  const scorer = playerName(ev.p);

  const search = squad.length > 6
    ? `<input id="pkq" type="search" placeholder="Search players" autocomplete="off"
        autocapitalize="none" spellcheck="false" style="margin-bottom:9px">` : '';

  const names = squad.length
    ? squad.map(p => `<button class="pk ${ev.a === p.id ? 'on' : ''}" data-assistpick="${p.id}">
        ${p.no != null ? `<span class="no tnum">${p.no}</span>` : '<span class="no"></span>'}
        <span>${esc(p.name)}</span></button>`).join('')
    : `<p class="note" style="padding:6px 0">No squad list for
       ${esc(cityOf(teamId))} yet.</p>`;

  return `<div class="picker">
      <div class="pkhd"><span>Who assisted ${esc(scorer)}?</span>
        <button data-assistcancel="1">Cancel</button></div>
      ${search}
      <div class="pklist">${names}</div>
      ${ev.a ? `<button class="act ghost" data-assistpick="none">Remove assist</button>` : ''}
    </div>`;
}

function editorPanel(m) {
  const ev = state.events.find(x => x.id === state.editor.id);
  if (!ev) { state.editor = null; return ''; }
  const teamId = ev.s === 'home' ? m.home : ev.s === 'away' ? m.away : null;
  const squad = teamId ? squadOf(teamId) : [];
  const label = { goal: 'Edit goal', own_goal: 'Edit own goal', yellow: 'Edit booking',
                  red: 'Edit red card', motm: 'Edit man of the match' }[ev.t] ?? 'Edit event';
  const sel = state.editor.player;

  const names = squad.length
    ? squad.map(p => `<button class="pk ${sel === p.id ? 'on' : ''}" data-edpick="${p.id}">
        ${p.no != null ? `<span class="no tnum">${p.no}</span>` : '<span class="no"></span>'}
        <span>${esc(p.name)}</span></button>`).join('')
    : `<p class="note" style="padding:6px 0">No squad list for ${esc(cityOf(teamId))} yet
       \u2014 the minute can still be corrected.</p>`;

  const search = squad.length > 6
    ? `<input id="pkq" type="search" placeholder="Search players" autocomplete="off"
        autocapitalize="none" spellcheck="false" style="margin-bottom:9px">` : '';

  // A man of the match award has no meaningful minute, so no field for one.
  const minuteField = ev.t === 'motm' ? '' : `
      <div class="form" style="padding-top:0;margin-bottom:10px">
        <div><label for="edmin">Minute (e.g. 12 or 20+2)</label>
          <input id="edmin" inputmode="numeric" autocomplete="off" spellcheck="false"
            value="${esc(state.editor.minute)}" style="max-width:9em"></div>
      </div>`;

  // Assists exist on goals only — never on an own goal, where there is
  // nobody to credit, and never on a card. The scorer is excluded from their
  // own assist list because the database rejects a self-assist outright.
  const asel = state.editor.assist;
  const assistOptions = squad.filter(p => p.id !== sel);
  const assistSection = ev.t !== 'goal' ? '' : `
      <div class="pksub">Assisted by</div>
      ${assistOptions.length > 6
        ? `<input id="pkqa" type="search" placeholder="Search players" autocomplete="off"
             autocapitalize="none" spellcheck="false" style="margin-bottom:9px">` : ''}
      <div class="pklist">
        <button class="pk ${asel == null ? 'on' : ''}" data-edassist="none">
          <span class="no"></span><span>No assist</span></button>
        ${assistOptions.map(p => `<button class="pk ${asel === p.id ? 'on' : ''}"
            data-edassist="${p.id}">
            ${p.no != null ? `<span class="no tnum">${p.no}</span>` : '<span class="no"></span>'}
            <span>${esc(p.name)}</span></button>`).join('')}
      </div>`;

  return `<div class="picker">
      <div class="pkhd"><span>${label}</span>
        <button data-edcancel="1">Cancel</button></div>
      ${minuteField}
      ${ev.t === 'goal' ? '<div class="pksub">Scored by</div>' : ''}
      ${search}
      <div class="pklist">
        <button class="pk ${sel == null ? 'on' : ''}" data-edpick="none">
          <span class="no"></span><span>No player recorded</span></button>
        ${names}
      </div>
      ${assistSection}
      <button class="act" data-edsave="1">Save changes</button>
    </div>`;
}

/* ── admin controls on a match ───────────────────────────── */
function adminMatchControls(m) {
  const started = M.hasStarted(m);
  const live = M.isLive(m);
  let primary;
  if (m.ff) primary = `<button class="act ghost" data-ff="null">Undo forfeit</button>`;
  else if (!started) primary = `<button class="act" data-clock="start" ${m.home ? '' : 'disabled'}>
      ${m.home ? 'Start match' : 'Awaiting teams'}</button>`;
  else if (m.status === 'first_half') primary = `<button class="act" data-clock="half_time">Half time</button>`;
  else if (m.status === 'half_time') primary = `<button class="act" data-clock="second_half">Start second half</button>`;
  else if (m.status === 'second_half') primary = `<button class="act" data-clock="full_time">Full time</button>`;
  else primary = `<button class="act ghost" disabled>Match complete</button>`;

  const pens = M.needsShootout(m) ? shootoutPanel(m) : '';

  return `<div class="sect">Clock</div>
    ${primary}
    <div class="two">
      <button class="act ghost" data-clock="${m.run ? 'pause' : 'resume'}" ${live ? '' : 'disabled'}>
        ${m.run ? 'Pause' : 'Resume'}</button>
      <button class="act ghost" data-clock="full_time" ${live ? '' : 'disabled'}>Full time</button>
    </div>
    ${pens}
    <div class="sect">Log</div>
    <div class="logs">
      <button class="lg" data-goal="home" ${started && !m.ff ? '' : 'disabled'}>
        <span class="w">Goal</span><span class="s">${esc(cityOf(m.home))}</span></button>
      <button class="lg" data-goal="away" ${started && !m.ff ? '' : 'disabled'}>
        <span class="w">Goal</span><span class="s">${esc(cityOf(m.away))}</span></button>
      <button class="lg" data-card="yellow" ${started && !m.ff ? '' : 'disabled'}>
        <span class="w">Yellow</span><span class="s">Booking</span></button>
      <button class="lg" data-card="red" ${started && !m.ff ? '' : 'disabled'}>
        <span class="w">Red</span><span class="s">Sent off</span></button>
      <button class="lg" data-card="motm" ${m.status === 'full_time' ? '' : 'disabled'}>
        <span class="w">Man of match</span><span class="s">At full time</span></button>
    </div>
    ${state.picker ? pickerPanel(m) : ''}
    <div class="sect">Match admin</div>
    <div class="two">
      <button class="act ghost" data-ff="home" ${m.ff ? 'disabled' : ''}>${esc(cityOf(m.home))} forfeit</button>
      <button class="act ghost" data-ff="away" ${m.ff ? 'disabled' : ''}>${esc(cityOf(m.away))} forfeit</button>
    </div>`;
}

/**
 * Player picker. Appears inline after a goal or card, never as a modal —
 * play continues while the organiser taps. Always skippable: an unattributed
 * goal still counts, it just cannot feed the golden boot.
 */
function pickerPanel(m) {
  const { type, side } = state.picker;
  if (!side) {
    return `<div class="picker">
      <div class="pkhd"><span>Which club?</span>
        <button data-pick-cancel="1">Cancel</button></div>
      <div class="two" style="margin-top:0">
        <button class="act ghost" data-pick-side="home">${esc(cityOf(m.home))}</button>
        <button class="act ghost" data-pick-side="away">${esc(cityOf(m.away))}</button>
      </div></div>`;
  }
  const teamId = side === 'home' ? m.home : m.away;
  const squad = squadOf(teamId);
  const label = { goal: 'Who scored?', own_goal: 'Own goal by?',
                  yellow: 'Booked?', red: 'Sent off?', motm: 'Man of the match?' }[type];

  const names = squad.length
    ? squad.map(p => `<button class="pk" data-pick="${p.id}">
        ${p.no != null ? `<span class="no tnum">${p.no}</span>` : '<span class="no"></span>'}
        <span>${esc(p.name)}</span></button>`).join('')
    : `<p class="note" style="padding:6px 0">No squad list loaded for
       ${esc(cityOf(teamId))} yet. Record it without a name for now \u2014
       the goal still counts.</p>`;

  // A goal tapped for a side might turn out to be an own goal. Offering it
  // here, rather than as a separate button, means the score still moved on
  // the very first tap and the correction is one more tap.
  const og = type === 'goal'
    ? `<button class="pk og" data-pick="own">Own goal \u2014
        ${esc(cityOf(side === 'home' ? m.away : m.home))} player</button>`
    : '';

  const search = squad.length > 6
    ? `<input id="pkq" type="search" placeholder="Search players" autocomplete="off"
        autocapitalize="none" spellcheck="false" style="margin-bottom:9px">` : '';

  return `<div class="picker">
      <div class="pkhd"><span>${label}</span>
        <button data-pick-cancel="1">Cancel</button></div>
      ${search}
      <div class="pklist">${names}${og}</div>
      <button class="act ghost" data-pick="skip">Record without a name</button>
    </div>`;
}

function shootoutPanel(m) {
  const p = state.pens ?? { h: m.ph || 0, a: m.pa || 0 };
  // The plus and minus carry no text of their own, so they get the club name
  // in a label — otherwise a screen reader offers four identical buttons.
  const row = (side, id, v) => `<div class="pr" style="--c:${colOf(id)}">
      <span class="bd"><img src="${crest(id)}" alt=""></span>
      <span class="nx">${esc(nameOf(id))}</span>
      <span class="pm"><button data-pen="${side}:-1"
          aria-label="One fewer penalty for ${esc(nameOf(id))}">&minus;</button>
        <button data-pen="${side}:1"
          aria-label="One more penalty for ${esc(nameOf(id))}">+</button></span>
      <span class="cnt tnum">${v}</span></div>`;
  return `<div class="sect">Penalty shootout</div>
    <div class="pens">
      <p class="note" style="padding-top:0">Level at full time in a knockout tie, so it goes
        straight to penalties. Recorded separately from the score.</p>
      ${row('h', m.home, p.h)}${row('a', m.away, p.a)}
      <div class="two" style="grid-template-columns:1fr">
        <button class="act" data-pen-confirm="1" ${p.h === p.a ? 'disabled' : ''}>
          Confirm shootout result</button></div>
    </div>`;
}

/* ── tables ──────────────────────────────────────────────── */
function viewTables() {
  const teamsArr = Object.values(state.teams);
  const ms = resolvedMatches();
  if (!teamsArr.length) return '<p class="empty">Loading\u2026</p>';

  /**
   * `r.unresolved` is true from the first kick-off \u2014 after one match most of
   * a group is level on everything, because almost nothing has happened yet.
   * That is not news, so it is not shown. The highlight follows
   * `unresolvedPairs` instead, which fires only once the group is complete
   * AND the tie decides qualification: exactly the rows the banner names for
   * spectators and the shoot-out panel offers to the organiser. A highlight
   * always has its explanation on the same screen, and a 3rd/4th tie that
   * sends nobody through stays quiet, because the rules separate nobody.
   */
  const tbl = (g) => {
    const pending = new Set(M.unresolvedPairs(teamsArr, ms, g, state.ties)
      .flatMap(p => [p.a.team.id, p.b.team.id]));
    return M.standings(teamsArr, ms, g, state.ties).map((r, i) => `
      <tr class="${i < 2 && !r.team.disqualified ? 'up' : ''} ${r.team.disqualified ? 'dq' : ''} ${pending.has(r.team.id) ? 'unres' : ''}">
        <td class="nm"><span class="in" data-team="${r.team.id}"><span class="rk">${i + 1}</span>
          <span class="tile" style="--c:${r.team.colour}"><img src="${crest(r.team.id)}" alt=""></span>
          <span class="who"><b>${esc(r.team.name)}${r.team.disqualified ? '<span class="tag">DQ</span>' : ''}${r.tie === 'W' ? '<span class="tag so">Shoot-out</span>' : ''}</b>
          <i>${esc(r.team.city)}</i></span></span></td>
        <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
        <td>${r.p ? (r.gd > 0 ? '+' : r.gd < 0 ? '\u2212' : '') + Math.abs(r.gd) : '\u2013'}</td>
        <td class="p">${r.pts}</td></tr>`).join('');
  };

  const head = `<thead><tr><th class="nm">Club</th><th>P</th><th>W</th><th>D</th>
    <th>L</th><th>GD</th><th>Pts</th></tr></thead>`;

  const slot = (id, fb) => id ? esc(cityOf(id)) : fb;
  const s = M.resolveSlots(teamsArr, ms, state.slots, state.ties);

  // WHY THE GROUP HAS NOT SENT ANYONE THROUGH, when its table says it has.
  // The table counts a match from kick-off, so a game left at half time still
  // reads "P 4" — while the knockout slots, quite rightly, wait for full time.
  // Without this the two disagree silently and the page looks broken.
  const holding = (g) => {
    const open = M.groupHeldOpenBy(ms, g);
    if (!open.length) return '';
    const which = open.map(m =>
      `${cityOf(m.home)} v ${cityOf(m.away)}`).join(', ');
    return `<p class="note" style="padding-top:6px">This table is not final.
      ${open.length === 1 ? 'One match has not finished' : `${open.length} matches have not finished`}
      &mdash; <b>${esc(which)}</b>. The semi-finals are drawn once it does.</p>`;
  };

  return `<div class="sect">Group A</div><table>${head}<tbody>${tbl('A')}</tbody></table>
    ${holding('A')}
    <div class="sect">Group B</div><table>${head}<tbody>${tbl('B')}</tbody></table>
    ${holding('B')}
    ${state.admin ? tieShootoutPanels(teamsArr, ms) : unresolvedNotice(teamsArr, ms)}
    <div class="sect">Sunday</div>
    <div class="ko"><span class="l">Semi-final 1</span>
      <span class="w">${slot(s.sf1_home, 'Winner A')} v ${slot(s.sf1_away, 'Runner-up B')}</span></div>
    <div class="ko"><span class="l">Semi-final 2</span>
      <span class="w">${slot(s.sf2_home, 'Winner B')} v ${slot(s.sf2_away, 'Runner-up A')}</span></div>
    <div class="ko"><span class="l">Final</span>
      <span class="w">${slot(s.final_home, 'Winner SF1')} v ${slot(s.final_away, 'Winner SF2')}</span></div>
    ${state.admin ? adminQualification(teamsArr, s) : ''}`;
}

/** Spectator wording when the rules cannot separate two clubs. Only shown
 *  once the group is actually finished — a mid-group tie is just noise. */
function unresolvedNotice(teamsArr, ms) {
  const pairs = ['A', 'B'].flatMap(g =>
    M.unresolvedPairs(teamsArr, ms, g, state.ties).map(p => ({ g, ...p })));
  if (!pairs.length) return '';
  const names = pairs.map(p =>
    `${cityOf(p.a.team.id)} and ${cityOf(p.b.team.id)}`).join('; ');
  return `<div class="banner warn">${esc(names)} finished level on points,
    head-to-head, goal difference and goals scored. Under the rules that is
    settled by a one-off penalty shoot-out.</div>`;
}

/** The organiser's prompt: enter the one-off shoot-out result. It is stored
 *  as a real record, becomes the final tie-break, and both the table and the
 *  Sunday line-up follow from it. Both admin accounts see the same panel, so
 *  whoever ran that group's pitch enters it. */
function tieShootoutPanels(teamsArr, ms) {
  const pairs = ['A', 'B'].flatMap(g =>
    M.unresolvedPairs(teamsArr, ms, g, state.ties).map(p => ({ g, ...p })));

  const settled = state.ties.map(t => {
    const w = t.sa > t.sb ? t.a : t.b, l = t.sa > t.sb ? t.b : t.a;
    const ws = Math.max(t.sa, t.sb), ls = Math.min(t.sa, t.sb);
    return `<div class="banner">${esc(cityOf(w))} beat ${esc(cityOf(l))}
      ${ws}\u2013${ls} in the one-off shoot-out; the table and Sunday line-up
      reflect it.</div>`;
  }).join('');

  const panels = pairs.map(p => {
    const key = p.g + p.i;
    const sc = state.tiePens[key] ?? { a: 0, b: 0 };
    const row = (side, teamId, v) => `<div class="pr" style="--c:${colOf(teamId)}">
        <span class="bd"><img src="${crest(teamId)}" alt=""></span>
        <span class="nx">${esc(nameOf(teamId))}</span>
        <span class="pm"><button data-tiepen="${key}:${side}:-1"
            aria-label="One fewer penalty for ${esc(nameOf(teamId))}">&minus;</button>
          <button data-tiepen="${key}:${side}:1"
            aria-label="One more penalty for ${esc(nameOf(teamId))}">+</button></span>
        <span class="cnt tnum">${v}</span></div>`;

    return `<div class="sect">One-off shoot-out</div>
      <div class="pens">
        <p class="note" style="padding-top:0">${esc(cityOf(p.a.team.id))} and
          ${esc(cityOf(p.b.team.id))} finished level on every tie-breaker, so the
          rules go to a one-off penalty shoot-out. Enter the result \u2014 the
          table and the Sunday line-up follow from it.</p>
        ${row('a', p.a.team.id, sc.a)}${row('b', p.b.team.id, sc.b)}
        <div class="two" style="grid-template-columns:1fr">
          <button class="act" data-tieconfirm="${key}" ${sc.a === sc.b ? 'disabled' : ''}>
            Confirm shoot-out result</button></div>
      </div>`;
  }).join('');

  return settled + panels;
}

function adminQualification(teamsArr, s) {
  const opts = (sel) => ['<option value="">Automatic</option>']
    .concat(teamsArr.map(t =>
      `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)} (${esc(t.city)})</option>`))
    .join('');
  const rows = [['Semi-final 1', 'sf1_home', 'sf1_away'],
                ['Semi-final 2', 'sf2_home', 'sf2_away'],
                ['Final', 'final_home', 'final_away']]
    .map(([label, a, b]) => `<div class="qrow"><span class="lbl">${label}</span>
      <select data-slot="${a}">${opts(state.slots[a])}</select>
      <select data-slot="${b}">${opts(state.slots[b])}</select></div>`).join('');

  const dq = teamsArr.map(t =>
    `<button class="${t.disqualified ? 'out' : ''}" data-dq="${t.id}">${esc(t.city)}</button>`).join('');

  return `<div class="sect">Qualification</div>
    <p class="note" style="padding-top:0">Slots fill themselves from the tables. Override any of
      them by hand if a club is disqualified, or if a tie is settled off the pitch.</p>
    ${rows}
    <div class="sect">Disqualify</div>
    <p class="note" style="padding-top:0">A disqualified club drops out of qualification. Its played
      results stay in the table. Name a replacement in the slots above.</p>
    <div class="dqlist">${dq}</div>`;
}

/* ── squads & player stats ───────────────────────────────── */
/** One line of truth about a club: live now, next fixture, how far they
 *  got, or the trophy. */
function teamStatus(id) {
  const t = team(id);
  if (t?.disqualified) return 'Disqualified';
  const ms = resolvedMatches().filter(m => m.home === id || m.away === id);

  // A CLUB THAT DID NOT ENTER IS NOT A CLUB THAT WENT OUT. St Mark are not in
  // the 2026 tournament: no group, no fixtures. Every branch below is about
  // how far a club got, so without this the function fell all the way through
  // to "Eliminated · group stage" — which is both untrue and unkind about a
  // club that simply is not playing. They keep their row, their crest and
  // their whole History record; they are just not in this one.
  if (!t?.group_letter && !ms.length) return 'Not entered this year';
  const opp = (m) => cityOf(m.home === id ? m.away : m.home);

  const live = ms.find(m => M.isLive(m) || m.status === 'half_time');
  if (live) return `Live \u00b7 v ${opp(live)}`;

  const next = ms.filter(m => !M.hasStarted(m) && !m.ff).sort(M.fixtureOrder)[0];
  if (next) {
    const stage = M.isKnockout(next) ? M.stageLabel(next) : `Group ${t?.group_letter ?? ''}`;
    return `${stage} \u00b7 v ${opp(next)} ${next.kickoff}`;
  }

  const fin = ms.find(m => m.stage === 'FINAL');
  if (fin) {
    const w = M.winnerOf(fin);
    if (w === id) return 'Champions';
    if (w) return 'Runners-up';
  }
  const sf = ms.find(m => m.stage === 'SF1' || m.stage === 'SF2');
  if (sf && M.winnerOf(sf) && M.winnerOf(sf) !== id) return 'Eliminated \u00b7 semi-final';

  const teamsArr = Object.values(state.teams);
  const pairs = M.unresolvedPairs(teamsArr, resolvedMatches(), t?.group_letter ?? '', state.ties);
  if (pairs.some(p => p.a.team.id === id || p.b.team.id === id)) return 'Awaiting shoot-out';
  return 'Eliminated \u00b7 group stage';
}

/** What a back button should say: the page it will actually return to, which
 *  is the top of the stack whenever there is one. A button reading "Croydon"
 *  that lands on a match report is worse than no label at all. */
function backLabel(fallback) {
  const prev = state.hist[state.hist.length - 1];
  if (!prev) {
    const [kind, arg] = String(fallback).split(':');
    if (kind === 'sqteam') return cityOf(arg) || 'Squad';
    return arg === 'awards' ? 'Stats' : 'All clubs';
  }
  if (prev.view === 'match') {
    const mm = resolvedMatches().find(x => x.id === prev.matchId);
    return mm ? `${cityOf(mm.home)} v ${cityOf(mm.away)}` : 'Match';
  }
  if (prev.view === 'award') return BOARDS[boardKey(prev.award)]?.label ?? 'Stats';
  if (prev.view === 'squads' && prev.sq.player) return playerName(prev.sq.player) ?? 'Player';
  if (prev.view === 'squads' && prev.sq.team) return cityOf(prev.sq.team) || 'Squad';
  if (prev.view === 'histcomp') return compOf(prev.histComp)?.name ?? 'History';
  if (prev.view === 'histed') {
    return state.archive?.editions?.find(e => e.id === prev.histEd)?.display_name ?? 'Edition';
  }
  return { fixtures: 'Fixtures', live: 'Live now', squads: 'All clubs',
           tables: 'Tables', awards: 'Stats', history: 'History',
           admin: 'Organiser' }[prev.view] ?? 'Back';
}

const backButton = (fallback) =>
  `<button class="back" data-back="${fallback}">&larr; ${esc(backLabel(fallback))}</button>`;

function statsFor(pid) {
  const mine = state.events.filter(e => e.p === pid);
  return {
    goals: mine.filter(e => e.t === 'goal'),
    og:    mine.filter(e => e.t === 'own_goal').length,
    y:     mine.filter(e => e.t === 'yellow').length,
    r:     mine.filter(e => e.t === 'red').length,
    motm:  mine.filter(e => e.t === 'motm').length,
    // An assist is on somebody else's goal, so it is never in `mine`.
    assists: state.events.filter(e => e.t === 'goal' && e.a === pid).length,
  };
}

function viewSquads() {
  const teamsArr = Object.values(state.teams);
  if (!teamsArr.length) return '<p class="empty">Loading\u2026</p>';
  const ms = resolvedMatches();

  // player card
  if (state.sq.player) {
    const pl = state.players.find(p => p.id === state.sq.player);
    if (!pl) { state.sq.player = null; return viewSquads(); }
    const t = team(pl.team);
    const st = statsFor(pl.id);
    const byId = Object.fromEntries(state.players.map(p => [p.id, p]));
    const sus = M.suspensions(ms, state.events, byId)[pl.id];

    const goalRows = st.goals.map(g => {
      const m = ms.find(x => x.id === g.m);
      const opp = m ? (m.home === pl.team ? m.away : m.home) : null;
      return `<li><span class="mk tnum goal">${esc(g.min || '')}</span>
        <span class="tx">v <b>${esc(opp ? cityOf(opp) : '?')}</b>
          <i>(${esc(m ? M.stageLabel(m) : '')})</i></span><span></span></li>`;
    }).join('');

    // Honours only ever appear once an organiser has confirmed a trophy;
    // leading a leaderboard is not the same thing as having won it.
    const hon = M.honoursFor(pl.id, state.trophies);
    const honours = hon.length ? `<div class="sect">Honours</div>
      <ul class="honours">${hon.map(h => `<li><span class="hz">\u2605</span>
        <span class="hl">${esc(h.label)} 2026</span>
        ${h.shared ? '<span class="hsh">shared</span>' : ''}</li>`).join('')}</ul>` : '';

    return `${backButton(`sqteam:${pl.team}`)}
      <div class="stack one"><div class="sl phead" style="--c:${colOf(pl.team)};--tc:${txtOf(pl.team)}">
        <span class="bdg"><img src="${crest(pl.team)}" alt=""></span>
        <span class="who"><b>${esc(pl.name)}</b>
          <i>${esc(nameOf(pl.team))} \u00b7 ${esc(cityOf(pl.team))}</i></span>
        <span class="bignum tnum">${pl.no ?? ''}</span></div></div>
      ${sus ? `<div class="banner warn">Suspended (${esc(sus.reason.toLowerCase())})
        ${sus.misses ? `\u2014 misses the ${esc(M.stageLabel(sus.misses))} fixture` : ''}.</div>` : ''}
      ${honours}
      <div class="sect">This tournament</div>
      <div class="stats five">
        <div class="stat"><i>Goals</i><b class="tnum">${st.goals.length}</b></div>
        <div class="stat"><i>Assists</i><b class="tnum">${st.assists}</b></div>
        <div class="stat"><i>Man of match</i><b class="tnum">${st.motm}</b></div>
        <div class="stat"><i>Yellow</i><b class="tnum">${st.y}</b></div>
        <div class="stat"><i>Red</i><b class="tnum">${st.r}</b></div>
      </div>
      ${st.og ? `<p class="note">${st.og} own goal${st.og === 1 ? '' : 's'} recorded.</p>` : ''}
      ${st.goals.length ? `<div class="sect">Goals</div><ol class="tl">${goalRows}</ol>` : ''}`;
  }

  // one club's squad
  if (state.sq.team) {
    const t = team(state.sq.team);
    const squad = squadOf(state.sq.team);
    const rows = squad.map(p => {
      const st = statsFor(p.id);
      const bits = [];
      if (st.goals.length) bits.push(`${st.goals.length}g`);
      if (st.motm) bits.push(`${st.motm}\u2605`);
      if (st.y) bits.push(`${st.y}y`);
      if (st.r) bits.push(`${st.r}r`);
      return `<button class="pk" data-sqplayer="${p.id}">
        <span class="no tnum">${p.no ?? ''}</span>
        <span style="flex:1">${esc(p.name)}</span>
        <span class="pstat tnum">${bits.join(' \u00b7 ')}</span></button>`;
    }).join('');
    // A club that competed before gets its cabinet as a second tab here
    // rather than a second page about the same club. Kidane Mihret has no
    // tab at all: nothing in the archive crosswalks to them, and an empty
    // History tab would imply a record that does not exist.
    loadArchive();
    const mine = archiveTeamForLive(t.id);
    const tabs = mine ? `<div class="ctabs" role="tablist">
        ${[['squad', 'Squad'], ['history', 'History']].map(([k, lab]) =>
          `<button role="tab" aria-selected="${state.clubTab === k}"
             class="${state.clubTab === k ? 'on' : ''}" data-clubtab="${k}">${lab}</button>`).join('')}
      </div>` : '';

    const head = `<div class="stack one"><div class="sl phead" style="--c:${colOf(t.id)};--tc:${txtOf(t.id)}">
        <span class="bdg"><img src="${crest(t.id)}" alt=""></span>
        <span class="who"><b>${esc(t.name)}</b><i>${esc(t.city)}</i></span>
        <span class="clubmeta"><i>Manager</i><b>${t.manager ? esc(t.manager) : '\u2014'}</b>
          <i class="cstat">${esc(teamStatus(t.id))}</i></span></div></div>`;

    if (mine && state.clubTab === 'history') {
      return `${backButton('view:squads')}${head}${tabs}${cabinetBody(mine.id)}`;
    }

    return `${backButton('view:squads')}${head}${tabs}
      ${squad.length
        ? `<div class="sect">Squad \u00b7 ${squad.length}</div><div class="pklist" style="max-height:none">${rows}</div>
           <p class="note">Tap a player for their tournament record.</p>`
        : `<p class="empty">No squad list loaded for ${esc(t.city)} yet.</p>`}`;
  }

  // All clubs IN THIS YEAR'S TOURNAMENT. `teams` is the standing register of
  // every club the app knows, which is not the same list — St Mark are not
  // entered in 2026, and a club that is not playing has no squad, no fixtures
  // and no reason to sit in a list headed "Clubs" during the weekend. They are
  // no more relevant here than any club that never entered at all.
  //
  // Their page is still reachable, and still correct: a History cabinet for a
  // crosswalked club routes to it, and it says "Not entered this year".
  const cards = teamsArr.filter(t => t.group_letter).map(t => `<button class="fx" data-sqteam="${t.id}">
      <span class="t"><b>${esc(t.group_letter)}</b>Group</span>
      <span class="n"><span class="side" style="--c:${t.colour}">
        <span class="tile" style="--c:${t.colour}"><img src="${crest(t.id)}" alt=""></span>
        <span class="who"><b>${esc(t.name)}</b><i>${esc(t.city)}</i></span></span></span>
      <span class="r tnum"><span class="rsc" style="font-size:14px;color:var(--dim)">${squadOf(t.id).length}</span>
        <span class="st">players</span></span></button>`).join('');
  // THE POINTER SITS WHERE THE NAMES ARE. A notice about publishing players'
  // names is no use filed behind a bell icon a player would never open —
  // this is the page they and their parents actually look at.
  return `<div class="sect">Clubs</div>${cards}
    <p class="note">Every goal, card and award is attributed live, so each player's
      tournament record builds itself as the weekend goes on.</p>
    <button class="act ghost" data-view="admin" style="margin-top:2px">
      How players’ names are used on this site</button>`;
}

/* ── stats ───────────────────────────────────────────────── */
/**
 * Every board, computed once and shared by the Stats index, the full board
 * views and the organiser's trophy panel. The three trophy keys alias the
 * board each is decided from, so `boards[trophyKey]` keeps working and a
 * trophy can never drift apart from the stat that decides it.
 */
function allBoards() {
  const byId = Object.fromEntries(state.players.map(p => [p.id, p]));
  const teamsArr = Object.values(state.teams);
  const ms = resolvedMatches();
  const goals = M.goldenBootBoard(state.events, byId);
  const motm  = M.playerOfTournamentBoard(state.events, byId);
  const conceded = M.goldenGloveBoard(teamsArr, ms);
  return {
    goals, motm, conceded,
    assists: M.assistsBoard(state.events, byId),
    yellow:  M.yellowCardBoard(state.events, byId),
    red:     M.redCardBoard(state.events, byId),
    scored:  M.goalsScoredBoard(teamsArr, ms),
    clean:   M.cleanSheetsBoard(teamsArr, ms),
    scorers: M.distinctScorersBoard(teamsArr, state.events, byId),
    golden_boot: goals, player_of_tournament: motm, golden_glove: conceded,
  };
}

/** What each board is called, whether its rows are players or clubs (which
 *  decides what a row links to), how its number reads, and what to say when
 *  it is empty. The card boards being empty all weekend is the good outcome,
 *  so they say so rather than apologising. */
const BOARDS = {
  goals: { of: 'players', label: 'Goalscorers',
    empty: 'No goals have been attributed to a named player yet.',
    foot: 'Every player with a goal to their name. A goal logged without a scorer still counts on the scoreboard, but cannot appear here.' },
  assists: { of: 'players', label: 'Assists',
    empty: 'No assists have been recorded yet.',
    foot: 'The pass that made the goal, where one was recorded. Assists are entered after the fact by editing the goal, so this board fills in behind the scoreline rather than alongside it — an empty row here means nobody has been credited yet, not that nobody set anything up.' },
  motm: { of: 'players', label: 'Man of the Match',
    empty: 'No man of the match awards have been given yet.',
    foot: 'Every player with a man of the match award.' },
  yellow: { of: 'players', label: 'Yellow cards',
    empty: 'Nobody has been booked. Long may it last.',
    foot: 'Bookings attributed to a named player. A card logged without a name stays on the match report.' },
  red: { of: 'players', label: 'Red cards',
    empty: 'Nobody has been sent off.',
    foot: 'Dismissals attributed to a named player.' },
  scored: { of: 'teams', label: 'Goals scored',
    empty: 'No matches have been played yet.',
    foot: 'Goals scored by club, most first.' },
  conceded: { of: 'teams', label: 'Goals conceded',
    empty: 'No matches have been played yet.',
    foot: 'Goals conceded by club, fewest first. This is the golden glove board — the trophy itself goes to a goalkeeper, which is why an organiser names the winner rather than this table doing it.' },
  clean: { of: 'teams', label: 'Clean sheets',
    empty: 'No clean sheets yet.',
    foot: 'Matches played out to full time without conceding. A forfeit is a result, not a shut-out, and does not count.' },
  scorers: { of: 'teams', label: 'Different goalscorers',
    empty: 'No goals have been attributed to a named player yet.',
    foot: 'How many different players have scored for each club — a squad sharing its goals around against one that relies on a single striker. Own goals belong to nobody and are excluded.' },
};

/** A trophy key routes to the board it is decided from. */
const BOARD_ALIAS = { golden_boot: 'goals', player_of_tournament: 'motm', golden_glove: 'conceded' };
const boardKey = (k) => BOARD_ALIAS[k] ?? k;

const PLAYER_BOARDS = ['goals', 'assists', 'motm', 'yellow', 'red'];
const TEAM_BOARDS   = ['scored', 'conceded', 'clean', 'scorers'];

/** Confirmed winners of one trophy, as a display string. */
const wonNames = (key) =>
  (state.trophies[key] || []).map(id => playerName(id) ?? 'Unknown player').join(' & ');

/**
 * The honours strip, at the top of Stats once trophies are confirmed.
 *
 * Nothing before that: a leader is not a winner, and a strip announcing one
 * would be the loudest thing on a page whose whole job is the boards. One
 * crest only when every winner shares a club — a shared trophy across two
 * clubs has no single crest to show.
 */
function honoursStrip() {
  const won = M.TROPHIES.filter(([k]) => (state.trophies[k] || []).length);
  if (!won.length) return '';
  const rows = won.map(([key, label]) => {
    const ids = state.trophies[key];
    const clubs = [...new Set(ids.map(id => state.players.find(p => p.id === id)?.team).filter(Boolean))];
    const club = clubs.length === 1 ? clubs[0] : null;
    return `<button class="hon" data-player="${ids[0]}">
        <span class="ht">${esc(label)}</span>
        <span class="hbody">
          ${club ? `<span class="tile" style="--c:${colOf(club)}"><img src="${crest(club)}" alt=""></span>` : ''}
          <span class="who"><b>${esc(wonNames(key))}</b>
            <i>${esc(club ? cityOf(club) : 'Shared across clubs')}</i></span>
          ${ids.length > 1 ? '<span class="hsh">shared</span>' : ''}
        </span></button>`;
  }).join('');
  return `<div class="sect">Trophies</div><div class="honstrip">${rows}</div>`;
}

function viewAwards() {
  const teamsArr = Object.values(state.teams);
  const ms = resolvedMatches();
  if (!teamsArr.length) return '<p class="empty">Loading…</p>';

  if (!ms.some(M.hasStarted)) return `<div class="sect">Stats</div>
    <p class="empty">Nothing to count yet. Every board fills in as matches are played.</p>`;

  const boards = allBoards();

  /**
   * A card is a preview of its board: the stat's name, then its top three
   * rows. Values are bare numerals — the header already says what they
   * count, so "1 clean sheet" under a card headed Clean sheets was saying it
   * twice. The leader's number sits in a filled pill and the rest are plain,
   * which is the pattern that makes a board readable at a glance.
   *
   * A pill goes on every row in first place, not merely the first row: where
   * two clubs are level at the top, calling one of them the leader because
   * the tie-break sorted it first would be inventing a result.
   */
  const previewRow = (r, cfg) => {
    const pill = r.place === 1 ? ' lead' : '';
    if (cfg.of === 'teams') {
      const t = r.item.team;
      return `<button class="srow" data-team="${t.id}">
          <span class="tile" style="--c:${t.colour}"><img src="${crest(t.id)}" alt=""></span>
          <span class="who"><b>${esc(t.name)}</b><i>${esc(t.city)}</i></span>
          <span class="sv tnum${pill}">${r.score}</span></button>`;
    }
    const club = r.item.team;
    return `<button class="srow" data-player="${r.item.id}">
        ${club ? `<span class="tile" style="--c:${colOf(club)}"><img src="${crest(club)}" alt=""></span>`
               : '<span class="tile"></span>'}
        <span class="who"><b>${esc(r.item.name)}</b><i>${club ? esc(nameOf(club)) : ''}</i></span>
        <span class="sv tnum${pill}">${r.score}</span></button>`;
  };

  /**
   * The card carries data-award so a tap anywhere on it opens the board, and
   * its header is a real button carrying the same, so a keyboard reaches it
   * too. The rows are real buttons in their own right. Nesting a button
   * inside a button is invalid HTML, which is why the card itself is a div:
   * the delegated handler walks up from whatever was clicked, so a row wins
   * over the card and the card wins over nothing.
   */
  const card = (key) => {
    const cfg = BOARDS[key];
    const top = M.topRows(boards[key], 3);
    return `<div class="scard" data-award="${key}">
        <button class="sch" data-award="${key}">
          <span class="stt">${esc(cfg.label)}</span><span class="chev" aria-hidden="true"></span></button>
        ${top.length ? top.map(r => previewRow(r, cfg)).join('')
                     : `<p class="snone">${cfg.empty}</p>`}
      </div>`;
  };

  return `${honoursStrip()}
    <div class="sect">Players</div>${PLAYER_BOARDS.map(card).join('')}
    <div class="sect">Teams</div>${TEAM_BOARDS.map(card).join('')}
    ${trophySection(boards, teamsArr, ms)}`;
}

/* ── one board in full ────────────────────────────────────── */
function viewAwardBoard() {
  if (!Object.values(state.teams).length) return '<p class="empty">Loading…</p>';
  const key = boardKey(state.award);
  const cfg = BOARDS[key];
  if (!cfg) {                       // unknown board, e.g. a stale history entry
    state.view = 'awards'; state.award = null;
    return viewAwards();
  }

  const board = allBoards()[key];

  // A board that decides a trophy says so once the trophy is confirmed.
  const trophyKey = M.TROPHIES.map(([k]) => k).find(k => boardKey(k) === key);
  const won = trophyKey ? (state.trophies[trophyKey] || []) : [];
  const confirmed = won.length
    ? `<div class="banner conf">${esc(M.trophyLabel(trophyKey))} — ${esc(wonNames(trophyKey))}${
        won.length > 1 ? ' (shared)' : ''}.</div>`
    : '';

  // Joint places carry the "=" leaderboards conventionally use, so a reader
  // can tell 1, 2, 2, 4 from a numbering mistake at a glance.
  const rank = (r) => `<span class="pl tnum ${r.joint ? 'joint' : ''}">${
    r.joint ? '=' : ''}${r.place}</span>`;

  const rows = cfg.of === 'teams'
    ? board.map(r => `<button class="lbr" data-team="${r.item.team.id}">
        ${rank(r)}
        <span class="tile" style="--c:${r.item.team.colour}"><img src="${crest(r.item.team.id)}" alt=""></span>
        <span class="who"><b>${esc(r.item.team.name)}</b>
          <i>${esc(r.item.team.city)}${r.item.played != null ? ` · ${r.item.played} played` : ''}</i></span>
        <span class="lbn tnum">${r.score}</span></button>`).join('')
    : board.map(r => `<button class="lbr" data-player="${r.item.id}">
        ${rank(r)}
        <span class="who"><b>${esc(r.item.name)}${
          won.includes(r.item.id) ? '<span class="tag wn">Winner</span>' : ''}</b>
          <i>${esc(nameOf(r.item.team))}</i></span>
        <span class="lbn tnum">${r.score}</span></button>`).join('');

  return `${backButton('view:awards')}
    <div class="sect">${esc(cfg.label)}</div>
    ${confirmed}
    ${board.length
      ? `<div class="lb">${rows}</div><p class="note">${cfg.foot}</p>`
      : `<p class="empty">${cfg.empty}</p>`}`;
}

/* -- confirming the trophies (organisers) ----------------- */
/**
 * All three trophies are presented to players \u2014 including the golden glove,
 * whose leaderboard is clubs, because a conceded column cannot name the
 * keeper who earned it. So the boot and player of the tournament start from
 * their leaderboards, and the glove starts empty with the conceded table one
 * tap away as guidance.
 *
 * Gated on the final being over. Hiding the panel is cosmetic: set_trophy()
 * checks the organiser role in the database, which is the real gate.
 */
function trophySection(boards, teamsArr, ms) {
  if (!state.admin || state.role !== 'organiser') return '';
  if (!M.finalComplete(ms)) return '';
  return `<div class="sect">Confirm trophies</div>
    <p class="note" style="padding-top:0">The final is over, so the trophies can be
      presented. Add or remove names before confirming \u2014 one winner is the norm,
      sharing is the fallback. Confirming again replaces that trophy's winners.</p>
    ${M.TROPHIES.map(([key, label]) => trophyPanel(key, label, boards, teamsArr)).join('')}`;
}

/** The working set for one trophy: whatever is already confirmed, else the
 *  computed leaders \u2014 except the glove, which nothing can compute. */
function trophyPick(key, boards) {
  state.trophyPick ??= {};
  if (state.trophyPick[key]) return state.trophyPick[key];
  const already = state.trophies[key];
  if (already?.length) return (state.trophyPick[key] = [...already]);
  if (key === 'golden_glove') return (state.trophyPick[key] = []);
  return (state.trophyPick[key] = M.leaders(boards[key]).map(r => r.item.id));
}

/** Which club's squad a picker opens on: for the glove the club that
 *  conceded fewest, for the others the club of whoever leads. */
function trophyDefaultTeam(key, boards, teamsArr) {
  const glove = (boards.golden_glove || [])[0]?.item.team.id;
  if (key === 'golden_glove') return glove ?? teamsArr[0]?.id ?? null;
  return (boards[key] || [])[0]?.item.team ?? glove ?? teamsArr[0]?.id ?? null;
}

function trophyPanel(key, label, boards, teamsArr) {
  const chosen = trophyPick(key, boards);
  state.trophyTeam ??= {};
  const openTeam = state.trophyTeam[key] ?? trophyDefaultTeam(key, boards, teamsArr);

  const chips = chosen.length
    ? chosen.map(id => {
        const nm = playerName(id) ?? 'Unknown player';
        return `<span class="tchip">${esc(nm)}
          <button data-trophy-remove="${key}:${id}"
            aria-label="Remove ${esc(nm)} from ${esc(label.toLowerCase())}">\u00d7</button></span>`;
      }).join('')
    : '<span class="tnone">No winner chosen yet</span>';

  const clubs = teamsArr.map(t =>
    `<button class="${openTeam === t.id ? 'on' : ''}" data-trophy-team="${key}:${t.id}">${esc(t.city)}</button>`
  ).join('');

  // Every player is rendered, not only the open club's, because the search
  // has to reach a keeper at another club and cannot ask for a repaint to get
  // there: render() deliberately refuses to paint over a focused input. So
  // both the club chips and the search work by showing and hiding rows that
  // are already in the DOM.
  const rows = state.players.map(p => `<button class="pk ${chosen.includes(p.id) ? 'on' : ''}"
      data-trophy-add="${key}:${p.id}" data-club="${p.team}"${p.team === openTeam ? '' : ' style="display:none"'}>
      ${p.no != null ? `<span class="no tnum">${p.no}</span>` : '<span class="no"></span>'}
      <span style="flex:1">${esc(p.name)}</span>
      <span class="pstat">${esc(cityOf(p.team))}</span></button>`).join('');

  return `<div class="picker trophy">
      <div class="pkhd"><span>${esc(label)}</span>
        <button data-award="${key}">Leaderboard</button></div>
      <div class="tchips">${chips}</div>
      <div class="dqlist tclubs">${clubs}</div>
      <input class="tpq" type="search" placeholder="Search all players" autocomplete="off"
        autocapitalize="none" spellcheck="false" style="margin-bottom:9px">
      <div class="pklist" data-club="${openTeam}">${rows}</div>
      <button class="act" data-trophy-confirm="${key}" ${chosen.length ? '' : 'disabled'}>
        ${(state.trophies[key] || []).length ? 'Update' : 'Confirm'} ${esc(label.toLowerCase())}</button>
    </div>`;
}

/* ── admin sign in ───────────────────────────────────────── */
/**
 * Matchday is the public face of the app now, so the switcher is no longer
 * offered to spectators: it appears only once someone is signed in, either
 * role. The other four themes stay in themes.css deliberately \u2014 a working
 * fallback one tap away is worth its bytes two weeks before a live event,
 * and none of them costs anything until it is selected.
 */
function appearanceSection() {
  const btns = THEMES.map(([v, label]) =>
    `<button class="${theme === v ? 'on' : ''}" data-theme-set="${v}">${label}</button>`).join('');
  return `<div class="sect">Appearance</div>
    <p class="note" style="padding-top:0">Matchday is what the public sees. The others are
      kept as a fallback and apply to this device only.</p>
    <div class="themes">${btns}</div>`;
}

/**
 * Who to ask about a player's name on this site.
 *
 * ⟨FILL THIS IN⟩ — set it to the association's safeguarding or data contact
 * once Adam supplies one, e.g.
 *   const SAFEGUARDING_CONTACT = { name: 'COFTA safeguarding lead',
 *                                  email: 'safeguarding@example.org' };
 *
 * Left null deliberately rather than filled with a plausible-looking address:
 * a privacy notice naming a mailbox nobody reads is worse than one that sends
 * people to a human who is actually at the venue. The notice below reads
 * correctly either way.
 */
const SAFEGUARDING_CONTACT = null;

/**
 * WHAT THIS SITE PUBLISHES ABOUT PLAYERS, said plainly to the people it is
 * about rather than buried in a policy nobody opens.
 *
 * The tournament is 16+, so some players are children in UK safeguarding
 * terms — a child is anyone under 18, whatever else a 16-year-old may consent
 * to. The site names them, alongside their club and the venue and time they
 * will be there, so it owes them a straight account of that and a way to ask
 * to be taken off it.
 *
 * `players.active = false` already removes a player from every surface,
 * including past results. The mechanism existed; what was missing was telling
 * anybody it did.
 */
function privacySection() {
  const ask = SAFEGUARDING_CONTACT
    ? `<b>${esc(SAFEGUARDING_CONTACT.name)}</b>${SAFEGUARDING_CONTACT.email
        ? ` — <a href="mailto:${esc(SAFEGUARDING_CONTACT.email)}">${esc(SAFEGUARDING_CONTACT.email)}</a>` : ''}`
    : 'your club’s team contact, or any organiser at the venue';

  return `<div class="sect">Players’ names on this site</div>
    <p class="note" style="padding-top:0">This site shows each player’s
      <b>name, shirt number and club</b>, and the goals, cards and awards recorded
      against them during the tournament. It is there so spectators can follow the
      matches.</p>
    <ul class="plist">
      <li><b>Anyone with the link can see it.</b> There is no sign-in for
        spectators. It is kept out of Google and other search engines.</li>
      <li><b>No photographs</b>, dates of birth, addresses, phone numbers or email
        addresses are collected about any player, and players have no accounts.</li>
      <li><b>Results are kept as a permanent record</b> of the tournament, the way
        a printed programme would be.</li>
      <li><b>You can ask not to be listed.</b> A player removed at their own or a
        parent’s request disappears from the squad list, the match reports and
        the leaderboards, including past matches.</li>
    </ul>
    <p class="note" style="padding-top:2px">To ask for a name to be removed, or
      about anything on this page, speak to ${ask}.</p>`;
}

function viewAdmin() {
  if (state.admin) {
    const resetSection = state.role === 'organiser' ? `
      <div class="sect">Testing</div>
      <p class="note" style="padding-top:0">Wipes every score, event, card, shoot-out and override,
        and returns all fixtures to scheduled. Clubs and squads are kept. Organiser accounts only.</p>
      <button class="act ghost" data-reset="1" style="color:var(--acc);
        box-shadow:inset 0 0 0 1px var(--acc)">Reset tournament data</button>` : '';
    return `<div class="sect">Signed in</div>
      <p class="note" style="padding-top:0">${state.role === 'organiser'
        ? 'Organiser account: full access, including the tools below.'
        : 'Pitch account: run matches, log events, enter shoot-outs.'}
        Open any match and the controls appear inline.</p>
      <button class="act ghost" id="signout">Sign out</button>
      ${notifySection()}${appearanceSection()}${squadSection()}${resetSection}${privacySection()}`;
  }
  return `${notifySection()}${privacySection()}
    <div class="sect">Organiser sign in</div>
    <p class="note" style="padding-top:0">Spectators never need this. Sign in with the username
      and password you were given \u2014 one account per pitch.</p>
    <div class="form">
      <div><label for="em">Username</label><input id="em" type="text" autocomplete="username"
        autocapitalize="none" spellcheck="false" placeholder="pitch1"></div>
      <div><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"></div>
      <button class="act" id="signin">Sign in</button>
      <p class="err" id="autherr"></p>
    </div>`;
}

/**
 * Squad entry. Paste one player per line — an optional shirt number first,
 * so both of these work:
 *     7 Andrew Ramzy
 *     Andrew Ramzy
 * Lines already in the squad are skipped, so pasting the same list twice
 * cannot create duplicates. The 23-man cap is enforced server-side.
 */
function parseSquadLines(text) {
  return String(text || '').split(/\r?\n/)
    .map(l => l.trim()).filter(Boolean)
    .map(l => {
      const m = /^(\d{1,2})[\s.\-\u2013]+(.+)$/.exec(l);
      return m ? { no: Number(m[1]), name: m[2].trim() }
               : { no: null, name: l };
    })
    .filter(p => p.name.length > 1 && p.name.length <= 60);
}

function squadSection() {
  const teamsArr = Object.values(state.teams);
  if (!teamsArr.length) return '';

  const chips = teamsArr.map(t => {
    const n = squadOf(t.id).length;
    return `<button class="${state.squadTeam === t.id ? 'on' : ''}" data-squad="${t.id}">
      ${esc(t.city)} \u00b7 ${n}</button>`;
  }).join('');

  let editor = '';
  if (state.squadTeam) {
    const t = team(state.squadTeam);
    const squad = squadOf(state.squadTeam);
    const rows = squad.map(p => `<li>
        <span class="no tnum">${p.no ?? ''}</span>
        <span class="nmx">${esc(p.name)}</span>
        <button class="undo" data-delplayer="${p.id}">Remove</button></li>`).join('');
    editor = `
      <p class="note" style="padding-top:10px"><b>${esc(t.name)}</b> (${esc(t.city)}) \u2014
        ${squad.length} of 23. Paste one player per line; a shirt number first is
        optional, like <i>7 Andrew Ramzy</i>. Repeated names are skipped.</p>
      ${squad.length ? `<ul class="squad">${rows}</ul>` : ''}
      <div class="form" style="padding-top:10px">
        <textarea id="sqin" rows="6" placeholder="7 Andrew Ramzy&#10;Mina Gerges&#10;\u2026"></textarea>
        <button class="act" data-addsquad="1">Add players</button>
        <p class="okmsg" id="sqmsg"></p>
        <div style="padding-top:8px"><label for="mgrin">Manager</label>
          <input id="mgrin" value="${esc(t.manager ?? '')}" placeholder="Manager name"
            autocomplete="off" spellcheck="false"></div>
        <button class="act ghost" data-setmgr="1">Save manager</button>
      </div>`;
  }

  return `<div class="sect">Squads</div>
    <p class="note" style="padding-top:0">Squad lists unlock goalscorers, the golden boot
      and suspensions. Tap a club to enter or edit its squad.</p>
    <div class="dqlist">${chips}</div>${editor}`;
}

/* ── History: previous tournaments ───────────────────────── */
/**
 * Six competitions, not one series that kept changing its name. COFTA,
 * CONAFA, COSTA and The Ark Cup are men's; COSA and Ladies COFTA are
 * women's. Confirmed by Adam, and worth stating because COSA / COSTA /
 * Ladies COFTA look like the same event misspelt and are not.
 *
 * The archive is immutable and never rides in the polled snapshot — it is
 * fetched on demand from the archive_* tables and cached hard (see api.js).
 */
/**
 * `host` is the church that runs the competition, organiser-confirmed, given
 * as the archive registry's short_name and resolved to a canonical name and a
 * link at render time. It belongs to the competition rather than to any one
 * edition — a host club that stood down for a year would be an edition-level
 * `notes.host_club`, which CONAFA 2015 and 2016 already carry.
 */
/**
 * `full` is what the acronym stands for, `host` the church that runs it, and
 * `diocese` the diocese it is played in — all organiser-confirmed.
 *
 * Two competitions have no `full` recorded: the Ark Cup, which is not an
 * acronym, and Ladies COFTA. Neither borrows another competition's
 * association name; see mastheadBrand().
 */
const COMPS = [
  { id: 'cofta',  name: 'COFTA',  cat: 'men',   host: 'Stevenage',  diocese: 'london',
    full: 'Coptic Orthodox Football Tournament Association' },
  { id: 'conafa', name: 'CONAFA', cat: 'men',   host: 'Nottingham', diocese: 'midlands',
    full: 'Coptic Orthodox National Annual Football Association' },
  { id: 'costa',  name: 'COSTA',  cat: 'men',   host: 'Croydon',    diocese: 'london',
    full: 'Coptic Orthodox Southern Tournament Association' },
  { id: 'ark',    name: 'The Ark Cup', cat: 'men', host: 'Golders Green', diocese: 'london' },
  { id: 'cosa',   name: 'COSA',   cat: 'women', host: 'SMPK',       diocese: 'london',
    full: 'Coptic Orthodox Soccer Association' },
  // Ladies COFTA is COFTA's women's competition, so it is the same
  // association under the same name — not a separate body that happens to
  // sound similar, which is how CONAFA, COSTA and COSA each differ.
  { id: 'ladies-cofta', name: 'Ladies COFTA', cat: 'women', host: 'Stevenage', diocese: 'london',
    full: 'Coptic Orthodox Football Tournament Association' },
];

/**
 * Whose crest and whose bishop belong at the top of the page. Every
 * competition names its diocese explicitly rather than falling through to a
 * default: a host church happening to be in London is not the same statement
 * as the competition running under that diocese, and only one of those is
 * something anyone has actually confirmed.
 */
const DIOCESES = {
  london: {
    name: 'Coptic Orthodox Diocese of London',
    auspices: 'Under the Auspices of HE Archbishop Angaelos',
    logo: './diocese.webp',
  },
  midlands: {
    name: 'Coptic Orthodox Diocese of the Midlands',
    auspices: 'Under the Auspices of HG Bishop Missael',
    logo: './diocese-midlands.webp',
  },
};
/** The live weekend is COFTA's, so that is the masthead off any archive page. */
const LIVE_COMP = 'cofta';

/**
 * A competition's own badge, where one exists.
 *
 * Ladies COFTA has no file: it is COFTA's women's competition under the same
 * association and the same badge, so it reads cofta.webp rather than a
 * duplicate that could drift. COSTA has no badge at all.
 */
const COMP_LOGO = {
  cofta: './comps/cofta.webp',
  'ladies-cofta': './comps/cofta.webp',
  conafa: './comps/conafa.webp',
  cosa: './comps/cosa.webp',
  ark: './comps/ark.webp',
};

/**
 * And a generic trophy for one that has none — today only COSTA.
 *
 * THIS REVERSES THE EARLIER RULE, at the organiser's call. COSTA's card used
 * to keep the original three-column grid so the absence read as deliberate
 * rather than as a badged card with a hole in it. In a list it did not read
 * that way: five cards with a mark and one without reads as the one that
 * failed to load, which is the opposite of the honesty the rule was for.
 *
 * IT IS STILL NOT INVENTED BRANDING, and the distinction is the whole reason
 * this is a drawn glyph rather than an image file. It is the SAME neutral
 * trophy whoever it stands for, so it cannot be mistaken for a badge someone
 * designed; it simply takes the competition's own identity colour, which
 * `[data-comp]` already gives every competition, so the row reads as a set.
 * The moment a real COSTA badge arrives it goes in COMP_LOGO above and this
 * disappears on its own.
 */
const COMP_TROPHY = `<svg class="clogo generic" viewBox="0 0 24 24" aria-hidden="true"
  focusable="false" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M7.5 3.5h9V8a4.5 4.5 0 0 1-9 0V3.5Z"/>
  <path d="M7.5 5.2H5.4a2.6 2.6 0 0 0 2.4 3.3"/>
  <path d="M16.5 5.2h2.1a2.6 2.6 0 0 1-2.4 3.3"/>
  <path d="M12 12.6v3"/>
  <path d="M8.8 20.5h6.4l-.8-3h-4.8Z"/></svg>`;

const compLogo = (id, size) => COMP_LOGO[id]
  ? `<img class="clogo" src="${COMP_LOGO[id]}" alt="" width="${size}" height="${size}"
       onerror="this.style.display='none'">`
  // No size on the trophy: `.clogo` and `.chead.withlogo .clogo` already size
  // the slot, and an inline SVG takes those the same way the <img> does.
  : COMP_TROPHY;
const COMP_SLUG = {
  'COFTA': 'cofta', 'CONAFA': 'conafa', 'COSTA': 'costa',
  'The Ark Cup': 'ark', 'COSA': 'cosa', 'Ladies COFTA': 'ladies-cofta',
};
const compOf = (id) => COMPS.find(c => c.id === id);

/**
 * Historical clubs get a monogram, never invented branding.
 *
 * Clubs that still compete carry `live_team_id` and render the live crest and
 * colours, so a future crest upgrade flows into the archive for free. B teams
 * inherit their parent's identity and add a small "B". Everyone else — the
 * clubs with no 2026 entry — gets initials on a tile whose colour is picked
 * deterministically from one muted, obviously-archival palette. The same club
 * looks the same everywhere, and nothing ever masquerades as a real crest.
 */
const ARCHIVE_TILES = 8;   // .mono-0 … .mono-7 in styles.css

/** Hashed on the row id, which never changes — a name can be corrected. */
function tileIndex(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return h % ARCHIVE_TILES;
}

/** Initials come from the short label, not the church name: half these clubs
 *  are "St Mary & …", so canonical names would collide on "SM". */
function monogramText(t) {
  const src = String(t.short_name || t.city || t.canonical_name || '?');
  const words = src.replace(/[^A-Za-z ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || '?';
  return (w[0] || '?').toUpperCase() + (w[1] || '').toLowerCase();
}

/**
 * Which category the page being looked at is about.
 *
 * Three churches field both a men's and a women's side under one name and one
 * crest each, so a crest cannot be chosen from the club alone — it depends on
 * whose record you are reading. Derived from the view rather than threaded
 * through twenty call sites, and there is exactly one answer per view.
 */
function viewCategory() {
  if (state.view === 'histed') {
    return state.archive?.editions?.find(e => e.id === state.histEd)?.category ?? 'men';
  }
  if (state.view === 'histcomp') return compOf(state.histComp)?.cat ?? 'men';
  if (state.view === 'history')  return state.histCat;
  if (state.view === 'archteam' || state.view === 'squads') return state.cabCat;
  return 'men';
}

/**
 * The badge for an archive club: a supplied crest where there is one, the
 * live club's crest where the club still competes, a monogram tile otherwise.
 * `cat` overrides the page's category, which only the tests need.
 */
function archCrest(t, size = 28, cat = null) {
  if (!t) return `<span class="mono mono-0" style="--mono:${size}px">?</span>`;
  const px = `--mono:${size}px`;
  const d = t.display || {};
  const category = cat ?? viewCategory();

  // A women's crest only on a women's edition. Falls back through the club's
  // own supplied crest, then the live crest, then the monogram — so a church
  // that has not supplied one yet is never blank and never shows the wrong
  // side's badge.
  // A B team inherits the parent's identity, and that has to include the
  // parent's women's crest: St Mark B on a Ladies COFTA page was falling
  // through to the live men's crest, which is the one badge it must not wear.
  const parent = t.parent_club && t.live_team_id ? archiveTeamForLive(t.live_team_id) : null;
  const pd = parent?.display || {};
  const supplied = (category === 'women' && (d.crest_women || pd.crest_women))
                || d.crest || (parent ? pd.crest : null);
  const live = t.live_team_id && CREST[t.live_team_id];
  const src = supplied || live;
  if (src) {
    // A supplied file that has not landed yet falls back to the live crest
    // rather than rendering a broken image.
    const onerr = supplied && live
      ? ` onerror="this.onerror=null;this.src='${live}'"` : '';
    return `<span class="acrest" style="${px}"><img src="${src}" alt=""`
      + ` width="${size}" height="${size}"${onerr}>`
      + (t.parent_club ? `<i class="bteam">B</i>` : '') + `</span>`;
  }
  // A confirmed colour is data on the row, not something derived here: the
  // same mechanism a real crest would arrive through. Only clubs without one
  // fall back to the hashed palette, which stays deliberately muted so an
  // unassigned club never looks like it has branding it does not have.
  if (d.colour) {
    const ring = d.ring ? `;--ring:${d.ring}` : '';
    return `<span class="mono set${d.ring ? ' ringed' : ''}" style="${px};`
      + `--tile:${d.colour};--ink:${d.text_colour || '#fff'}${ring}">${esc(monogramText(t))}`
      + (t.parent_club ? `<i class="bteam">B</i>` : '') + `</span>`;
  }
  return `<span class="mono mono-${tileIndex(t.id)}" style="${px}">${esc(monogramText(t))}`
    + (t.parent_club ? `<i class="bteam">B</i>` : '') + `</span>`;
}

const archTeam = (id) => state.archive?.teamById?.[id] ?? null;

/**
 * The small line under a club's name on its cabinet.
 *
 * Liverpool & Bolton is the one row in the archive with no single church
 * name — it is a joint side of two churches — so it names both here rather
 * than pretending to be either. Stacking them on the primary line instead
 * would run to 45 characters and truncate on a fixture row.
 */
function archSubtitle(t) {
  const joint = t.display?.joint;
  if (Array.isArray(joint) && joint.length) {
    return 'Joint team — '
      + joint.map(c => `${c.name}, ${c.city}`).join(' and ');
  }
  return t.parent_club ? `B team of ${t.parent_club}` : 'Archive record';
}

/**
 * A club's name for display, and the ONLY way History is allowed to render
 * one.
 *
 * Every name comes from archive_teams, never from the alias string the
 * edition's source happened to use — the same club is recorded as "Hounslow",
 * "Pope Kyrillos, Hounslow", "SMPK" and "St Mary & Pope Kyrillos VI" across
 * five editions, and a reader should not have to work out that those are one
 * club. Match, event, standing and leaderboard rows all carry a team_id
 * precisely so the name can be looked up rather than quoted.
 *
 * The name is the FULL church name and nothing else; the city is a separate
 * column and renders as its own demoted line. `short_name` is not a display
 * string — it survives only as the monogram's initials, because half these
 * clubs are "St Mary & …" and canonical names would collide on "SM".
 */
const archLabel = (id) => archTeam(id)?.canonical_name ?? 'Unknown club';
const archCity  = (id) => archTeam(id)?.city ?? '';

/**
 * The name with its B marker. A B team shows the parent's crest, so without
 * this the two sides of a club are indistinguishable anywhere a name appears
 * without one. Returns escaped HTML.
 */
const archTeamName = (id) => {
  const t = archTeam(id);
  const label = archLabel(id);
  // Every B team's canonical name already ends in a B, so the tag would be a
  // second one. Kept as a guard for any future row that does not.
  const saysItAlready = /\bB\)?$/.test(label);
  return esc(label)
    + (t?.parent_club && !saysItAlready ? '<i class="btag" title="B team">B</i>' : '');
};

/**
 * A club, as a real button through to its cabinet.
 *
 * Two lines, always: the full church name, then the city small underneath —
 * the same shape `clubBlock` uses on the live pages, so a club looks the same
 * whichever half of the app you are in. A `<button>`, not a div, because a div
 * with a handler cannot be reached by keyboard and announces nothing.
 */
const archTeamLink = (id, { crest = 0, away = false, inline = false } = {}) => {
  const t = archTeam(id);
  if (!t) return `<span class="tlink dead"><span class="who"><b>Unknown club</b></span></span>`;
  const city = archCity(id);

  // Where the club is itself secondary — the small line under a player's name
  // on a leaderboard — a stacked block would out-shout the player. There the
  // same two facts run on one line, still name first and city demoted.
  if (inline) {
    return `<button class="tlink inline" data-archteam="${esc(t.id)}">`
      + `<b>${archTeamName(id)}</b>`
      + (city ? `<span>${esc(city)}</span>` : '') + '</button>';
  }

  const badge = crest ? archCrest(t, crest) : '';
  const who = `<span class="who"><b>${archTeamName(id)}</b>`
    + (city ? `<i>${esc(city)}</i>` : '') + '</span>';
  return `<button class="tlink${away ? ' away' : ''}" data-archteam="${esc(t.id)}">`
    + (away ? who + badge : badge + who) + '</button>';
};


/** "12–13 September 2026", or a single day where start and end match. */
function archDates(e) {
  if (!e.date_start) return '';
  const MON = ['January','February','March','April','May','June','July',
               'August','September','October','November','December'];
  const [ys, ms, ds] = e.date_start.split('-').map(Number);
  if (!e.date_end || e.date_end === e.date_start) return `${ds} ${MON[ms - 1]} ${ys}`;
  const [ye, me, de] = e.date_end.split('-').map(Number);
  if (ys === ye && ms === me) return `${ds}–${de} ${MON[ms - 1]} ${ys}`;
  return `${ds} ${MON[ms - 1]} – ${de} ${MON[me - 1]} ${ye}`;
}

/* ── loading ─────────────────────────────────────────────── */
/**
 * History is the only part of the app that fetches on demand. Everything
 * else lives off the 5-second snapshot; putting 99 matches and 260 events in
 * that payload would cost the weekend's egress budget for data that has not
 * changed since 2022.
 *
 * A FAILED READ IS NOT RETRIED UNTIL SOMEONE ASKS.
 *
 * Every History view calls this at the top of its render, and this calls
 * render() when it settles. Without the `archiveErr` guard a failure is a hot
 * loop: render → fetch → reject → render → fetch, bounded only by how fast
 * the request fails. Offline, a fetch rejects immediately, so it is bounded
 * by nothing — it pins the phone and hammers the radio, on exactly the dead
 * signal that caused it. Found by loading History cold with the archive
 * endpoints refused; it wedged the whole browser.
 *
 * So a failure sticks until the reader taps "Try again", which clears it.
 */
function loadArchive() {
  if (state.archive || state.archiveBusy || state.archiveErr) return;
  state.archiveBusy = true;
  api.fetchArchiveIndex().then(a => {
    state.archive = {
      ...a,
      teamById: Object.fromEntries(a.teams.map(t => [t.id, t])),
      byComp: a.editions.reduce((m, e) => {
        const slug = COMP_SLUG[e.competition];
        (m[slug] = m[slug] || []).push(e);
        return m;
      }, {}),
    };
    state.archiveErr = null;
  }).catch(e => { state.archiveErr = e.message; })
    .finally(() => { state.archiveBusy = false; render(); });
}

/** Same rule as loadArchive, per edition: one failure, then it waits to be
 *  asked again. Keyed by id, so a single unreachable edition does not stop
 *  the others from loading. */
function loadEdition(id) {
  if (state.archiveEd[id] || state.archiveEdBusy === id || state.archiveEdErr[id]) return;
  state.archiveEdBusy = id;
  api.fetchArchiveEdition(id).then(d => {
    state.archiveEd[id] = d;
    state.archiveErr = null;
    delete state.archiveEdErr[id];
  }).catch(e => { state.archiveErr = e.message; state.archiveEdErr[id] = e.message; })
    .finally(() => { state.archiveEdBusy = null; render(); });
}

const archLoading = (what) =>
  `<p class="empty">Loading ${esc(what)}…</p>`;
const archFailed = () =>
  `<div class="banner warn">Could not load the archive: ${esc(state.archiveErr)}.
     Previous tournaments need a connection the first time they are opened;
     after that they are kept on this device.
     <button class="retry" data-archretry="1">Try again</button></div>`;

/* ── the three History pages ─────────────────────────────── */
function viewHistory() {
  loadArchive();
  if (state.archiveErr && !state.archive) return archFailed();
  if (!state.archive) return archLoading('previous tournaments');

  const cat = state.histCat;
  const toggle = `<div class="seg" role="group" aria-label="Category">
    ${['men', 'women'].map(c => `<button data-histcat="${c}" class="${cat === c ? 'on' : ''}"
        aria-pressed="${cat === c}">${c === 'men' ? 'Men' : 'Women'}</button>`).join('')}
  </div>`;

  // Most-contested competition first. COFTA's nineteen editions should not sit
  // level with a competition that has been played once, and the order is
  // derived rather than hard-coded so it stays true as editions are added —
  // the array order was only coincidentally right for the men's side and
  // already wrong for the women's.
  //
  // Ties break on the older competition, which is the same idea measured a
  // different way: a competition that has been running longer outranks a
  // newer one on the same count. Name last, so the order is never arbitrary.
  const seasoned = (a, b) => {
    const ea = state.archive.byComp[a.id] || [], eb = state.archive.byComp[b.id] || [];
    if (eb.length !== ea.length) return eb.length - ea.length;
    const first = (e) => e.length ? Math.min(...e.map(x => x.year)) : Infinity;
    return (first(ea) - first(eb)) || a.name.localeCompare(b.name);
  };

  const cards = COMPS.filter(c => c.cat === cat).sort(seasoned).map(c => {
    const eds = state.archive.byComp[c.id] || [];
    if (!eds.length) return '';
    const years = eds.map(e => e.year);
    const span = years.length === 1 ? `${years[0]}`
      : `${Math.min(...years)}–${Math.max(...years)}`;
    // Who holds it, not merely who won last: they keep it until the next
    // edition is played. Taken from the model rather than eds[0], so the
    // label cannot quietly depend on the order the rows arrived in, and an
    // edition whose champion was never recorded is skipped rather than shown
    // as "Unknown".
    const holder = M.reigningChampion(eds);
    // The badge sits with the name, not instead of it — every badge here has
    // its own name set into the artwork, too small to read at this size. Every
    // card carries a mark now; COSTA's is the generic trophy (see COMP_TROPHY),
    // because a single unbadged card in a list reads as one that failed.
    return `<button class="ccard badged"
        data-histcomp="${c.id}" data-comp="${c.id}">
      ${compLogo(c.id, 34)}
      <span class="cch">
        <span class="ccn">${esc(c.name)}</span>
        <span class="ccm">${eds.length} ${eds.length === 1 ? 'edition' : 'editions'} &middot; ${span}</span>
      </span>
        <!-- plain text and an image, not a link: the whole card is already a
             button, and a button inside a button is invalid HTML (see
             CLAUDE.md). The crest is an <img>, so it nests fine. Category is
             passed explicitly rather than left to viewCategory(): the men's
             and women's cards are built by the same loop. -->
      <span class="ccl">${holder ? 'Reigning champion' : 'Champion'}
        <span class="cclw">
          ${holder ? archCrest(archTeam(holder.teamId), 22, c.cat) : ''}
          <b>${holder ? archTeamName(holder.teamId) : 'Not recorded'}</b>
        </span>
        ${holder ? `<span class="ccy">${holder.year}</span>` : ''}</span>
      <span class="chev" aria-hidden="true"></span>
    </button>`;
  }).join('');

  // No preamble apologising for the archive's coverage. It led with a caveat
  // about record quality before showing a single tournament, which is the
  // importer's concern rather than the reader's — they came to look up a
  // winner. Sparse editions are self-evidently sparse when opened.
  return `<div class="sect">Previous tournaments</div>
    ${toggle}
    <div class="ccards">${cards || '<p class="empty">No tournaments recorded.</p>'}</div>`;
}

function viewHistComp() {
  loadArchive();
  if (state.archiveErr && !state.archive) return archFailed();
  if (!state.archive) return archLoading('previous tournaments');

  const c = compOf(state.histComp);
  const eds = state.archive.byComp[state.histComp] || [];
  // A tournament whose winner nobody recorded still happened. COFTA 2007 and
  // 2008 are the cases: an empty crest cell would read as a rendering fault
  // and invite someone to "fix" it by guessing, so the row says outright that
  // the champion is not recorded.
  const rows = eds.map(e => `<button class="edrow" data-histed="${esc(e.id)}">
      <span class="edy">${e.year}</span>
      <span class="edm">
        <b>${esc(e.display_name)}</b>
        <span class="edd">${esc(archDates(e))}${e.venue ? ' &middot; ' + esc(e.venue) : ''}</span>
      </span>
      <span class="edw">${e.champion_team_id
        ? archCrest(archTeam(e.champion_team_id), 24)
        : '<i class="nowin">Champion not recorded</i>'}</span>
      <span class="chev" aria-hidden="true"></span>
    </button>`).join('');

  // Who has won it, most titles first. A competition is single-category by
  // definition, so no gender filter belongs here — every edition in `eds` is
  // already the right side.
  const champs = M.champions(eds);
  const holder = M.reigningChampion(eds);
  // A thin edition is absent from the list rather than counted as a win by
  // nobody — say so, or the titles above look like they should sum to the
  // edition count and do not.
  const unknown = eds.filter(e => !e.champion_team_id).length;
  const missing = unknown
    ? `<p class="note">${unknown} ${unknown === 1 ? 'edition has' : 'editions have'} no
       champion recorded, so ${unknown === 1 ? 'it is' : 'they are'} not counted above.</p>`
    : '';

  const honours = champs.length ? `<div class="sect">Champions</div>
    <div class="champrows">${champs.map(r => `<div class="champrow">
      <div class="champtop">
        ${archTeamLink(r.teamId, { crest: 30 })}
        <b class="champn tnum" title="${r.titles} ${r.titles === 1 ? 'title' : 'titles'}"
          >${r.titles}</b>
      </div>
      <div class="champyrs">${r.years.map(y =>
        `<span class="cyr${holder && holder.teamId === r.teamId && holder.year === y
          ? ' now' : ''}">${y}</span>`).join('')}</div>
    </div>`).join('')}</div>${missing}`
    : '';

  // Two facts about a competition's beginning, and they pull opposite ways.
  // An edition that IS the first says so. A competition whose start is simply
  // unknown must say THAT, or the oldest row the archive happens to hold gets
  // read as the first tournament ever played — which for COSTA it is not.
  const years = eds.map(e => e.year);
  const span = years.length
    ? (years.length === 1 ? `${years[0]}`
       : `${Math.min(...years)}–${Math.max(...years)}`)
    : '';

  const first = eds.find(e => e.notes?.inaugural);
  const originsUnknown = eds.map(e => e.notes?.origins_unrecorded).find(Boolean);
  // "The first The Ark Cup" — one competition carries its own article, so the
  // sentence has to borrow the name's rather than add a second.
  const compName = c?.name ?? '';
  const origins = first
    ? `<p class="note" style="padding-top:0">${/^The /.test(compName)
         ? `${esc(compName)} was first played in`
         : `The first ${esc(compName)} was played in`} ${first.year}.</p>`
    : originsUnknown
      ? `<p class="note" style="padding-top:0">${esc(originsUnknown)}</p>`
      : '';

  // Whose tournament this is. Resolved through the registry so the host reads
  // as its full church name and opens that club's record, rather than being a
  // second place where a club's name is spelt out by hand.
  const hostTeam = c?.host
    ? (state.archive.teams || []).find(t => t.short_name === c.host && !t.parent_club)
    : null;
  const host = hostTeam
    ? `<p class="chost">Hosted by ${archTeamLink(hostTeam.id, { inline: true })}</p>` : '';

  // No <h2> here: the masthead carries the competition's name on this view,
  // and repeating it two lines below is just the same words twice.
  return `${backButton('view:history')}
    <div class="chead bare withlogo"
         data-comp="${esc(state.histComp)}">
      ${compLogo(state.histComp, 46)}
      <p>${eds.length} ${eds.length === 1 ? 'edition' : 'editions'} &middot;
         ${c?.cat === 'women' ? "Women's" : "Men's"}${span ? ' &middot; ' + span : ''}</p>
    </div>
    ${host}
    ${origins}
    ${honours}
    <div class="sect">Editions</div>
    <div class="edrows">${rows || '<p class="empty">No editions recorded.</p>'}</div>`;
}

/** A thin edition: dates, champion, runner-up, the final line if known, and
 *  the entrant list. No empty tables and no zero-filled stats — eight of the
 *  thirteen editions genuinely have nothing more than this. */
function thinEdition(e) {
  const entrants = (state.archive.entrants || [])
    .filter(x => x.edition_id === e.id)
    .map(x => archTeam(x.team_id)).filter(Boolean)
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
  const fin = e.notes?.final || {};
  return `<div class="thincard">
      <div class="tcwin">
        ${e.champion_team_id ? archCrest(archTeam(e.champion_team_id), 44) : ''}
        <div>${e.champion_team_id
          ? archTeamLink(e.champion_team_id)
          : '<b>Champion not recorded</b>'}
          <span>Champions</span></div>
      </div>
      ${e.runner_up_team_id ? `<div class="tcrun">
        ${archCrest(archTeam(e.runner_up_team_id), 28)}
        <div>${archTeamLink(e.runner_up_team_id)}<span>Runners-up</span></div></div>` : ''}
      ${e.final_summary ? `<p class="tcfin">${esc(e.final_summary)}</p>` : ''}
      ${fin.decided_by === 'penalties' && fin.shootout
        && (fin.shootout.winner_score ?? fin.shootout.home) == null
        ? '<p class="tcnote">The shoot-out score is not recorded.</p>' : ''}
      ${entrants.length ? `<div class="sect">Entrants</div>
        <div class="entrants">${entrants.map(t =>
          `<span class="ent">${archTeamLink(t.id, { crest: 22 })}</span>`).join('')}</div>
        ${e.notes?.teams_note ? `<p class="note">${esc(e.notes.teams_note)}</p>` : ''}` : ''}
      <p class="thinnote">Limited records survive for this edition.</p>
    </div>`;
}

function archTable(d, g) {
  const rows = d.standings.filter(s => s.group_id === g.id);
  if (!rows.length) return '';
  // The Ark Cup published GD and Pts only. Its GF/GA were computed by the
  // compiler from the fixture list, so they are shown in a muted column and
  // labelled, never passed off as source data.
  const derived = rows.some(r => r.gf == null && r.gf_derived != null);
  // Ten columns do not fit a 320px phone. Without the scroller the table is
  // clipped rather than scrollable, so Pts — the column the reader came for —
  // is simply unreachable on the smallest screens. The wrapper scrolls the
  // table inside itself and leaves the page body alone.
  return `<div class="sect">${esc(g.name)}</div>
    <div class="tscroll"><table class="tbl arch"><thead><tr>
      <th class="pos"></th><th class="tm">Club</th><th>P</th><th>W</th><th>D</th><th>L</th>
      <th class="${derived ? 'drv' : ''}">GF</th><th class="${derived ? 'drv' : ''}">GA</th>
      <th>GD</th><th class="pts">Pts</th></tr></thead><tbody>
    ${rows.map(r => {
      const t = archTeam(r.team_id);
      return `<tr>
        <td class="pos">${r.position}</td>
        <td class="tm">${archTeamLink(r.team_id, { crest: 20 })}
          ${r.note ? `<i class="gapdot" title="${esc(r.note)}">*</i>` : ''}</td>
        <td>${r.p ?? '–'}</td><td>${r.w ?? '–'}</td>
        <td>${r.d ?? '–'}</td><td>${r.l ?? '–'}</td>
        <td class="${derived ? 'drv' : ''}">${r.gf ?? r.gf_derived ?? '–'}</td>
        <td class="${derived ? 'drv' : ''}">${r.ga ?? r.ga_derived ?? '–'}</td>
        <td>${r.gd ?? '–'}</td><td class="pts">${r.pts ?? '–'}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    ${derived ? `<p class="note">GF and GA were not displayed in the source table;
      these are computed from the fixture list and reconcile exactly to the published GD.</p>` : ''}
    ${rows.some(r => r.note) ? rows.filter(r => r.note).map(r =>
      `<p class="note">* ${archTeamName(r.team_id)}: ${esc(r.note)}</p>`).join('') : ''}`;
}

const STAGE_LABEL = {
  group: 'Group stage', league: 'League fixtures', play_off: 'Play-off',
  quarter_final: 'Quarter-finals', semi_final: 'Semi-finals', final: 'Final',
};

function archFixtures(d) {
  const order = ['group', 'league', 'play_off', 'quarter_final', 'semi_final', 'final'];
  const byStage = order.filter(s => d.matches.some(m => m.stage === s));
  return byStage.map(stage => {
    const ms = d.matches.filter(m => m.stage === stage);
    return `<div class="sect">${esc(STAGE_LABEL[stage] ?? stage)}</div>
      <div class="afx">${ms.map(m => archFixtureRow(m, d)).join('')}</div>`;
  }).join('');
}

/**
 * A RESULT THAT IS NOT A FIXTURE.
 *
 * Ten matches in the archive record who won and who lost and never which way
 * round they were printed. Rendering those through the fixture row above would
 * assert an orientation the source never gave — a fixture row's left-hand side
 * IS the home side, that is what the layout means — so they get their own
 * shape, and it is deliberately sentence-like rather than scoreboard-like:
 *
 *     St Mark, Kensington
 *          beat
 *     St Mary & St Shenouda, Croydon        1–0
 *
 * The word carries the meaning and position carries none, which is the exact
 * inverse of the row above and the reason they cannot share one.
 *
 * A SCORE IS PRINTED ONLY IF THERE IS ONE. Several of these have a winner and
 * no scoreline at all, and CONAFA 2016's two are reported as "won by one goal"
 * — a margin, which is shown as a margin and must never become 1–0.
 *
 * `winner_team_id` is used, never `notes.winner`: that string is a `short_name`
 * and short names are not display strings (see the naming rule). The id is what
 * lets these link to the club like every other mention in History.
 */
function archResultRow(m) {
  const score = m.notes?.score;
  const margin = m.notes?.margin;
  const pens = m.decided_by === 'penalties';
  // "beat" needs someone to have been beaten. COFTA 2010's second semi-final
  // names Rotherham and never their opponent, so it says what is known and
  // stops; the gap note underneath explains the rest.
  const verb = m.loser_team_id ? 'beat' : 'won';
  const detail = [
    score ? esc(score) : '',
    margin && !score ? `by ${esc(margin)}` : '',
    pens ? 'on penalties' : '',
  ].filter(Boolean).join(' · ');

  return `<div class="afxr res">
    <div class="ares">
      <div class="awin">${archTeamLink(m.winner_team_id, { crest: 22 })}</div>
      <span class="abeat">${verb}</span>
      ${m.loser_team_id
        ? `<div class="alose">${archTeamLink(m.loser_team_id, { crest: 22 })}</div>` : ''}
    </div>
    ${detail ? `<p class="aresd">${detail}</p>` : ''}
    ${m.gap_note ? `<p class="afxn">${esc(m.gap_note)}</p>` : ''}
    ${m.notes?.note ? `<p class="afxn">${esc(m.notes.note)}</p>` : ''}
    ${m.notes?.record_note ? `<p class="afxn">${esc(m.notes.record_note)}</p>` : ''}
  </div>`;
}

/**
 * NEVER PUT A BACKTICK IN A COMMENT INSIDE A TEMPLATE LITERAL. An HTML comment
 * documenting the two note fields below was written inside the returned string
 * with the field names in backticks; they closed the literal, app.js failed to
 * parse, and the page was an infinite "Loading…". Caught in the drill, which is
 * why every app.js change is executed rather than read.
 *
 * The fields themselves: `notes.note` and `notes.dispute_note` were being
 * dropped on the floor. Nobody noticed while the only editions carrying them
 * were thin ones that rendered no matches at all — COFTA 2014's "Nottingham
 * came back from 2-0 down, both goals headers by Nduoma Chilaka" and
 * Stevenage's two disputed goals have never been on screen. They are about the
 * match, so they belong on the match.
 */
function archFixtureRow(m, d) {
  // No orientation, but a known result: a different thing, rendered differently.
  if (!m.home_team_id && !m.away_team_id && m.winner_team_id) return archResultRow(m);

  const evs = d.events.filter(e => e.match_id === m.id);
  const goals = evs.filter(e => ['goal', 'penalty_goal', 'own_goal'].includes(e.event_type));
  const pens = m.decided_by === 'penalties';
  const marker = m.events_status !== 'complete'
    ? `<span class="gap" title="${esc(m.gap_note || m.events_status)}">${esc(
        { score_only: 'score only', partial: 'partial record',
          complete_unattributed: 'unattributed', conflicted: 'conflicted'
        }[m.events_status] ?? m.events_status)}</span>` : '';
  return `<div class="afxr">
    <div class="afxm">
      ${archTeamLink(m.home_team_id, { crest: 22 })}
      <span class="afxs">${m.home_score ?? '–'}<i>–</i>${m.away_score ?? '–'}</span>
      ${archTeamLink(m.away_team_id, { crest: 22, away: true })}
    </div>
    ${pens ? `<div class="afxp">${m.shootout_home != null && m.shootout_away != null
        ? `${m.shootout_home}–${m.shootout_away} on penalties`
        : 'Won on penalties'}${m.shootout_winner_id
        ? ' — ' + archTeamLink(m.shootout_winner_id) : ''}</div>` : ''}
    ${archGoalCols(goals, m)}
    ${marker}
    ${m.gap_note ? `<p class="afxn">${esc(m.gap_note)}</p>` : ''}
    ${m.notes?.note ? `<p class="afxn">${esc(m.notes.note)}</p>` : ''}
    ${m.notes?.dispute_note ? `<p class="afxn">${esc(m.notes.dispute_note)}</p>` : ''}
    ${state.admin && evs.some(e => e.flag) ? `<p class="flagline">flagged:
       ${esc([...new Set(evs.filter(e => e.flag).map(e => e.flag))].join(', '))}</p>` : ''}
  </div>`;
}

/**
 * Scorers under an archive scoreline, in the two columns the scoreboard above
 * already establishes: home left, away right. No club on any line — the two
 * clubs are named once, at the top, with their crests.
 *
 * Goals the archive cannot place sit under both columns rather than inside
 * one, because putting them in a column would assert a side.
 */
function archGoalCols(goals, m) {
  if (!goals.length) return '';
  const { home, away, unplaced } = M.archScorerLines(goals, m);
  const line = (l) => {
    const mins = l.mins.map(x => esc(x) + '′').join(', ');
    // Two goals with no minute between them is still two goals; say so
    // rather than silently collapsing them into one name.
    const extra = !l.mins.length && l.count > 1 ? ` ×${l.count}` : '';
    const tag = l.kind ? `<em>(${l.kind})</em>` : '';
    return `<span class="agl">${l.name ? esc(l.name) : 'Unattributed'}${extra}${tag}
      ${mins ? `<i>${mins}</i>` : ''}</span>`;
  };
  const col = (rows, cls) => `<div class="aglc ${cls}">${rows.map(line).join('')}</div>`;
  if (!home.length && !away.length && !unplaced.length) return '';
  return `<div class="afxg">${col(home, 'h')}${col(away, 'a')}</div>
    ${unplaced.length ? `<div class="aglu">${unplaced.map(line).join('')}</div>` : ''}`;
}

const BOARD_LABEL = {
  goalscorer: 'Goalscorers', assists: 'Assists', yellow_cards: 'Yellow cards',
  player_of_the_match: 'Player of the Match', man_of_the_match: 'Man of the Match',
  clean_sheets: 'Clean sheets',
};

function archBoards(d) {
  // Where published and derived disagree, is_canonical marks the one to lead
  // with — Adam's Q5 ruling made the event-derived Ark Cup figures canonical.
  const rows = d.boards.filter(b => b.is_canonical);
  // Goals first, then the other player boards, then club boards — the order
  // the live Stats hub uses, rather than whatever order the rows arrived in.
  const ORDER = ['goalscorer', 'assists', 'man_of_the_match', 'player_of_the_match',
                 'yellow_cards', 'clean_sheets'];
  const kinds = [...new Set(rows.map(b => b.board_type))]
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return kinds.map(kind => {
    const rs = rows.filter(b => b.board_type === kind).slice(0, 30);
    const superseded = d.boards.some(b => b.board_type === kind && !b.is_canonical);
    return `<div class="sect">${esc(BOARD_LABEL[kind] ?? kind)}</div>
      ${superseded ? `<p class="note" style="padding-top:0">Counted from the match events.
        The published leaderboard for this edition counted shoot-out conversions as goals;
        both figures are kept in the archive.</p>` : ''}
      <div class="alb">${rs.map(b => `<div class="albr">
        <span class="albv">${b.value ?? '–'}</span>
          ${b.player_name ? '' : archCrest(archTeam(b.team_id), 22)}
          <span class="albn">${b.player_name
            ? esc(b.player_name)
            : archTeamLink(b.team_id)}
          ${b.player_name && b.team_id ? archTeamLink(b.team_id, { inline: true }) : ''}</span>
        ${state.admin && b.flag ? `<span class="flagline">${esc(b.flag)}</span>` : ''}
      </div>`).join('')}</div>`;
  }).join('');
}

function archAwards(d) {
  const named = d.awards.filter(a => !a.match_id && !a.is_published_summary);
  if (!named.length) return '';
  const LAB = {
    player_of_the_tournament: 'Player of the tournament',
    top_scorer: 'Top scorer', most_clean_sheets: 'Most clean sheets',
  };
  // The canonical spelling, not the source's. `player_name` holds the string
  // exactly as its source printed it — that is what the column is for, and
  // match pages still render it — but an award is a summary rather than a
  // quotation, and the 2014 report's "Chilaki" against 2026's "Chilaka" reads
  // as two different players.
  return `<div class="sect">Awards</div>
    <div class="aawards">${named.map(a => `<div class="aaw">
      <span class="aawl">${esc(LAB[a.award_type] ?? a.award_type)}</span>
      <span class="aawn">${a.player_canonical || a.player_name
        ? esc(a.player_canonical || a.player_name) : archTeamLink(a.team_id)}
        ${a.value != null ? `<i>${a.value}</i>` : ''}</span>
      ${a.team_id && a.player_name ? `<span class="aawt">${archTeamLink(a.team_id, { inline: true })}</span>` : ''}
    </div>`).join('')}</div>`;
}

/** The same awards block as a full edition, off the honours read. Renders
 *  nothing at all until that read lands, and nothing ever for the many
 *  editions that have no awards recorded. */
function thinAwards(e) {
  const all = state.archiveHonours?.awards;
  if (!all) return '';
  const mine = all.filter(a => a.edition_id === e.id && !a.match_id);
  return mine.length ? archAwards({ awards: mine }) : '';
}

function viewHistEdition() {
  loadArchive();
  if (state.archiveErr && !state.archive) return archFailed();
  if (!state.archive) return archLoading('previous tournaments');

  const e = state.archive.editions.find(x => x.id === state.histEd);
  if (!e) return `${backButton('view:history')}<p class="empty">That edition is not in the archive.</p>`;
  const slug = COMP_SLUG[e.competition];
  const back = backButton('view:history');

  // Same again: the edition's name is the masthead title on this view.
  const detail = [archDates(e), e.venue].filter(Boolean).join(' · ');
  // data-ed is an explicit hook for the drills. They used to wait for the
  // <h2> text to change, which broke silently the moment the heading moved to
  // the masthead: the selector simply never matched and the wait ran out.
  const head = `<div class="chead ehead bare" data-comp="${esc(slug)}" data-ed="${esc(e.id)}">
    ${detail ? `<p>${esc(detail)}</p>` : ''}
    ${e.format ? `<p class="efmt">${esc(e.format)}</p>` : ''}
  </div>`;

  if (e.data_confidence === 'minimal') {
    // A thin edition can still have awards — COFTA 2015 records a top scorer
    // and a player of the tournament and nothing else at all — and this
    // branch used to return before anything went looking for them, so they
    // existed in the database and appeared on the club's cabinet but never
    // on the edition's own page.
    //
    // They come from the honours read rather than the per-edition one: that
    // is a single query for the whole archive, already cached for the
    // cabinets, where loadEdition would fire six and five of them would come
    // back empty for a record this thin. The page renders immediately from
    // the index and the awards drop in when the read settles, so there is no
    // spinner over content that is already on screen.
    // AND A THIN EDITION SHOWS THE MATCHES IT HAS, which it did not until now.
    // This branch never called loadEdition, so cofta-2014's thirteen matches,
    // cofta-2009's two and cofta-2012's one sat in the database and appeared
    // nowhere — the whole point of the migrations that put them there. The
    // page is not "thin" because it has no matches; it is thin because it has
    // no standings, and those are two different absences.
    //
    // Rendered by `archFixtures`, the same function the full editions use, so
    // there is one match renderer and it cannot drift. Most of these rows are
    // results without an orientation and take `archResultRow` inside it.
    //
    // The read is NOT part of the render gate. `loadEdition` latches its own
    // failure, the page renders immediately from the index, and the matches
    // drop in when the read settles — so a slow or failed extra query costs
    // this section and never the champion, entrants and awards above it.
    loadHonours();
    loadEdition(e.id);
    const thin = state.archiveEd[e.id];
    return `${back}${head}${thinEdition(e)}`
         + (thin?.matches?.length ? archFixtures(thin) : '')
         + thinAwards(e)
         + archNotes(e, { skip: ['teams_note'] });
  }

  loadEdition(e.id);
  const d = state.archiveEd[e.id];
  if (state.archiveErr && !d) return `${back}${head}${archFailed()}`;
  if (!d) return `${back}${head}${archLoading(e.display_name)}`;

  const podium = `<div class="thincard">
    <div class="tcwin">${e.champion_team_id ? archCrest(archTeam(e.champion_team_id), 44) : ''}
      <div>${e.champion_team_id ? archTeamLink(e.champion_team_id) : '<b>Not recorded</b>'}
        <span>Champions</span></div></div>
    ${e.runner_up_team_id ? `<div class="tcrun">${archCrest(archTeam(e.runner_up_team_id), 28)}
      <div>${archTeamLink(e.runner_up_team_id)}<span>Runners-up</span></div></div>` : ''}
    ${e.final_summary ? `<p class="tcfin">${esc(e.final_summary)}</p>` : ''}
  </div>`;

  return back + head + podium
    + d.groups.map(g => archTable(d, g)).join('')
    + archFixtures(d) + archBoards(d) + archAwards(d) + archNotes(e);
}

/** What the source could not tell us, said plainly rather than hidden. */
/** `skip` names notes the caller has already put on screen. A thin edition
 *  prints `teams_note` directly under its entrant list, where it belongs —
 *  it qualifies that list — and without this it appeared a second time under
 *  About this record, word for word. */
function archNotes(e, { skip = [] } = {}) {
  const gaps = e.notes?.known_gaps || [];
  const extra = ['competition_note', 'teams_note', 'round_numbering_note',
                 'league_table_note', 'final_orientation_note', 'venue_note',
                 'third_place_note', 'squads_note', 'edition_note']
    .filter(k => !skip.includes(k))
    .map(k => e.notes?.[k]).filter(Boolean);
  // `e.source` is deliberately not rendered. It names the import's own
  // working file — a PDF filename and a section number — which tells a
  // reader nothing about the tournament and reads like a citation on a
  // scoreboard. It stays on the row, so provenance is still recorded and a
  // future question about where a figure came from is answerable; the guard
  // below no longer counts it, or an edition with nothing but a source would
  // render a heading over an empty section.
  if (!gaps.length && !extra.length) return '';
  return `<div class="sect">About this record</div>
    ${extra.map(t => `<p class="note">${esc(t)}</p>`).join('')}
    ${gaps.length ? `<ul class="gaps">${gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}`;
}

/* ── the trophy cabinet ──────────────────────────────────── */
/**
 * A club's whole archive record, reachable from every place History renders
 * that club.
 *
 * Where it opens depends on whether the club still competes. The seven that
 * do already have a page — Squads → the club — so the cabinet becomes a
 * second tab there rather than a second page about the same club. Everyone
 * else gets a standalone page, because there is no live page to tab within.
 *
 * B teams take the standalone route even though they carry a live_team_id.
 * That id exists so they can borrow the parent's crest; it does not make them
 * the parent, and PKSM's record must never appear under SMPK's name.
 */
/** Latches its failure for the same reason loadArchive does — it is called
 *  from cabinetBody's render and calls render() when it settles, so without
 *  `honoursErr` a failure is the same unbounded retry loop. */
function loadHonours() {
  if (state.archiveHonours || state.honoursBusy || state.honoursErr) return;
  state.honoursBusy = true;
  api.fetchArchiveHonours()
    .then(h => { state.archiveHonours = h; state.archiveErr = null; state.honoursErr = null; })
    .catch(e => { state.archiveErr = e.message; state.honoursErr = e.message; })
    .finally(() => { state.honoursBusy = false; render(); });
}

/**
 * The roster read, on the same latch-on-failure pattern as the two above.
 *
 * Deliberately NOT part of the gate that decides whether a cabinet can render.
 * The Players list is the least important thing on the page, and a club's
 * finals and honours must not vanish because one extra read timed out on a
 * venue's wifi. A failure here costs the section and nothing else.
 */
function loadRoster() {
  if (state.archiveRoster || state.rosterBusy || state.rosterErr) return;
  state.rosterBusy = true;
  api.fetchArchiveRoster()
    .then(r => { state.archiveRoster = r; state.rosterErr = null; })
    .catch(e => { state.rosterErr = e.message; })
    .finally(() => { state.rosterBusy = false; render(); });
}

/** The archive club a live club id maps to: the A team, never a B team. */
const archiveTeamForLive = (liveId) =>
  (state.archive?.teams || []).find(t => t.live_team_id === liveId && !t.parent_club) ?? null;

/** Where a tap on an archive club should land. */
function cabinetRoute(t) {
  return (t?.live_team_id && !t.parent_club)
    ? { view: 'squads', team: t.live_team_id }
    : { view: 'archteam', team: t?.id ?? null };
}

const TROPHY_LABEL = {
  golden_boot: 'Golden boot',
  player_of_tournament: 'Player of the tournament',
  golden_glove: 'Golden glove',
};

/**
 * The cabinet body. Shared by the standalone page and the live club page's
 * History tab, so the two can never drift apart.
 */
function cabinetBody(archTeamId) {
  loadArchive(); loadHonours();
  // Either read failing has to reach archFailed(). Checking only
  // `!state.archive` left the honours failure showing "Loading…" for ever:
  // the index was present, so the error branch was skipped, and the loading
  // branch had nothing left to wait for.
  if ((state.archiveErr && !state.archive) || state.honoursErr) return archFailed();
  if (!state.archive || !state.archiveHonours) return archLoading('this club’s record');

  const t = archTeam(archTeamId);
  if (!t) {
    return `<p class="empty">No archive record for this club. Nothing from
      2022&ndash;2026 crosswalks to them.</p>`;
  }

  // Which categories this church actually fielded a side in. A club that only
  // ever played one gets no toggle: a switch with nothing on the other side
  // is a promise the data cannot keep.
  const played = ['men', 'women'].filter(c =>
    M.trophyCabinet(archTeamId, {
      editions: state.archive.editions, entrants: state.archive.entrants, category: c,
    }).entered > 0);
  const cat = played.includes(state.cabCat) ? state.cabCat : (played[0] ?? 'men');

  // THE FIX. This used to pass every edition, so a church fielding both sides
  // — SMPK won the Ark Cup and COSA — showed one pooled cabinet. Scoping by
  // category is the whole point of the join.
  const cab = M.trophyCabinet(archTeamId, {
    editions: state.archive.editions,
    entrants: state.archive.entrants,
    awards: state.archiveHonours.awards,
    boards: state.archiveHonours.boards,
    category: cat,
  });

  const toggle = played.length > 1 ? `<div class="seg cabseg" role="group"
      aria-label="Which side's honours">
      ${played.map(c => `<button data-cabcat="${c}" class="${cat === c ? 'on' : ''}"
         aria-pressed="${cat === c}">${c === 'men' ? 'Men' : 'Women'}</button>`).join('')}
    </div>` : '';

  const wins = cab.finals.filter(f => f.result === 'champion').length;
  const runs = cab.finals.length - wins;

  const tally = `<div class="cabtally">
    <div class="stat"><i>Won</i><b class="tnum">${wins}</b></div>
    <div class="stat"><i>Runners-up</i><b class="tnum">${runs}</b></div>
    <div class="stat"><i>Entered</i><b class="tnum">${cab.entered}</b></div>
  </div>`;

  // WHICH trophies, not just how many — and the zeros stay. A club that has
  // won two COFTAs and no CONAFA is telling you something with both numbers,
  // and in a tournament whose clubs meet every year the gaps are half the
  // record. Ordered by `titlesByCompetition`, which uses the same "how
  // seasoned" rule as the History index so the two cannot disagree.
  const perComp = M.titlesByCompetition(archTeamId, {
    editions: state.archive.editions, category: cat,
  });
  const byComp = !perComp.length ? '' : `<div class="sect">Trophies</div>
    <div class="cabcomps">${perComp.map(r => {
      const slug = COMP_SLUG[r.competition] ?? '';
      return `<button class="ccomp${r.titles ? ' won' : ''}"
          data-histcomp="${esc(slug)}" data-comp="${esc(slug)}"
          aria-label="${r.titles
            ? `${r.titles} ${esc(r.competition)} title${r.titles === 1 ? '' : 's'} won`
            : `No ${esc(r.competition)} titles won`}">
        ${compLogo(slug, 20)}
        <b class="tnum">${r.titles}</b>
        <span>${esc(r.competition)}</span>
      </button>`;
    }).join('')}</div>`;

  const finals = cab.finals.length
    ? `<div class="sect">Finals</div>
       <div class="cabrows">${cab.finals.map(f => `
         <button class="cabrow" data-histed="${esc(f.edition.id)}"
           data-comp="${esc(COMP_SLUG[f.edition.competition] ?? '')}">
           <span class="caby">${f.edition.year}</span>
           <span class="cabm"><b>${esc(f.edition.competition)}</b>
             <span class="cabr ${f.result}">${f.result === 'champion' ? 'Winners' : 'Runners-up'}</span></span>
           <span class="chev" aria-hidden="true"></span>
         </button>`).join('')}</div>`
    : `<div class="sect">Finals</div>
       <p class="note" style="padding-top:0">No final reached in the recorded archive.</p>`;

  // Honours grouped by edition, newest first — the order trophyCabinet
  // already put them in.
  const byEd = [];
  for (const h of cab.honours) {
    const key = h.editionId;
    let g = byEd.find(x => x.key === key);
    if (!g) { g = { key, edition: h.edition, items: [] }; byEd.push(g); }
    g.items.push(h);
  }
  const honours = byEd.length ? `<div class="sect">Honours</div>
    <div class="cabhon">${byEd.map(g => `<div class="cabhg">
      <span class="cabhe">${esc(g.edition
        ? `${g.edition.competition} ${g.edition.year}` : 'Unknown edition')}</span>
      ${g.items.map(h => `<span class="cabhi">
        <b>${esc(TROPHY_LABEL[h.trophy] ?? h.trophy)}</b>
        ${h.player ? `<i>${esc(h.player)}</i>` : ''}
        ${h.value != null ? `<span class="cabhv tnum">${h.value}</span>` : ''}
        </span>`).join('')}
    </div>`).join('')}</div>`
    : '';

  const also = cab.alsoCompeted.length ? `<div class="sect">Also competed</div>
    <div class="cabalso">${cab.alsoCompeted.map(e => `
      <button class="alsochip" data-histed="${esc(e.id)}">${esc(e.competition)}
        <span>${e.year}</span></button>`).join('')}</div>` : '';

  const players = rosterSection(archTeamId, cat);

  const nothing = !cab.finals.length && !cab.honours.length && !cab.alsoCompeted.length
    ? `<p class="empty">No ${cat === 'women' ? "women's" : "men's"} record for this
         club in the 2022&ndash;2026 archive.</p>` : '';

  return toggle + tally + byComp + finals + honours + also + players + nothing;
}

/**
 * The Players list on a History club page.
 *
 * Everyone the archive records for this club, with what it records them for.
 * It is emphatically NOT a squad list — there are no archive team sheets, only
 * five of the thirty-seven editions carry match detail, and a player who
 * turned out every year without scoring leaves no trace at all. The note under
 * the heading says exactly that, in the reader's words rather than the
 * database's, because a list of nineteen names under a club badge will
 * otherwise be read as the squad.
 *
 * The live Squads tab is untouched and stays what it is: a real, current team
 * sheet the organiser maintains. Only History has to hedge, because only
 * History is reconstructing something nobody wrote down completely.
 */
function rosterSection(archTeamId, cat) {
  loadRoster();
  if (state.rosterErr) return '';       // the section, and nothing else, is lost
  if (!state.archiveRoster) {
    return `<div class="sect">Players</div>
      <p class="note">Loading the player record&hellip;</p>`;
  }

  const roster = M.teamRoster(archTeamId, {
    ...state.archiveRoster,
    editions: state.archive.editions,
    category: cat,
  });
  if (!roster.length) return '';

  const bits = (p) => [
    p.goals   ? `${p.goals} goal${p.goals === 1 ? '' : 's'}` : '',
    p.assists ? `${p.assists} assist${p.assists === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' &middot; ');

  return `<div class="sect">Players</div>
    <p class="note" style="padding-top:0">Every player the records name for this
      club. The archive keeps goals, cards and leaderboards, never team sheets,
      so anyone who played without being written down is missing from this list.</p>
    <div class="cabsq">${roster.map(p => `<div class="cabsqr">
      <span class="cabsqn">${esc(p.name)}</span>
      ${bits(p) ? `<span class="cabsqd">${bits(p)}</span>` : ''}
      <span class="cabsqe">${p.editions.map(e =>
        esc(`${e.competition} ${e.year}`)).join(', ')}</span>
    </div>`).join('')}</div>`;
}

/** The standalone cabinet, for clubs with no live page to tab within. */
function viewArchTeam() {
  loadArchive();
  if (state.archiveErr && !state.archive) return archFailed();
  if (!state.archive) return archLoading('this club’s record');
  const t = archTeam(state.archTeam);
  const back = backButton('view:history');
  if (!t) return `${back}<p class="empty">That club is not in the archive.</p>`;

  return `${back}
    <div class="stack one"><div class="sl phead cabhead">
      <span class="bdg">${archCrest(t, 62)}</span>
      <span class="who"><b>${archTeamName(t.id)}</b>
        <i class="cabsub">${esc(archSubtitle(t))}</i></span>
    </div></div>
    ${cabinetBody(t.id)}`;
}

/**
 * What the masthead should say.
 *
 * Opening a tournament from 2015 and still reading "COFTA 2026" at the top of
 * the screen puts the reader in the wrong year — the page they are on is the
 * 2015 tournament, so that is the title. COFTA 2026 does not disappear; it
 * becomes the small line underneath, and the way back to the live weekend.
 *
 * Only the two views that ARE a tournament take the title: a competition and
 * an edition. A club's cabinet is not a tournament, and the History index is
 * a list of them, so both leave the masthead alone.
 */
function mastheadTitle() {
  if (!state.archive) return null;
  if (state.view === 'histed') {
    return state.archive.editions.find(e => e.id === state.histEd)?.display_name ?? null;
  }
  if (state.view === 'histcomp') return compOf(state.histComp)?.name ?? null;
  return null;
}

/** Which competition the masthead is standing for — the edition's own, the
 *  competition being browsed, or the live weekend's. */
function mastheadComp() {
  if (state.archive) {
    if (state.view === 'histed') {
      const e = state.archive.editions.find(x => x.id === state.histEd);
      if (e) return compOf(COMP_SLUG[e.competition]);
    }
    if (state.view === 'histcomp') return compOf(state.histComp);
  }
  return compOf(LIVE_COMP);
}

/**
 * The three lines of the masthead's crest block: which body runs this
 * competition, under whom, and whose crest.
 *
 * Where the association's name is known it is used — each competition is its
 * own association, and printing COFTA's name over a COSTA page was simply
 * wrong. Where it is NOT known (the Ark Cup, Ladies COFTA) the line falls
 * back to the diocese rather than borrowing a different competition's name,
 * which would be an invention rather than a gap.
 */
function mastheadBrand() {
  const c = mastheadComp();
  const d = DIOCESES[c?.diocese] ?? DIOCESES.london;
  return { org: c?.full ?? d.name, auspices: d.auspices, logo: d.logo, alt: d.name };
}

let lastPageKey = null;   // the page render() last painted, for engagement counting

/* ── render ──────────────────────────────────────────────── */
function render() {
  const age = Date.now() - state.lastFetch;
  const stale = state.error || age > POLL_MS * 3;
  $('pip').className = `pip ${stale ? 'stale' : ''}`;
  const q = queueState.depth;
  $('pip').innerHTML = q
    ? `<i></i>${q} unsent`
    : `<i></i>${state.error ? 'Reconnecting' : stale ? 'Stale' : 'Live'}`;
  $('pip').className = `pip ${q || stale ? 'stale' : ''}`;

  // The masthead follows the page. `hd-when` swaps between the live dates and
  // a real button back to the live tournament; the pip beside it is a sibling
  // and is never rebuilt, so the state written just above survives.
  //
  // Optional, like the nav and the gear above: every test drill ships its own
  // cut-down header, and render() must not assume any piece of the chrome is
  // present. Without the guards this threw on a null element on every drill
  // page, which is not a caught error — it is an infinite "Loading…".
  const arch = mastheadTitle();
  const hdTitle = $('hd-title'), hdWhen = $('hd-when');
  if (hdTitle) hdTitle.textContent = arch ?? 'COFTA 2026';
  if (hdWhen) {
    hdWhen.innerHTML = arch
      ? `<button class="tolive" data-live="1"
           aria-label="Back to COFTA 2026, the live tournament"
         ><span aria-hidden="true">&larr;</span> COFTA 2026</button>`
      : '12&ndash;13 September';
  }

  // The diocese follows the competition: CONAFA is played in the Midlands, so
  // its pages carry that crest and that bishop rather than London's. Every
  // other competition keeps the default, because nobody has said otherwise
  // and the alternative would be a guess about a real diocese.
  const dioEl = $('hd-dio'), assocEl = $('hd-assoc');
  if (dioEl && assocEl) {
    const d = mastheadBrand();
    if (dioEl.getAttribute('src') !== d.logo) {
      // A crest file that has not landed yet hides rather than rendering
      // broken — the wrong diocese's crest would be worse than none.
      dioEl.onerror = () => { dioEl.style.visibility = 'hidden'; };
      dioEl.style.visibility = '';
      dioEl.setAttribute('src', d.logo);
      dioEl.setAttribute('alt', d.alt);
    }
    assocEl.innerHTML = `${esc(d.org)}<i>${esc(d.auspices)}</i>`;
  }

  // Never repaint over someone mid-type. The 5-second poll was replacing the
  // whole view, which wiped the sign-in form as it was being filled in. While
  // any input, select or textarea inside the view has focus, only the status
  // pip updates; the repaint resumes the moment focus leaves the field.
  const a = document.activeElement;
  if (a && a.tagName && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)
      && $('body') && $('body').contains && $('body').contains(a)) return;

  // A leaderboard belongs to Stats and a competition or edition belongs to
  // History, so those tabs stay lit while a child page is open — same
  // reasoning as a match staying under the tab it was opened from.
  const navFor = state.view === 'match' ? state.from
               : state.view === 'award' ? 'awards'
               : (state.view === 'histcomp' || state.view === 'histed'
                  || state.view === 'archteam') ? 'history'
               : state.view;
  ['fixtures', 'live', 'squads', 'tables', 'awards', 'history'].forEach(v =>
    $('nav-' + v)?.classList.toggle('on', navFor === v));
  // The Organiser control is a masthead icon rather than a tab: lit when its
  // page is open, tinted whenever this phone is signed in.
  $('nav-admin')?.classList.toggle('on', navFor === 'admin');
  $('nav-admin')?.classList.toggle('in', api.isSignedIn());

  const body =
    state.view === 'fixtures' ? viewFixtures() :
    state.view === 'live'     ? viewLive()     :
    state.view === 'match'    ? viewMatch()    :
    state.view === 'squads'   ? viewSquads()   :
    state.view === 'tables'   ? viewTables()   :
    state.view === 'award'    ? viewAwardBoard() :
    state.view === 'awards'   ? viewAwards()   :
    state.view === 'history'  ? viewHistory()  :
    state.view === 'histcomp' ? viewHistComp() :
    state.view === 'histed'   ? viewHistEdition() :
    state.view === 'archteam' ? viewArchTeam() : viewAdmin();

  $('body').innerHTML = body +
    (state.error ? `<div class="banner warn">Could not reach the server: ${esc(state.error)}.
       Retrying every few seconds \u2014 the last known scores are still shown.</div>` : '');

  // ENGAGEMENT IS COUNTED HERE, not in navigate(), and that is the whole
  // point: the bottom nav does NOT route through navigate() \u2014 it sets
  // state.view directly \u2014 so counting there missed the most ordinary way
  // anyone moves around this app, and the offer never appeared for them.
  // Counting distinct pages actually painted catches every route: tabs, back
  // buttons, deep links and navigate() alike. The five-second repaint does not
  // inflate it, because the key does not change.
  const pageKey = `${state.view}|${state.matchId ?? ''}|${state.histEd ?? ''}`
                + `|${state.histComp ?? ''}|${state.archTeam ?? ''}|${state.sq.team ?? ''}`;
  if (pageKey !== lastPageKey) {
    lastPageKey = pageKey;
    state.views++;
    if (state.view === 'match') state.installEarned = true;
  }

  // The install offer lives OUTSIDE #body, appended to the document, so this
  // repaint \u2014 which runs every five seconds \u2014 never rebuilds it underneath
  // someone's finger. installBar() is a no-op once the bar exists.
  installBar();
  // And once they are in: the alerts offer. Mutually exclusive with the one
  // above by construction — that one only shows when NOT installed, this one
  // only when installed — so the two can never stack.
  notifyBar();
}

/** The clock ticks locally between polls, so the minute never looks frozen. */
function tick() {
  if (state.view !== 'match') return;
  const m = currentMatch();
  if (!m || !M.isLive(m)) return;
  const mm = $('mmin'), el = $('mel'), mc = $('midchip');
  if (mm) mm.textContent = M.minuteLabel(m);
  if (el) el.textContent = M.mmss(M.elapsedMs(m));
  if (mc) mc.textContent = M.mmss(M.elapsedMs(m));
}

/* ── events ──────────────────────────────────────────────── */
async function guard(fn) {
  if (state.busy) return;
  state.busy = true;
  try { await fn(); await poll(); }
  catch (e) {
    if (/stale_version/.test(e.message)) {
      alert('Someone else is running this match. Refreshing to their version.');
      await poll();
    } else { alert(e.message); }
  } finally { state.busy = false; }
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-view],[data-back],[data-day],[data-match],[data-clock],[data-goal],[data-card],[data-pick],[data-pick-side],[data-pick-cancel],[data-edit],[data-assist],[data-assistpick],[data-assistcancel],[data-edpick],[data-edassist],[data-edsave],[data-edcancel],[data-void],[data-ff],[data-pen],[data-pen-confirm],[data-tiepen],[data-tieconfirm],[data-reset],[data-setmgr],[data-theme-set],[data-team],[data-player],[data-sqteam],[data-sqplayer],[data-squad],[data-delplayer],[data-addsquad],[data-dq],[data-award],[data-trophy-add],[data-trophy-remove],[data-trophy-team],[data-trophy-confirm],[data-histcat],[data-histcomp],[data-histed],[data-archteam],[data-clubtab],[data-cabcat],[data-archretry],[data-live],[data-install],[data-notifybar],[data-notify],[data-alert],#signin,#signout');
  if (!t) return;

  // The install bar sits outside #body and is not a view, so it is handled
  // before anything that touches routing. "Not now" is always available and
  // always respected — see DISMISS_DAYS.
  if (t.dataset.install) {
    if (t.dataset.install === 'go') await doInstall(); else dismissInstall();
    return;
  }

  // The alerts offer that follows an install. Handled here rather than folded
  // into data-notify below because THE TAP ITSELF IS THE PERMISSION GESTURE:
  // iOS refuses requestPermission() once the gesture has been spent on an
  // await, so this branch runs enablePush directly with nothing in front of
  // it. Failure keeps the bar up — telling someone it worked when it did not
  // is how a phone stays silent all weekend with nobody any the wiser.
  if (t.dataset.notifybar) {
    if (t.dataset.notifybar !== 'go') { dismissNotifyBar(); return; }
    try {
      await enablePush(pushTeam() || null);
      // Enabled, or refused at the OS dialog. Either way this bar has had its
      // answer and must not ask again; render() takes it down through
      // canOfferNotify, and the key stops a 'denied' from re-offering later.
      dismissNotifyBar();
    } catch (e) { alert(e.message || 'Could not turn on alerts.'); }
    return;
  }

  // Notifications. 'off' unsubscribes; anything else is a club choice, or
  // 'all'. Enabling and re-choosing are the same call, because subscribe_push
  // is idempotent on the endpoint - switching club must not need a round trip
  // through off-and-on-again.
  // Toggling one alert kind on or off. Re-subscribes immediately so the choice
  // reaches the server without a Save button - subscribe_push is idempotent on
  // the endpoint, so this is an update, not a duplicate.
  if (t.dataset.alert) {
    const k = t.dataset.alert;
    const on = new Set(pushKinds());
    if (on.has(k)) on.delete(k); else on.add(k);
    // Turning the last one off would leave a subscription that can never fire,
    // which is a worse state than being unsubscribed and looks like a bug.
    // The server falls back too; this keeps the UI honest about it.
    const next = on.size ? [...on] : [...DEFAULT_KINDS];
    try { localStorage.setItem('cofta.push.kinds', JSON.stringify(next)); } catch {}
    render();
    try { await enablePush(pushTeam() || null); }
    catch (e) { alert(e.message || 'Could not save that.'); }
    return;
  }

  if (t.dataset.notify) {
    const v = t.dataset.notify;
    try {
      if (v === 'off') await disablePush();
      else if (v === 'test') {
        // Prove the whole chain without waiting for a goal. The reply is
        // shown verbatim because that is the fastest way to tell "nobody was
        // subscribed" from "the send failed" from "the key is not set" —
        // three very different problems that all look like a silent phone.
        const msg = $('pushmsg');
        if (msg) msg.textContent = 'Sending…';
        const anyMatch = state.matches[0];
        if (!anyMatch) { if (msg) msg.textContent = 'No fixtures to test against.'; return; }
        try {
          const r = await api.firePush(anyMatch.id, 'test');
          if (msg) msg.textContent = r
            ? `Sent to ${r.sent} of ${r.of}.`
              + (r.failed ? ` ${r.failed} failed: ${(r.problems || []).join(' | ')}` : '')
              // The exact text that went out, so the wording can be checked
              // from here rather than by staring at a lock screen.
              + (r.title ? ` — "${r.title}" / "${r.body}"` : '')
            : 'Sent.';
        } catch (e) { if (msg) msg.textContent = e.message; }
      }
      else await enablePush(v === 'all' ? null : v);
    } catch (e) { alert(e.message || 'Could not change notifications.'); }
    return;
  }

  // Back before view: a back button carries only data-back, but checking it
  // first keeps the two from ever racing if one later carries both.
  if (t.dataset.back) {
    if (!popHist()) {
      // Nothing to go back to — the fixed destination this button used to have.
      const [kind, arg] = String(t.dataset.back).split(':');
      state.award = null;
      state.picker = null; state.editor = null;
      if (arg === 'history') { state.histComp = null; state.histEd = null; }
      if (kind === 'sqteam') {
        state.view = 'squads'; state.sq = { team: arg, player: null };
      } else {
        state.view = arg;
        if (arg === 'squads') state.sq = { team: null, player: null };
      }
    }
    render(); return;
  }

  if (t.dataset.view) {
    // The bottom nav always lands on the root of its tab, so the trail of
    // wherever you had wandered is discarded rather than resumed later.
    state.view = t.dataset.view; state.picker = null; state.editor = null;
    state.hist = []; state.award = null;
    if (t.dataset.view === 'squads' && !t.dataset.sqteam) state.sq = { team: null, player: null };
    if (t.dataset.view === 'squads') state.clubTab = 'squad';
    // History opens on Men every time, as specified — the toggle is a
    // per-visit choice, not a preference worth remembering.
    if (t.dataset.view === 'history') {
      state.histCat = 'men'; state.histComp = null; state.histEd = null;
    }
    render(); return;
  }

  // Out of the archive entirely, back to the live weekend. This is not the
  // back button — that walks the trail one step. This leaves.
  if (t.dataset.live !== undefined) {
    state.hist = [];
    state.histComp = null; state.histEd = null; state.archTeam = null;
    state.view = 'fixtures';
    render(); return;
  }

  // Clearing the recorded failure is the whole retry: the next render calls
  // loadArchive/loadEdition again, and they now have nothing to stop them.
  if (t.dataset.archretry !== undefined) {
    state.archiveErr = null;
    state.archiveEdErr = {};
    state.honoursErr = null;
    render(); return;
  }

  // History: category toggle, then competition, then edition. Each forward
  // move pushes the page it leaves, so back walks the trail.
  if (t.dataset.histcat) {
    state.histCat = t.dataset.histcat;
    render(); return;
  }

  if (t.dataset.histcomp) {
    navigate(() => { state.view = 'histcomp'; state.histComp = t.dataset.histcomp; });
    render(); return;
  }

  if (t.dataset.histed) {
    navigate(() => { state.view = 'histed'; state.histEd = t.dataset.histed; });
    render(); return;
  }

  // A club in History opens its cabinet. The seven that still compete already
  // have a page, so it opens there on the History tab; everyone else — the
  // clubs off the circuit, and B teams, which borrow a crest but are not
  // their parent — gets the standalone cabinet.
  if (t.dataset.archteam) {
    const club = archTeam(t.dataset.archteam);
    const route = cabinetRoute(club);
    // A cabinet is entered from a gendered context, so it opens on that side:
    // tapping a club on a Ladies COFTA page shows their women's record, not
    // their men's. The toggle inside is the manual override.
    const from = viewCategory();
    navigate(() => {
      state.cabCat = from === 'women' ? 'women' : 'men';
      if (route.view === 'squads') {
        state.view = 'squads';
        state.sq = { team: route.team, player: null };
        state.clubTab = 'history';
      } else {
        state.view = 'archteam';
        state.archTeam = route.team;
      }
    });
    render(); return;
  }

  if (t.dataset.clubtab) {
    state.clubTab = t.dataset.clubtab;
    // The live tournament is men's — there are no women's squads in the live
    // app yet — so a club page's History tab opens on the men's record.
    if (t.dataset.clubtab === 'history') state.cabCat = 'men';
    render(); return;
  }

  if (t.dataset.cabcat) { state.cabCat = t.dataset.cabcat; render(); return; }

  if (t.dataset.team) {
    navigate(() => {
      state.view = 'squads';
      state.sq = { team: t.dataset.team, player: null };
      state.clubTab = 'squad';   // the toggle never persists between visits
      state.award = null;
    });
    render(); return;
  }
  if (t.dataset.player) {
    const pl = state.players.find(p => p.id === t.dataset.player);
    navigate(() => {
      state.view = 'squads';
      state.sq = { team: pl?.team ?? state.sq.team, player: t.dataset.player };
      state.award = null;
    });
    render(); return;
  }

  if (t.dataset.sqteam) {
    navigate(() => {
      state.view = 'squads'; state.sq = { team: t.dataset.sqteam, player: null };
      state.clubTab = 'squad';
      state.award = null;
    });
    render(); return;
  }
  if (t.dataset.sqplayer) {
    navigate(() => { state.sq = { ...state.sq, player: t.dataset.sqplayer }; });
    render(); return;
  }

  if (t.dataset.award) {
    navigate(() => { state.view = 'award'; state.award = t.dataset.award; });
    render(); return;
  }
  // Choosing a day pins it: the automatic jump to Sunday must never drag
  // someone back off the day they deliberately opened.
  if (t.dataset.day) {
    state.day = +t.dataset.day; state.dayPinned = true;
    state.picker = null; render(); return;
  }
  if (t.dataset.match) {
    state.from = (state.view === 'live') ? 'live' : 'fixtures';
    state.matchId = t.dataset.match; state.view = 'match';
    state.pens = null; state.picker = null; state.editor = null; render(); return;
  }

  const m = currentMatch();

  if (t.dataset.clock && m) return guard(async () => {
    // set_clock banks this as the second half's starting total, so the wrong
    // value does not merely mislabel the clock - it moves it.
    await api.setClock(m.id, t.dataset.clock, m.v, M.halfMsFor(m),
      t.dataset.clock === 'start' ? m.home : null,
      t.dataset.clock === 'start' ? m.away : null);
    // Every clock action is announceable; who hears it is the subscriber's
    // choice, not ours. 'pause' and 'resume' deliberately are not - a clock
    // stopping for an injury is not news to someone not at the ground.
    if (['start','half_time','second_half','full_time'].includes(t.dataset.clock)) {
      notifyMatch(m.id, t.dataset.clock);
    }
  });

  // Goal for a side: log it immediately, then ask who scored. The score
  // must move on the first tap — attribution is a bonus, never a gate.
  if (t.dataset.goal && m) {
    const id = api.uuid();
    queue.add(id, 'log_event', {
      p_id: id, p_match: m.id, p_type: 'goal', p_side: t.dataset.goal,
      p_player: null,
      p_elapsed: Math.round(M.elapsedMs(m)),
      p_minute: M.minuteLabel(m) + '\u2032',
    });
    state.picker = { type: 'goal', side: t.dataset.goal, eventId: id };
    render();
    // Not announced yet - see scheduleGoalPush. Waiting lets the scorer be
    // picked first, and lets a mis-tap be voided before anyone hears about it.
    scheduleGoalPush(m.id, id);
    return;
  }

  // Cards need a side chosen first, so the picker opens on the club step.
  if (t.dataset.card && m) {
    state.picker = { type: t.dataset.card, side: null, eventId: null };
    render(); return;
  }

  if (t.dataset.pickSide && m) { state.picker.side = t.dataset.pickSide; render(); return; }
  if (t.dataset.pickCancel) { state.picker = null; render(); return; }

  if (t.dataset.pick && m) {
    const pk = state.picker;
    if (!pk) { render(); return; }

    if (t.dataset.pick === 'own' && pk.type === 'goal' && pk.eventId) {
      // The tapped goal was an own goal. Void the original, log the own goal
      // against the other side (which credits the same club, so the score
      // never moves), then ask which opposition player it was.
      const other = pk.side === 'home' ? 'away' : 'home';
      // The original goal is being taken back, so its pending announcement
      // goes with it — nobody should hear about a goal that no longer exists.
      // The own goal that replaces it starts its own window.
      cancelGoalPush(pk.eventId);
      queue.add(api.uuid(), 'void_event', { p_id: pk.eventId });
      const ogId = api.uuid();
      queue.add(ogId, 'log_event', {
        p_id: ogId, p_match: m.id, p_type: 'own_goal',
        p_side: other, p_player: null,
        p_elapsed: Math.round(M.elapsedMs(m)),
        p_minute: M.minuteLabel(m) + '\u2032',
      });
      state.picker = { type: 'own_goal', side: other, eventId: ogId };
      scheduleGoalPush(m.id, ogId);
      render(); return;
    }

    const playerId = t.dataset.pick === 'skip' ? null : t.dataset.pick;

    if (pk.eventId) {
      // the goal is already logged; attach the scorer to it
      if (playerId) {
        queue.add(api.uuid(), 'attribute_event',
          { p_event: pk.eventId, p_player: playerId });
      }
      // Either way the waiting is over: a name has been chosen, or the picker
      // was skipped and there will not be one. Send the single announcement
      // now rather than making everyone wait out the rest of the window.
      if (pk.type === 'goal' || pk.type === 'own_goal') {
        flushGoalPush(m.id, pk.eventId);
      }
    } else {
      const id = api.uuid();
      queue.add(id, 'log_event', {
        p_id: id, p_match: m.id, p_type: pk.type,
        p_side: pk.side ?? null, p_player: playerId,
        p_elapsed: Math.round(M.elapsedMs(m)),
        p_minute: M.minuteLabel(m) + '\u2032',
      });
      // Cards and man of the match are logged WITH their player already, so
      // unlike a goal there is no follow-up to fill in: one push, once, and
      // only to whoever asked for that kind. The small delay lets the write
      // land before the function goes looking for the row.
      const kind = (pk.type === 'yellow' || pk.type === 'red') ? 'card'
                 : pk.type === 'motm' ? 'motm' : null;
      if (kind) setTimeout(() => notifyMatch(m.id, kind, { event_id: id }), 1200);
    }
    state.picker = null;
    render();
    return;
  }

  if (t.dataset.edit) {
    const ev = state.events.find(x => x.id === t.dataset.edit);
    if (!ev) return;
    // The editor opens on what is already recorded, assist included, so a
    // save that only corrects a minute puts the same assist back rather than
    // clearing it \u2014 edit_event is a full replace on the server.
    state.editor = { id: ev.id, player: ev.p ?? null, assist: ev.a ?? null,
                     minute: String(ev.min || '').replace(/[\u2032']/g, '') };
    render(); return;
  }

  if (t.dataset.assist) {
    state.editor = null;                 // one panel at a time
    state.assistFor = t.dataset.assist;
    render(); return;
  }

  if (t.dataset.assistcancel) { state.assistFor = null; render(); return; }

  if (t.dataset.assistpick) {
    const ev = state.events.find(x => x.id === state.assistFor);
    if (!ev) { state.assistFor = null; render(); return; }
    const assist = t.dataset.assistpick === 'none' ? null : t.dataset.assistpick;
    // Applied on the tap. No confirm step: the choice IS the confirmation,
    // exactly as picking a scorer already works.
    ev.a = assist;                       // optimistic; the row updates at once
    // FULL REPLACE. The scorer and minute go back unchanged or edit_event
    // wipes them, and nothing on this screen would show that it had.
    queue.add(api.uuid(), 'edit_event',
      { p_event: ev.id, p_player: ev.p, p_minute: ev.min, p_assist: assist });
    state.assistFor = null;
    render(); return;
  }

  if (t.dataset.edpick) {
    const box = $('edmin');
    if (box) state.editor.minute = box.value.trim();   // keep what was typed
    state.editor.player = t.dataset.edpick === 'none' ? null : t.dataset.edpick;
    // Nobody can assist their own goal, so choosing a scorer who is already
    // the assister drops the assist rather than saving something the
    // database will reject.
    if (state.editor.assist && state.editor.assist === state.editor.player) {
      state.editor.assist = null;
    }
    render(); return;
  }

  if (t.dataset.edassist) {
    const box = $('edmin');
    if (box) state.editor.minute = box.value.trim();
    state.editor.assist = t.dataset.edassist === 'none' ? null : t.dataset.edassist;
    render(); return;
  }

  if (t.dataset.edcancel) { state.editor = null; render(); return; }

  if (t.dataset.edsave) {
    const box = $('edmin');
    let minute = (box ? box.value : state.editor.minute || '').trim();
    if (box && !/^\d{1,2}(\+\d{1,2})?$/.test(minute)) {
      alert('Minute should look like 12, or 20+2 for added time.'); return;
    }
    // An empty box means "no minute given", and the fallback is the last
    // minute of THIS match — 30 in Group B, 40 everywhere else. It was a flat
    // 40, which on a Group B game is ten minutes after the final whistle.
    if (!minute) minute = String(M.halfMinFor(m) * 2);
    const ed = state.editor;
    const target = state.events.find(x => x.id === ed.id);
    // An assist belongs to a goal and to a named scorer. Anything else is
    // sent as null rather than letting the server reject the whole edit.
    const assist = (target?.t === 'goal' && ed.player && ed.assist !== ed.player)
      ? ed.assist : null;
    // optimistic: the report and scorer lines update instantly
    if (target) { target.min = minute + '\u2032'; target.p = ed.player; target.a = assist; }
    // Full replace, so the assist currently on screen is always sent back \u2014
    // correcting a minute must never silently drop it.
    queue.add(api.uuid(), 'edit_event',
      { p_event: ed.id, p_player: ed.player, p_minute: minute + '\u2032', p_assist: assist });
    state.editor = null;
    render(); return;
  }

  if (t.dataset.void) {
    // UNDO ASKS FIRST, and says what it is about to cost.
    //
    // It sits in a row of small labels beside a button an organiser presses
    // often, on a touchline, and it takes a goal off the board. The one thing
    // it genuinely cannot take back is a notification that has already gone
    // out, so the message says which case this is rather than warning in
    // general terms — `pendingGoalPush` still holding the id means the
    // announcement is still waiting and nobody will ever hear about it.
    //
    // A native confirm(), matching forfeit and reset: it is the established
    // shape for a destructive act here, and unlike an inline button it cannot
    // be dismissed by the same mis-tap that opened it.
    if (m && !confirmVoid(t.dataset.void, m)) return;
    // If this goal is still inside its announcement window, it is now never
    // announced. A correction made within seconds should cost nobody a buzz.
    cancelGoalPush(t.dataset.void);
    queue.add(api.uuid(), 'void_event', { p_id: t.dataset.void });
    render();
    return;
  }

  if (t.dataset.ff && m) {
    const side = t.dataset.ff === 'null' ? null : t.dataset.ff;
    const who = side ? nameOf(side === 'home' ? m.home : m.away) : null;
    if (side && !confirm(`Record ${who} as forfeiting? 3\u20130 will be awarded.`)) return;
    return guard(() => api.setForfeit(m.id, side));
  }

  if (t.dataset.pen && m) {
    const [side, d] = t.dataset.pen.split(':');
    const p = state.pens ?? { h: m.ph || 0, a: m.pa || 0 };
    if (side === 'h') p.h = Math.max(0, p.h + +d); else p.a = Math.max(0, p.a + +d);
    state.pens = p; render(); return;
  }

  if (t.dataset.penConfirm && m) {
    const p = state.pens ?? { h: m.ph || 0, a: m.pa || 0 };
    return guard(async () => { await api.setShootout(m.id, p.h, p.a, true); state.pens = null; });
  }

  if (t.dataset.tiepen) {
    const [key, side, d] = t.dataset.tiepen.split(':');
    const sc = state.tiePens[key] ?? { a: 0, b: 0 };
    sc[side] = Math.max(0, sc[side] + Number(d));
    state.tiePens[key] = sc; render(); return;
  }

  if (t.dataset.tieconfirm) {
    const key = t.dataset.tieconfirm;
    const teamsArr = Object.values(state.teams);
    const ms = resolvedMatches();
    const pair = ['A', 'B'].flatMap(g =>
      M.unresolvedPairs(teamsArr, ms, g, state.ties).map(p => ({ g, ...p })))
      .find(p => p.g + p.i === key);
    const sc = state.tiePens[key];
    if (!pair || !sc || sc.a === sc.b) return;
    return guard(async () => {
      await api.setTieShootout(pair.g, pair.a.team.id, pair.b.team.id, sc.a, sc.b);
      delete state.tiePens[key];
    });
  }

  if (t.dataset.themeSet !== undefined) {
    applyTheme(t.dataset.themeSet);
    render(); return;
  }

  if (t.dataset.squad) {
    state.squadTeam = state.squadTeam === t.dataset.squad ? null : t.dataset.squad;
    render(); return;
  }

  if (t.dataset.delplayer) {
    const pl = state.players.find(p => p.id === t.dataset.delplayer);
    if (pl && !confirm(`Remove ${pl.name} from the squad?`)) return;
    return guard(() => api.removePlayer(t.dataset.delplayer));
  }

  if (t.dataset.addsquad) {
    const box = $('sqin'), msg = $('sqmsg');
    const parsed = parseSquadLines(box?.value);
    if (!parsed.length || !state.squadTeam) return;
    const existing = new Set(squadOf(state.squadTeam).map(p => p.name.toLowerCase()));
    const fresh = parsed.filter(p => !existing.has(p.name.toLowerCase()));
    const skipped = parsed.length - fresh.length;

    return guard(async () => {
      let added = 0, stopped = null;
      for (const p of fresh) {
        try { await api.addPlayer(state.squadTeam, p.name, p.no); added++; }
        catch (e) {
          stopped = /squad_full/.test(e.message) ? 'squad is at the 23-man limit' : e.message;
          break;
        }
      }
      if (box) box.value = '';
      if (msg) msg.textContent =
        `Added ${added}` +
        (skipped ? `, skipped ${skipped} already listed` : '') +
        (stopped ? ` \u2014 stopped: ${stopped}` : '') + '.';
    });
  }

  if (t.dataset.setmgr) {
    const v = $('mgrin')?.value ?? '';
    return guard(() => api.setManager(state.squadTeam, v));
  }

  if (t.dataset.reset) {
    const word = prompt('This wipes every score, event, card, shoot-out and override, and returns all fixtures to scheduled. Clubs and squads are kept.\n\nType RESET to confirm.');
    if (word !== 'RESET') return;
    return guard(() => api.resetTournament());
  }

  if (t.dataset.dq) {
    const tm = team(t.dataset.dq);
    if (!confirm(`${tm.disqualified ? 'Reinstate' : 'Disqualify'} ${tm.name} (${tm.city})?`)) return;
    return guard(() => api.setDisqualified(tm.id, !tm.disqualified));
  }

  if (t.dataset.trophyTeam) {
    const [key, teamId] = t.dataset.trophyTeam.split(':');
    state.trophyTeam ??= {};
    state.trophyTeam[key] = teamId;
    render(); return;
  }

  // One control for both directions: tapping a chosen name takes it off again,
  // which is what everyone tries first.
  if (t.dataset.trophyAdd) {
    const [key, pid] = t.dataset.trophyAdd.split(':');
    state.trophyPick ??= {};
    const list = state.trophyPick[key] ?? [];
    state.trophyPick[key] = list.includes(pid)
      ? list.filter(x => x !== pid)
      : [...list, pid];
    render(); return;
  }

  if (t.dataset.trophyRemove) {
    const [key, pid] = t.dataset.trophyRemove.split(':');
    state.trophyPick ??= {};
    state.trophyPick[key] = (state.trophyPick[key] ?? []).filter(x => x !== pid);
    render(); return;
  }

  if (t.dataset.trophyConfirm) {
    const key = t.dataset.trophyConfirm;
    const picked = (state.trophyPick ?? {})[key] ?? [];
    if (!picked.length) return;
    const names = picked.map(id => playerName(id) ?? 'Unknown player').join(' & ');
    if (!confirm(`Confirm the ${M.trophyLabel(key)} for ${names}?`)) return;
    return guard(async () => {
      await api.setTrophy(key, picked);
      // drop the working set so the panel re-reads the confirmed winners
      if (state.trophyPick) delete state.trophyPick[key];
    });
  }

  if (t.id === 'signin') {
    const email = $('em').value.trim(), pw = $('pw').value;
    $('autherr').textContent = '';
    try {
      await api.signIn(email, pw);
      const seen = await api.checkRole();   // also remembers it for an offline boot
      state.admin = seen.admin; state.role = seen.role;
      state.roleVerified = true;
      if (!state.admin) { $('autherr').textContent = 'Signed in, but this account is not an organiser.'; }
      state.view = state.admin ? 'fixtures' : 'admin';
      await poll();
    } catch (e) { $('autherr').textContent = e.message; }
    return;
  }

  if (t.id === 'signout') { api.signOut(); state.admin = false; state.role = null; state.roleVerified = false; render(); return; }
});

// Player search: filters the visible list as you type. Action rows (own
// goal, no-player) stay visible whatever the query.
document.addEventListener('input', (ev) => {
  // The goal editor has two lists — scored by, then assisted by — so a search
  // box filters the list immediately after it, not merely the first one in
  // the picker. Everything else has a single list and falls back to that.
  const list = ev.target.nextElementSibling?.classList?.contains('pklist')
    ? ev.target.nextElementSibling
    : ev.target.closest('.picker')?.querySelector('.pklist');
  if (!list) return;

  if (ev.target.id === 'pkq' || ev.target.id === 'pkqa') {
    const q = ev.target.value.trim().toLowerCase();
    for (const b of list.querySelectorAll('.pk')) {
      const isAction = b.dataset.pick === 'own' || b.dataset.pick === 'skip'
        || b.dataset.edpick === 'none' || b.dataset.edassist === 'none';
      b.style.display = (isAction || !q || b.textContent.toLowerCase().includes(q))
        ? '' : 'none';
    }
    return;
  }

  // The trophy search reaches every club: a golden glove keeper need not play
  // for the club that conceded fewest. With the box empty the list falls back
  // to whichever club chip is selected.
  if (ev.target.classList.contains('tpq')) {
    const q = ev.target.value.trim().toLowerCase();
    for (const b of list.querySelectorAll('.pk')) {
      b.style.display = (q ? b.textContent.toLowerCase().includes(q)
                           : b.dataset.club === list.dataset.club) ? '' : 'none';
    }
  }
});

document.addEventListener('change', (ev) => {
  const s = ev.target.closest('[data-slot]');
  if (!s) return;
  guard(() => api.setSlot(s.dataset.slot, s.value || null));
});

/* ── add to home screen ──────────────────────────────────── */
/**
 * THE TWO PLATFORMS ARE NOT THE SAME FEATURE and pretending otherwise is how
 * this gets built badly.
 *
 * Android/Chrome hands us `beforeinstallprompt`. We stop its own banner,
 * keep the event, and spend it when the reader taps ours — one real tap,
 * a real OS install dialog.
 *
 * iOS Safari has NO such API and never will. Installing is a manual trip
 * through the share sheet, so the only honest thing to offer is an
 * instruction. That is not the lesser path here — it is the majority path,
 * because most of this audience is on an iPhone, and it is also the ONLY way
 * iOS push notifications can ever work: Apple requires a home-screen app.
 *
 * OTHER iOS BROWSERS ARE SUPPRESSED ENTIRELY. Chrome, Firefox and Edge on iOS
 * are all WebKit in a different wrapper, and "Add to Home Screen" either is
 * not there or produces something that does not behave like the app. Telling
 * someone to tap a button that does not exist is worse than saying nothing.
 */
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  // iPadOS 13+ reports itself as a Mac, and the touch points give it away.
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|Mercury/i.test(navigator.userAgent);
const IOS_SAFARI = IOS && !IOS_OTHER_BROWSER;

/** Already installed? Then never ask. `standalone` is the iOS spelling. */
const installed = () =>
  window.matchMedia?.('(display-mode: standalone)')?.matches
  || window.navigator.standalone === true;

const DISMISS_KEY = 'cofta.install.dismissed';
const DISMISS_DAYS = 7;

function installDismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && (Date.now() - at) < DISMISS_DAYS * 864e5;
  } catch { return false; }   // private mode: treat as not dismissed
}

/** `beforeinstallprompt` fires EARLY — before boot() has finished — so this
 *  listener is attached at module evaluation, not inside boot. Missing it
 *  means the Android path silently never works. */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // suppress Chrome's own banner; ours replaces it
  deferredInstall = e;
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  $('installbar')?.remove();
  try { localStorage.removeItem(DISMISS_KEY); } catch {}
  render();
});

/** The iOS share glyph, drawn rather than typed. The unicode characters for
 *  it render as a box on plenty of devices, and an instruction whose icon is
 *  a tofu square is not an instruction. */
const SHARE_GLYPH = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"
  stroke-linejoin="round" style="vertical-align:-2px">
  <path d="M12 15V3"/><path d="M8.5 6.5 12 3l3.5 3.5"/>
  <path d="M6 12.5v7A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5v-7"/></svg>`;

/**
 * THE ACTUAL TAPS, for a reader who wants to do this rather than be told it
 * exists. The bar is one line and has to be; this is where the steps live.
 *
 * Four different sets of instructions, because there are genuinely four
 * different answers and a generic one would be wrong for most readers. The
 * order matters: `deferredInstall` is checked FIRST because a browser that
 * offers us the real dialog should be given a button, not a description of a
 * menu it does not need.
 *
 * EVERY VERSION ENDS BY OPENING IT FROM THE HOME SCREEN. That is the step
 * people skip — they add the icon, stay in the tab they were already in, and
 * nothing about the app appears to have changed. On iOS it is also the step
 * that makes notifications possible at all.
 */
function installHowTo() {
  if (deferredInstall) {
    return `<ol class="howto">
        <li>Tap <b>Install</b> below and confirm.
          <span class="hnote">No menu to hunt through — your browser offers it directly.</span></li>
        <li>Open COFTA from your home screen.</li>
        <li>Tap the bell up in the corner and pick your club.</li>
      </ol>
      <button class="act" data-install="go">Install</button>`;
  }
  if (IOS_OTHER_BROWSER) {
    return `<ol class="howto">
        <li>Open <b>cofta.co.uk</b> in <b>Safari</b>.
          <span class="hnote">Only Safari can put an app on an iPhone home screen.
            Chrome, Firefox and Edge on iPhone cannot, however they look.</span></li>
        <li>Tap ${SHARE_GLYPH} in the toolbar at the bottom.</li>
        <li>Scroll down the list and choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        <li>Open COFTA from your home screen and tap the bell to pick your club.</li>
      </ol>`;
  }
  if (IOS) {
    return `<ol class="howto">
        <li>Tap ${SHARE_GLYPH} in the toolbar at the bottom of the screen.</li>
        <li>Scroll down the list and choose <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>, top right.</li>
        <li>Open COFTA from your home screen and tap the bell to pick your club.
          <span class="hnote">This last one matters: alerts reach the app on your
            home screen, never the Safari tab you are reading this in.</span></li>
      </ol>`;
  }
  return `<ol class="howto">
      <li>Open your browser's menu — the three dots, usually top right.</li>
      <li>Choose <b>Install app</b>, or <b>Add to Home screen</b>.
        <span class="hnote">If neither is there, this browser cannot install web
          apps. Chrome, Edge and Safari can.</span></li>
      <li>Open COFTA from your home screen and tap the bell to pick your club.</li>
    </ol>`;
}

/**
 * Shown once someone has actually used the app a little — never on the first
 * paint. A banner over a page a reader has not read yet is an interruption,
 * not an offer.
 */
function canOfferInstall() {
  if (installed()) return false;
  if (installDismissedRecently()) return false;
  if ($('newbuild')) return false;        // one bar at a time; that one is more urgent
  if (state.views < 2 && !state.installEarned) return false;
  return !!deferredInstall || IOS_SAFARI;
}

function installBar() {
  if (!canOfferInstall() || $('installbar')) return;
  const bar = document.createElement('div');
  bar.id = 'installbar';
  bar.className = 'installbar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Add COFTA to your home screen');

  // BOTH VERSIONS NAME THE NOTIFICATIONS, because for most readers that is the
  // reason to bother — "full screen" is a nicety, "your phone buzzes when your
  // club scores" is a reason. The full steps are in the alerts panel behind the
  // bell; a fixed bar over someone's thumb is not the place for four of them.
  bar.innerHTML = deferredInstall
    ? `<div class="ibtext"><b>Add COFTA to your home screen</b>
         <span>Opens straight to the scores — and you can get a buzz when a goal
           goes in.</span></div>
       <div class="ibacts">
         <button class="ibgo" data-install="go">Add</button>
         <button class="ibno" data-install="no" aria-label="Not now">Not now</button>
       </div>`
    : `<div class="ibtext"><b>Add COFTA to your home screen</b>
         <span>Tap ${SHARE_GLYPH} then <b>Add to Home Screen</b> — and get alerts
           when a goal goes in.</span></div>
       <div class="ibacts">
         <button class="ibno" data-install="no" aria-label="Dismiss">Got it</button>
       </div>`;
  document.body.appendChild(bar);
}

/* ── and once they are in, offer the alerts ──────────────── */
/**
 * THE MOMENT AFTER INSTALLING IS THE ONLY GOOD MOMENT TO ASK.
 *
 * Someone who has just put COFTA on their home screen has declared an interest
 * in a way nobody else has, and on iOS this is the FIRST instant the question
 * can even be asked — Apple will not deliver push to a Safari tab, so before
 * installing there was nothing to offer. Waiting for them to discover the bell
 * on their own wastes that.
 *
 * Not a permission request straight away: iOS requires a real gesture, and a
 * system dialog nobody invited is how people end up tapping "Don't allow",
 * which cannot be undone from inside the app. This is our own bar first, and
 * the OS prompt only after a tap.
 */
const NOTIFY_DISMISS_KEY = 'cofta.notify.dismissed';

function notifyDismissedRecently() {
  try {
    const at = Number(localStorage.getItem(NOTIFY_DISMISS_KEY) || 0);
    return at > 0 && (Date.now() - at) < DISMISS_DAYS * 864e5;
  } catch { return false; }
}

function canOfferNotify() {
  if (!installed()) return false;              // iOS cannot deliver to a tab
  if (!state.push?.supported) return false;
  if (state.push.subscribed) return false;
  // 'denied' means they have already refused at OS level, and the app cannot
  // ask again. Nagging about something only Settings can fix is just noise.
  if (state.push.permission !== 'default') return false;
  if (notifyDismissedRecently()) return false;
  if ($('newbuild') || $('installbar')) return false;   // one bar at a time
  return state.views >= 2 || state.installEarned;
}

function notifyBar() {
  // Unlike installBar this also has to take the bar DOWN. Install ends with
  // the page being replaced, so that bar never needs removing from under
  // itself; this one is answered in place — tap Turn on, and the state it is
  // asking about changes while the bar is still on screen.
  if (!canOfferNotify()) { $('notifybar')?.remove(); return; }
  if ($('notifybar')) return;
  const bar = document.createElement('div');
  bar.id = 'notifybar';
  bar.className = 'installbar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Turn on match alerts');
  bar.innerHTML = `<div class="ibtext"><b>Get a buzz when a goal goes in</b>
      <span>Goals and full time. Pick one club, or turn it off, any time.</span></div>
    <div class="ibacts">
      <button class="ibgo" data-notifybar="go">Turn on</button>
      <button class="ibno" data-notifybar="no" aria-label="Not now">Not now</button>
    </div>`;
  document.body.appendChild(bar);
}

function dismissNotifyBar() {
  try { localStorage.setItem(NOTIFY_DISMISS_KEY, String(Date.now())); } catch {}
  $('notifybar')?.remove();
}

async function doInstall() {
  if (!deferredInstall) return;
  const e = deferredInstall;
  deferredInstall = null;                 // a prompt event is single-use
  $('installbar')?.remove();
  try {
    e.prompt();
    await e.userChoice;                   // resolved either way; appinstalled does the rest
  } catch { /* the reader closed it, which is an answer */ }
}

function dismissInstall() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  $('installbar')?.remove();
}

/**
 * Ask the server to fan a notification out. DELIBERATELY NOT AWAITED and
 * deliberately silent on failure.
 *
 * The score moving is the job. A notification is a courtesy on top of it, and
 * it must never be able to delay the tap that logged the goal, block the
 * picker that follows, or put an error in front of someone standing on a
 * touchline. If the push does not go out, the app is still right and every
 * spectator polling still sees the goal within five seconds.
 */
function notifyMatch(matchId, kind, opts = {}) {
  if (!state.admin) return;
  api.firePush(matchId, kind, opts).catch(() => {});
}

/* ── one buzz per goal ───────────────────────────────────── */
/**
 * A GOAL IS ANNOUNCED ONCE, AFTER A SHORT WAIT.
 *
 * The first design sent two pushes — the score immediately, then the scorer
 * once someone had picked him, carrying the same tag and `renotify: false` so
 * it would rewrite the first in silence. Chrome honours that. **iOS does not**:
 * it requires every push to show something, so the "silent update" arrived as
 * a second banner and every goal buzzed twice. Two buzzes for one goal teaches
 * people to ignore the first, which is the opposite of the point.
 *
 * So: one push, and the wait exists to let the scorer be picked first. In
 * practice it rarely runs the full seven seconds, because picking the scorer
 * fires it immediately — the timer is the fallback for when nobody does.
 *
 * It also buys something the instant version could not have: A MIS-TAPPED GOAL
 * VOIDED INSIDE THE WINDOW IS NEVER ANNOUNCED AT ALL. Before, a wrong goal
 * went out instantly and could not be recalled; the correction just left a
 * false notification sitting on a few hundred lock screens.
 *
 * Seven seconds is late by no measure anyone will notice: the app's own polling
 * is five seconds, and nobody times a goal alert against a stopwatch.
 */
const GOAL_PUSH_DELAY_MS = 7000;
/** Goals waiting to be announced, by event id. In memory on purpose — if the
 *  organiser closes the app inside the window, not announcing is the right
 *  outcome, not a thing to resurrect later. */
const pendingGoalPush = new Map();

function scheduleGoalPush(matchId, eventId) {
  cancelGoalPush(eventId);
  pendingGoalPush.set(eventId, setTimeout(() => {
    pendingGoalPush.delete(eventId);
    notifyMatch(matchId, 'goal', { event_id: eventId });
  }, GOAL_PUSH_DELAY_MS));
}

function cancelGoalPush(eventId) {
  const t = pendingGoalPush.get(eventId);
  if (t) { clearTimeout(t); pendingGoalPush.delete(eventId); }
}

/** The scorer is known (or explicitly skipped): stop waiting and send. The
 *  small delay lets the queued write land before the function reads the row —
 *  pushing first would announce a goal with nobody's name on it. */
function flushGoalPush(matchId, eventId) {
  cancelGoalPush(eventId);
  setTimeout(() => notifyMatch(matchId, 'goal', { event_id: eventId }), 1200);
}

/* ── goal and full-time notifications ────────────────────── */
/**
 * WHY THIS IS GATED ON BEING INSTALLED. Apple does not deliver Web Push to a
 * Safari tab — only to an app added to the home screen, on iOS 16.4 or later.
 * Offering the toggle in a tab would produce a permission dialog that grants
 * something which then never arrives, which is worse than not offering it.
 * Android is more forgiving, but the same rule is applied to both so there is
 * one story to tell a reader rather than two.
 *
 * Anyone who taps it before installing is told why, rather than being let
 * through into a dead end.
 */
const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

/** What this device is currently signed up for, read from the browser rather
 *  than from our own storage — the browser is the authority, and a permission
 *  revoked in Settings must show up here immediately. */
/**
 * NEVER `navigator.serviceWorker.ready` HERE. That promise does not resolve
 * when no worker is registered — it waits, for ever — so this function hung
 * and `state.push` stayed null, and the panel told a perfectly capable browser
 * that it "cannot show match notifications". Caught locally, where the dev
 * server cannot register a worker at all; it would also have hit any real
 * device whose registration failed. `getRegistration()` settles immediately,
 * with undefined when there is nothing.
 */
async function swRegistration() {
  try {
    return await navigator.serviceWorker.getRegistration()
      ?? await navigator.serviceWorker.register('./sw.js');
  } catch { return null; }
}

async function readPushState() {
  if (!pushSupported()) { state.push = { supported: false }; return; }
  let sub = null;
  try {
    const reg = await swRegistration();
    sub = reg ? await reg.pushManager.getSubscription() : null;
  } catch { /* no worker yet */ }
  state.push = {
    supported: true,
    permission: Notification.permission,       // 'default' | 'granted' | 'denied'
    subscribed: !!sub,
    endpoint: sub?.endpoint ?? null,
  };
}

async function enablePush(teamId) {
  if (!pushSupported()) return;
  // The permission request MUST come from a real tap. Calling it from a timer
  // or after an await chain that loses the gesture is silently refused on iOS.
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { await readPushState(); render(); return; }

  const reg = await swRegistration();
  if (!reg) throw new Error('Notifications need the service worker, which did not start.');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,                     // required; we always show something
    applicationServerKey: b64ToBytes(api.VAPID_PUBLIC_KEY),
  });
  const j = sub.toJSON();
  await api.subscribePush(j.endpoint, j.keys, teamId ?? null, pushKinds());
  try { localStorage.setItem('cofta.push.team', teamId ?? ''); } catch {}
  await readPushState();
  render();
}

async function disablePush() {
  try {
    const reg = await swRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      // Tell the server FIRST. If unsubscribe() succeeded and the delete then
      // failed, the row would live on as an endpoint nobody can ever reach,
      // and every future send would waste a request failing against it.
      await api.unsubscribePush(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* nothing to remove */ }
  try { localStorage.removeItem('cofta.push.team'); } catch {}
  await readPushState();
  render();
}

/** Which club this device chose, or '' for everything. */
const pushTeam = () => {
  try { return localStorage.getItem('cofta.push.team') ?? ''; } catch { return ''; }
};

/**
 * The notifications panel. Lives in the Organiser/Settings tab where anyone
 * can reach it at any time, and is offered from the install bar once someone
 * has actually installed.
 */
function notifySection() {
  const p = state.push;
  if (!p?.supported) {
    return `<div class="sect">Notifications</div>
      <p class="note" style="padding-top:0">This browser cannot show match notifications.</p>`;
  }

  // NOT INSTALLED IS NOT A DEAD END. This used to say "add it to your home
  // screen first" and stop, which tells someone what is wrong and nothing
  // about how to fix it — and this panel is exactly where a reader arrives
  // having decided they want the alerts. The steps go here.
  if (!installed()) {
    return `<div class="sect">Notifications</div>
      <p class="note" style="padding-top:0">A buzz when a goal goes in, and again at
        full time — for one club, or the whole tournament. It needs COFTA on your
        home screen first: an alert can reach an app that has been added, never a
        browser tab. It takes about fifteen seconds.</p>
      <div class="sect">Add COFTA to your home screen</div>
      ${installHowTo()}`;
  }

  if (p.permission === 'denied') {
    return `<div class="sect">Notifications</div>
      <p class="note" style="padding-top:0">Notifications are blocked for COFTA in your
        device settings. Turn them back on there and this will work — the app
        cannot ask again once it has been refused.</p>`;
  }

  if (p.subscribed) {
    const t = pushTeam();
    const who = t ? (team(t) ? `${team(t).name}, ${team(t).city}` : t) : 'every match';
    return `<div class="sect">Notifications</div>
      <p class="note" style="padding-top:0">On for <b>${esc(who)}</b>.</p>
      <div class="notifychoice">${notifyChoices(t)}</div>
      <p class="note" style="padding-top:2px">Tell me about</p>
      <div class="notifychoice alerts">${alertChoices()}</div>
      <button class="act ghost" data-notify="off">Turn notifications off</button>
      ${state.admin ? `<button class="act ghost" data-notify="test"
           style="margin-top:8px">Send me a test notification</button>
         <p class="okmsg" id="pushmsg"></p>` : ''}`;
  }

  return `<div class="sect">Notifications</div>
    <p class="note" style="padding-top:0">A buzz when a goal goes in, and again at
      full time. Choose one club or the whole tournament — twelve group matches
      in a day is a lot of notifications if you only came for one of them.</p>
    <div class="notifychoice">${notifyChoices(null)}</div>`;
}

/**
 * The seven things that can be announced.
 *
 * Order is by how much a reader would mind missing it, not by when it happens
 * in a match: goals and the result first, the run-of-play markers after. The
 * default is the first two, and everything else is opt-in — twelve matches of
 * cards and kick-offs on one Saturday is a phone nobody wants in their pocket.
 */
const ALERT_KINDS = [
  ['goal',        'Goals'],
  ['full_time',   'Full time'],
  ['half_time',   'Half time'],
  ['start',       'Kick-off'],
  ['second_half', 'Second half'],
  ['card',        'Cards'],
  ['motm',        'Man of the match'],
];
const DEFAULT_KINDS = ['goal', 'full_time'];

/** What this device has chosen, remembered locally so the panel can show it
 *  without a read path into the subscriber table (there deliberately is none). */
function pushKinds() {
  try {
    const raw = localStorage.getItem('cofta.push.kinds');
    const k = raw ? JSON.parse(raw) : null;
    return Array.isArray(k) && k.length ? k : [...DEFAULT_KINDS];
  } catch { return [...DEFAULT_KINDS]; }
}

function alertChoices() {
  const on = new Set(pushKinds());
  return ALERT_KINDS.map(([k, label]) =>
    `<button class="${on.has(k) ? 'on' : ''}" data-alert="${k}"
       aria-pressed="${on.has(k)}">${esc(label)}</button>`).join('');
}

/** One button per choice. Real buttons, and the current one is marked. */
function notifyChoices(current) {
  const entered = Object.values(state.teams)
    .filter(t => t.group_letter)
    .sort((a, b) => a.city.localeCompare(b.city));
  const btn = (val, label, on) =>
    `<button class="${on ? 'on' : ''}" data-notify="${esc(val)}"
       aria-pressed="${on}">${esc(label)}</button>`;
  return btn('all', 'Every match', current === '' && state.push?.subscribed)
    + entered.map(t => btn(t.id, t.city, current === t.id)).join('');
}

/* ── staying current ─────────────────────────────────────── */
/**
 * Register the worker, and tell the reader when a new build is ready.
 *
 * THE URL VERSIONING IN index.html IS WHAT ACTUALLY FIXES STALENESS — see the
 * long note in sw.js. This is the other half: the half for a page that is
 * ALREADY OPEN when a deploy lands, which no amount of cache strategy can
 * help, because its JavaScript is already parsed and running. Nothing short of
 * a reload replaces running code, and a spectator has no reason to guess that
 * one is needed. Silence there is what turned a twenty-second deploy into
 * "delete the app and clear site data".
 *
 * So: watch for a worker that has installed behind us, and surface one small
 * bar the reader can tap. Not an auto-reload — someone mid-way through
 * entering a goal must not have the page pulled out from under them, and the
 * organiser's write queue is in memory. Their tap, their timing.
 *
 * `controllerchange` fires when the new worker takes over; on a page that was
 * already controlled, that means the code running right now is a version
 * behind. `registration.waiting` covers the case where the new worker
 * installed but is held, which is the state the two-reload quirk leaves.
 */
function updateBanner() {
  if ($('newbuild')) return;
  const bar = document.createElement('button');
  bar.id = 'newbuild';
  bar.className = 'newbuild';
  bar.type = 'button';
  bar.innerHTML = 'New version available <span>Tap to refresh</span>';
  bar.addEventListener('click', () => location.reload());
  document.body.appendChild(bar);
}

function watchForUpdates() {
  // Whether this page was under a worker BEFORE we registered. On a first
  // visit it is false, and `clients.claim()` then fires controllerchange for
  // the ordinary arrival of the app — which is not an update and must not
  // greet a new reader with "new version available".
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Already holding a new worker when we arrived.
    if (reg.waiting && hadController) updateBanner();

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // `controller` is null on the very first visit, when installing a
        // worker is not an update — it is the app arriving. Only an install
        // that displaces an existing controller is news to the reader.
        if (sw.state === 'installed' && hadController) updateBanner();
      });
    });

    // A phone that sits on the page all afternoon never navigates, so nothing
    // ever asks whether there is a new build. Ask on the way back from the
    // lock screen or another app, which on a matchday is most of the time.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) updateBanner();
  });
}

/* ── boot ────────────────────────────────────────────────── */
(async function boot() {
  applyTheme(theme);

  // Boot from the last known snapshot, so a phone with no signal still opens
  // to yesterday's state (marked stale) instead of an empty screen. The
  // server's `now` in a cached snapshot is old, so the clock offset is NOT
  // synced from it — only a live poll may do that.
  try {
    const cached = JSON.parse(localStorage.getItem('cofta.snap.v1') || 'null');
    if (cached) { applySnap(cached); render(); }
  } catch { /* nothing cached */ }

  // Which build this page is actually executing. Kept deliberately: it is how
  // the stale-PWA report was diagnosed, it costs one string, and "what is that
  // phone running?" is otherwise unanswerable from the outside.
  window.__build = BUILD;

  if ('serviceWorker' in navigator) {
    watchForUpdates();
    readPushState().then(render);
    // A notification tap on an already-open app: the worker focuses this
    // window and posts where to go, because opening a second copy of a
    // polling app is the last thing a venue's wifi needs.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type !== 'cofta:open') return;
      const m = /[?&]match=([^&]+)/.exec(e.data.url || '');
      if (m) { state.view = 'match'; state.matchId = decodeURIComponent(m[1]); state.from = 'fixtures'; }
      render();
    });
  }

  // Who are we? Ask the server, and if the network cannot answer, fall back
  // to the last answer it gave. Failing closed here looked safe and was not:
  // it signed an organiser out of their own controls during precisely the
  // outage the offline queue was built for. The trust is cosmetic — every
  // write is still checked server-side when the queue drains.
  if (api.isSignedIn()) {
    try {
      const seen = await api.checkRole();
      state.admin = seen.admin; state.role = seen.role;
      state.roleVerified = true;
    } catch {
      const remembered = api.cachedRole();
      state.admin = !!remembered?.admin;
      state.role = remembered?.role ?? null;
      state.roleVerified = false;
    }
  }
  await poll();
  setInterval(poll, POLL_MS);
  setInterval(tick, 250);
  // keep the session alive across a long matchday
  setInterval(() => { if (api.isSignedIn()) api.refreshSession().catch(() => {}); }, 45 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  // coming back onto signal is the moment to settle an optimistically adopted
  // role, and the moment a revocation made during the outage should bite
  window.addEventListener('online', () => { reverifyRole(true); poll(); });
})();
