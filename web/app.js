/**
 * COFTA 2026 — application
 *
 * Spectators poll snapshot() every few seconds. The clock is derived locally
 * from timestamps, so it ticks smoothly at 60fps between polls and never
 * lags. Admins get the same views plus the write controls.
 */
import { CREST } from './crests.js';
import * as api from './api.js';
import * as M from './model.js';
import { WriteQueue } from './queue.js';

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
  picker: null,        // { type, side } while an organiser chooses a player
  view: 'fixtures', day: 1, matchId: null, from: 'fixtures',
  sq: { team: null, player: null },
  admin: false, role: null, squadTeam: null, editor: null,
  lastFetch: 0, error: null, busy: false, pens: null,
  tiePens: {},
};

/** Events are queued so a tap on bad signal is never lost. The queue sends
 *  through the same RPC layer, so idempotency and auth still apply.
 *  Created AFTER `state`: subscribe fires its callback immediately, and that
 *  callback reads `state` — declaring the queue first was a TDZ crash that
 *  took the whole module down before boot() could run. */
const queue = new WriteQueue((fn, args) => api.rpc(fn, args, true));
let queueState = { depth: 0, failing: false };
queue.subscribe(s => { queueState = s; if (state.snap) render(); });

/* ── data ────────────────────────────────────────────────── */
function applySnap(snap) {
  state.snap = snap;
  state.teams = Object.fromEntries((snap.teams || []).map(t => [t.id, t]));
  state.matches = snap.matches || [];
  state.events = snap.events || [];
  state.players = snap.players || [];
  state.slots = snap.slots || {};
  state.ties = snap.ties || [];
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
function clubBlock(id, cls = '', score = null, reds = 0) {
  const sc = score != null ? `<span class="ssc tnum">${score}</span>` : '';
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
  else if (m.status === 'full_time')
    tst = m.pd ? `FT<i>${m.ph}\u2013${m.pa}p</i>` : 'FT';

  return `<button class="fx ${started ? 'started' : 'sched'}" data-match="${m.id}">
    <span class="t"><b>${esc(m.kickoff)}</b>${esc(M.stageLabel(m))}
      ${tst ? `<span class="tst ${tstLive ? 'live' : ''} tnum">${tst}</span>` : ''}</span>
    <span class="n">${clubBlock(m.home, '', started ? m.hs : null, redsFor(m, 'home'))}${clubBlock(m.away, '', started ? m.as : null, redsFor(m, 'away'))}</span>
    <span class="r tnum"><span class="rsc">${score}</span>${sub}</span></button>`;
}

function viewFixtures() {
  const all = resolvedMatches().filter(m => m.day === state.day);
  const rows = all.map(fixtureRow).join('');

  return `<div class="daysel">
      <button data-day="1" class="${state.day === 1 ? 'on' : ''}">Sat 12 Sept</button>
      <button data-day="2" class="${state.day === 2 ? 'on' : ''}">Sun 13 Sept</button>
    </div>
    ${rows || '<p class="empty">No fixtures for this day.</p>'}
    <p class="note">${state.day === 1
      ? 'Twelve group matches across two pitches. Each carries its own clock, so several run live at once.'
      : 'Semi-finalists fill in automatically once the group tables are final.'}</p>`;
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
    .map(l => `<i class="gline">${l.name ? esc(l.name) + ' ' : ''}${l.mins.map(esc).join(', ')}${l.og ? ' (OG)' : ''}</i>`)
    .join('');

  const side = (id, score, other, sideKey) => `
    <div class="sl ${lead(score, other)}" style="--c:${colOf(id)};--tc:${txtOf(id)}">
      ${id ? `<span class="bdg"><img src="${crest(id)}" alt=""></span>` : '<span class="bdg"></span>'}
      <span class="who"><b>${esc(nameOf(id))}</b><i>${esc(cityOf(id))}</i></span>
      <span class="gl tnum">${score}</span>
      ${lines(sideKey) ? `<span class="gls">${lines(sideKey)}</span>` : ''}</div>`;

  let clock, phase;
  if (!M.hasStarted(m) && !m.ff) { clock = '<div class="m idle">\u2014\u2014</div>'; phase = 'Awaiting kick-off'; }
  else if (m.status === 'half_time') { clock = '<div class="m idle">HT</div>'; phase = 'Half time'; }
  else if (m.status === 'full_time' || m.ff) { clock = '<div class="m idle">FT</div>'; phase = m.ff ? 'Forfeit' : 'Full time'; }
  else {
    clock = `<div class="m"><span id="mmin" class="tnum">${M.minuteLabel(m)}</span>\u2032</div>`;
    phase = (m.status === 'first_half' ? 'First half' : 'Second half') + (m.run ? '' : ' \u00b7 stopped');
  }

  const e = M.elapsedMs(m);
  let added = '';
  if (m.status === 'first_half' && e > M.HALF_MS) added = 'Into added time at the end of the first half';
  if (m.status === 'second_half' && e > 2 * M.HALF_MS) added = 'Into added time at the end of the second half';

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
          ? `<span class="rowacts"><button class="undo" data-edit="${x.id}">Edit</button>
             <button class="undo" data-void="${x.id}">Undo</button></span>`
          : '<span></span>'}
      </li>`).join('')
    : '<div class="empty">Nothing to report yet.</div>';

  return `<button class="back" data-view="${state.from}">&larr; ${state.from === 'live' ? 'Live now' : 'All fixtures'}</button>
    <div class="stack">${side(m.home, hs, as, 'home')}${side(m.away, as, hs, 'away')}
      <span class="midchip ${M.isLive(m) ? 'live' : ''}" id="midchip">${
        m.ff ? 'FT'
        : !M.hasStarted(m) ? esc(m.kickoff)
        : m.status === 'half_time' ? 'HT'
        : m.status === 'full_time' ? 'FT'
        : M.mmss(M.elapsedMs(m))}</span></div>
    ${motmLine(m)}
    <p class="kick"><span>${m.day === 1 ? 'Sat 12' : 'Sun 13'} Sept &middot; ${esc(m.kickoff)}
      &middot; ${esc(M.stageLabel(m))} &middot; ${esc(m.pitch)}</span>
      ${M.isLive(m) && m.run ? '<span class="lv"><i></i>Live</span>' : ''}</p>
    <div class="ck">
      <div>${clock}${added ? `<div class="stop">${added}</div>` : ''}</div>
      <div class="rail"><span class="ph">${esc(phase)}</span>
        <span class="el tnum" id="mel">${M.mmss(e)}</span></div>
    </div>
    ${m.pd ? `<p class="note">Won ${m.ph}\u2013${m.pa} on penalties. The match stands as a draw,
       so no goal difference is affected.</p>` : ''}
    ${suspensionNotice(m)}
    ${state.admin ? adminMatchControls(m) : ''}
    <div class="sect">Match report</div>
    ${state.editor ? editorPanel(m) : ''}
    <ol class="tl">${timeline}</ol>`;
}

/** Who cannot play in this match, and why. Shown before kick-off so an
 *  organiser finds out in time to do something about it. */
function suspensionNotice(m) {
  if (M.hasStarted(m)) return '';
  const byId = Object.fromEntries(state.players.map(p => [p.id, p]));
  const out = M.suspendedFor(m.id, resolvedMatches(), state.events, byId);
  if (!out.length) return '';
  const rows = out.map(s => `<li><span class="nmx">${esc(s.player)}</span>
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
  const by = nm ? `<b>${esc(nm)}</b>` : null;
  switch (x.t) {
    case 'goal':     return by ? `${by} <i>(${esc(cityOf(who))})</i>` : `<b>${esc(nameOf(who))}</b> score`;
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

  return `<div class="picker">
      <div class="pkhd"><span>${label}</span>
        <button data-edcancel="1">Cancel</button></div>
      ${minuteField}
      ${search}
      <div class="pklist">
        <button class="pk ${sel == null ? 'on' : ''}" data-edpick="none">
          <span class="no"></span><span>No player recorded</span></button>
        ${names}
      </div>
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
  const row = (side, id, v) => `<div class="pr" style="--c:${colOf(id)}">
      <span class="bd"><img src="${crest(id)}" alt=""></span>
      <span class="nx">${esc(nameOf(id))}</span>
      <span class="pm"><button data-pen="${side}:-1">&minus;</button>
        <button data-pen="${side}:1">+</button></span>
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

  const tbl = (g) => M.standings(teamsArr, ms, g, state.ties).map((r, i) => `
      <tr class="${i < 2 && !r.team.disqualified ? 'up' : ''} ${r.team.disqualified ? 'dq' : ''} ${r.unresolved ? 'unres' : ''}">
        <td class="nm"><span class="in"><span class="rk">${i + 1}</span>
          <span class="tile" style="--c:${r.team.colour}"><img src="${crest(r.team.id)}" alt=""></span>
          <span class="who"><b>${esc(r.team.name)}${r.team.disqualified ? '<span class="tag">DQ</span>' : ''}${r.unresolved ? '<span class="tag lvl">Level</span>' : ''}${r.tie === 'W' ? '<span class="tag so">Shoot-out</span>' : ''}</b>
          <i>${esc(r.team.city)}</i></span></span></td>
        <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
        <td>${r.p ? (r.gd > 0 ? '+' : r.gd < 0 ? '\u2212' : '') + Math.abs(r.gd) : '\u2013'}</td>
        <td class="p">${r.pts}</td></tr>`).join('');

  const head = `<thead><tr><th class="nm">Club</th><th>P</th><th>W</th><th>D</th>
    <th>L</th><th>GD</th><th>Pts</th></tr></thead>`;

  const slot = (id, fb) => id ? esc(cityOf(id)) : fb;
  const s = M.resolveSlots(teamsArr, ms, state.slots, state.ties);

  return `<div class="sect">Group A</div><table>${head}<tbody>${tbl('A')}</tbody></table>
    <div class="sect">Group B</div><table>${head}<tbody>${tbl('B')}</tbody></table>
    <p class="note">Computed from logged events, never typed by hand. Ranked on points,
      then head-to-head, then goal difference, then goals scored.</p>
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
        <span class="pm"><button data-tiepen="${key}:${side}:-1">&minus;</button>
          <button data-tiepen="${key}:${side}:1">+</button></span>
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
function statsFor(pid) {
  const mine = state.events.filter(e => e.p === pid);
  return {
    goals: mine.filter(e => e.t === 'goal'),
    og:    mine.filter(e => e.t === 'own_goal').length,
    y:     mine.filter(e => e.t === 'yellow').length,
    r:     mine.filter(e => e.t === 'red').length,
    motm:  mine.filter(e => e.t === 'motm').length,
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

    return `<button class="back" data-sqteam="${pl.team}">&larr; ${esc(t?.city ?? 'Squad')}</button>
      <div class="stack"><div class="sl" style="--c:${colOf(pl.team)};--tc:${txtOf(pl.team)}">
        <span class="bdg"><img src="${crest(pl.team)}" alt=""></span>
        <span class="who"><b>${esc(pl.name)}</b>
          <i>${esc(nameOf(pl.team))} \u00b7 ${esc(cityOf(pl.team))}</i></span></div><div class="sl alt num"
        style="--c:${colOf(pl.team)}"><span class="bignum tnum">${pl.no ?? ''}</span></div></div>
      ${sus ? `<div class="banner warn">Suspended (${esc(sus.reason.toLowerCase())})
        ${sus.misses ? `\u2014 misses the ${esc(M.stageLabel(sus.misses))} fixture` : ''}.</div>` : ''}
      <div class="sect">This tournament</div>
      <div class="stats">
        <div class="stat"><i>Goals</i><b class="tnum">${st.goals.length}</b></div>
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
    return `<button class="back" data-view="squads">&larr; All clubs</button>
      <div class="stack"><div class="sl" style="--c:${colOf(t.id)};--tc:${txtOf(t.id)}">
        <span class="bdg"><img src="${crest(t.id)}" alt=""></span>
        <span class="who"><b>${esc(t.name)}</b><i>${esc(t.city)}</i></span></div><div class="sl alt">
        <span class="altbox"><i>Manager</i><b>${t.manager ? esc(t.manager) : '\u2014'}</b>
          <i style="margin-top:6px">Group ${esc(t.group_letter ?? '')}</i></span></div></div>
      ${squad.length
        ? `<div class="sect">Squad \u00b7 ${squad.length}</div><div class="pklist" style="max-height:none">${rows}</div>
           <p class="note">Tap a player for their tournament record.</p>`
        : `<p class="empty">No squad list loaded for ${esc(t.city)} yet.</p>`}`;
  }

  // all clubs
  const cards = teamsArr.map(t => `<button class="fx" data-sqteam="${t.id}">
      <span class="t"><b>${esc(t.group_letter ?? '')}</b>Group</span>
      <span class="n"><span class="side" style="--c:${t.colour}">
        <span class="tile" style="--c:${t.colour}"><img src="${crest(t.id)}" alt=""></span>
        <span class="who"><b>${esc(t.name)}</b><i>${esc(t.city)}</i></span></span></span>
      <span class="r tnum"><span class="rsc" style="font-size:14px;color:var(--dim)">${squadOf(t.id).length}</span>
        <span class="st">players</span></span></button>`).join('');
  return `<div class="sect">Clubs</div>${cards}
    <p class="note">Every goal, card and award is attributed live, so each player's
      tournament record builds itself as the weekend goes on.</p>`;
}

/* ── awards ──────────────────────────────────────────────── */
function viewAwards() {
  const teamsArr = Object.values(state.teams);
  const ms = resolvedMatches();
  if (!teamsArr.length) return '<p class="empty">Loading\u2026</p>';

  const byId = Object.fromEntries(state.players.map(p => [p.id, p]));
  const a = M.awards(teamsArr, ms, state.events, byId);
  const anyPlayed = ms.some(M.hasStarted);

  if (!anyPlayed) return `<div class="sect">Awards</div>
    <p class="empty">Nothing decided yet. The golden boot, player of the tournament
      and golden glove fill in as matches are played.</p>`;

  const card = (title, body, foot) => `<div class="award">
      <span class="at">${title}</span>${body}
      ${foot ? `<p class="af">${foot}</p>` : ''}</div>`;

  const boot = a.goldenBoot.count
    ? card('Golden boot',
        `<p class="an">${a.goldenBoot.names.map(esc).join(' &amp; ')}</p>
         <p class="ac tnum">${a.goldenBoot.count} goal${a.goldenBoot.count === 1 ? '' : 's'}</p>`,
        a.goldenBoot.shared ? 'Shared \u2014 a duplicate trophy is bought for the joint winner.' : '')
    : card('Golden boot', '<p class="an dim">No goals attributed yet</p>',
        'Goals count towards this only when a scorer is named.');

  const pot = a.playerOfTournament.count
    ? card('Player of the tournament',
        `<p class="an">${a.playerOfTournament.names.map(esc).join(' &amp; ')}</p>
         <p class="ac tnum">${a.playerOfTournament.count} man of the match award${a.playerOfTournament.count === 1 ? '' : 's'}</p>`,
        a.playerOfTournament.shared ? 'Level on awards.' : '')
    : card('Player of the tournament', '<p class="an dim">Not yet awarded</p>',
        'Decided by the most man of the match awards.');

  const glove = a.goldenGlove.winners.length
    ? card('Golden glove',
        a.goldenGlove.winners.map(w => `<p class="an">${esc(w.team.city)}</p>`).join('') +
        `<p class="ac tnum">${a.goldenGlove.count} conceded in ${a.goldenGlove.winners[0].played} match${a.goldenGlove.winners[0].played === 1 ? '' : 'es'}</p>`,
        a.goldenGlove.decidedByManagers
          ? 'Level on goals conceded \u2014 decided by the church managers.'
          : 'Shared by that club\u2019s goalkeepers.')
    : '';

  const table = a.goldenGlove.conceded
    .slice().sort((x, y) => x.against - y.against || x.team.city.localeCompare(y.team.city))
    .map(c => `<tr><td class="nm"><span class="in">
        <span class="tile" style="--c:${c.team.colour}"><img src="${crest(c.team.id)}" alt=""></span>
        <span class="who"><b>${esc(c.team.city)}</b></span></span></td>
      <td>${c.played}</td><td class="p">${c.against}</td></tr>`).join('');

  return `<div class="sect">Awards</div>${boot}${pot}${glove}
    <div class="sect">Goals conceded</div>
    <table><thead><tr><th class="nm">Club</th><th>P</th><th>GA</th></tr></thead>
      <tbody>${table}</tbody></table>`;
}

/* ── admin sign in ───────────────────────────────────────── */
function appearanceSection() {
  const btns = THEMES.map(([v, label]) =>
    `<button class="${theme === v ? 'on' : ''}" data-theme-set="${v}">${label}</button>`).join('');
  return `<div class="sect">Appearance</div>
    <p class="note" style="padding-top:0">Four directions on the same live data \u2014 pick
      whichever reads best. Applies to this device only.</p>
    <div class="themes">${btns}</div>`;
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
      ${appearanceSection()}${squadSection()}${resetSection}`;
  }
  return appearanceSection() + `<div class="sect">Organiser sign in</div>
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

  // Never repaint over someone mid-type. The 5-second poll was replacing the
  // whole view, which wiped the sign-in form as it was being filled in. While
  // any input, select or textarea inside the view has focus, only the status
  // pip updates; the repaint resumes the moment focus leaves the field.
  const a = document.activeElement;
  if (a && a.tagName && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)
      && $('body') && $('body').contains && $('body').contains(a)) return;

  const navFor = state.view === 'match' ? state.from : state.view;
  ['fixtures', 'live', 'squads', 'tables', 'awards', 'admin'].forEach(v =>
    $('nav-' + v)?.classList.toggle('on', navFor === v));

  const body =
    state.view === 'fixtures' ? viewFixtures() :
    state.view === 'live'     ? viewLive()     :
    state.view === 'match'    ? viewMatch()    :
    state.view === 'squads'   ? viewSquads()   :
    state.view === 'tables'   ? viewTables()   :
    state.view === 'awards'   ? viewAwards()   : viewAdmin();

  $('body').innerHTML = body +
    (state.error ? `<div class="banner warn">Could not reach the server: ${esc(state.error)}.
       Retrying every few seconds \u2014 the last known scores are still shown.</div>` : '');
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
  const t = ev.target.closest('[data-view],[data-day],[data-match],[data-clock],[data-goal],[data-card],[data-pick],[data-pick-side],[data-pick-cancel],[data-edit],[data-edpick],[data-edsave],[data-edcancel],[data-void],[data-ff],[data-pen],[data-pen-confirm],[data-tiepen],[data-tieconfirm],[data-reset],[data-setmgr],[data-theme-set],[data-sqteam],[data-sqplayer],[data-squad],[data-delplayer],[data-addsquad],[data-dq],#signin,#signout');
  if (!t) return;

  if (t.dataset.view) {
    state.view = t.dataset.view; state.picker = null; state.editor = null;
    if (t.dataset.view === 'squads' && !t.dataset.sqteam) state.sq = { team: null, player: null };
    render(); return;
  }

  if (t.dataset.sqteam) {
    state.view = 'squads'; state.sq = { team: t.dataset.sqteam, player: null };
    render(); return;
  }
  if (t.dataset.sqplayer) {
    state.sq.player = t.dataset.sqplayer; render(); return;
  }
  if (t.dataset.day) { state.day = +t.dataset.day; state.picker = null; render(); return; }
  if (t.dataset.match) {
    state.from = (state.view === 'live') ? 'live' : 'fixtures';
    state.matchId = t.dataset.match; state.view = 'match';
    state.pens = null; state.picker = null; state.editor = null; render(); return;
  }

  const m = currentMatch();

  if (t.dataset.clock && m) return guard(() =>
    api.setClock(m.id, t.dataset.clock, m.v, M.HALF_MS,
      t.dataset.clock === 'start' ? m.home : null,
      t.dataset.clock === 'start' ? m.away : null));

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
      queue.add(api.uuid(), 'void_event', { p_id: pk.eventId });
      const ogId = api.uuid();
      queue.add(ogId, 'log_event', {
        p_id: ogId, p_match: m.id, p_type: 'own_goal',
        p_side: other, p_player: null,
        p_elapsed: Math.round(M.elapsedMs(m)),
        p_minute: M.minuteLabel(m) + '\u2032',
      });
      state.picker = { type: 'own_goal', side: other, eventId: ogId };
      render(); return;
    }

    const playerId = t.dataset.pick === 'skip' ? null : t.dataset.pick;

    if (pk.eventId) {
      // the goal is already logged; attach the scorer to it
      if (playerId) queue.add(api.uuid(), 'attribute_event',
        { p_event: pk.eventId, p_player: playerId });
    } else {
      const id = api.uuid();
      queue.add(id, 'log_event', {
        p_id: id, p_match: m.id, p_type: pk.type,
        p_side: pk.side ?? null, p_player: playerId,
        p_elapsed: Math.round(M.elapsedMs(m)),
        p_minute: M.minuteLabel(m) + '\u2032',
      });
    }
    state.picker = null;
    render();
    return;
  }

  if (t.dataset.edit) {
    const ev = state.events.find(x => x.id === t.dataset.edit);
    if (!ev) return;
    state.editor = { id: ev.id, player: ev.p ?? null,
                     minute: String(ev.min || '').replace(/[\u2032']/g, '') };
    render(); return;
  }

  if (t.dataset.edpick) {
    const box = $('edmin');
    if (box) state.editor.minute = box.value.trim();   // keep what was typed
    state.editor.player = t.dataset.edpick === 'none' ? null : t.dataset.edpick;
    render(); return;
  }

  if (t.dataset.edcancel) { state.editor = null; render(); return; }

  if (t.dataset.edsave) {
    const box = $('edmin');
    let minute = (box ? box.value : state.editor.minute || '').trim();
    if (box && !/^\d{1,2}(\+\d{1,2})?$/.test(minute)) {
      alert('Minute should look like 12, or 20+2 for added time.'); return;
    }
    if (!minute) minute = '40';
    const ed = state.editor;
    // optimistic: the report and scorer lines update instantly
    const ev = state.events.find(x => x.id === ed.id);
    if (ev) { ev.min = minute + '\u2032'; ev.p = ed.player; }
    queue.add(api.uuid(), 'edit_event',
      { p_event: ed.id, p_player: ed.player, p_minute: minute + '\u2032' });
    state.editor = null;
    render(); return;
  }

  if (t.dataset.void) {
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

  if (t.id === 'signin') {
    const email = $('em').value.trim(), pw = $('pw').value;
    $('autherr').textContent = '';
    try {
      await api.signIn(email, pw);
      state.admin = !!(await api.amAdmin());
      state.role = state.admin ? await api.myRole().catch(() => null) : null;
      if (!state.admin) { $('autherr').textContent = 'Signed in, but this account is not an organiser.'; }
      state.view = state.admin ? 'fixtures' : 'admin';
      await poll();
    } catch (e) { $('autherr').textContent = e.message; }
    return;
  }

  if (t.id === 'signout') { api.signOut(); state.admin = false; state.role = null; render(); return; }
});

// Player search: filters the visible list as you type. Action rows (own
// goal, no-player) stay visible whatever the query.
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'pkq') return;
  const q = ev.target.value.trim().toLowerCase();
  const list = ev.target.closest('.picker')?.querySelector('.pklist');
  if (!list) return;
  for (const b of list.querySelectorAll('.pk')) {
    const isAction = b.dataset.pick === 'own' || b.dataset.pick === 'skip'
      || b.dataset.edpick === 'none';
    b.style.display = (isAction || !q || b.textContent.toLowerCase().includes(q))
      ? '' : 'none';
  }
});

document.addEventListener('change', (ev) => {
  const s = ev.target.closest('[data-slot]');
  if (!s) return;
  guard(() => api.setSlot(s.dataset.slot, s.value || null));
});

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (api.isSignedIn()) {
    try {
      state.admin = !!(await api.amAdmin());
      state.role = state.admin ? await api.myRole() : null;
    } catch { state.admin = false; state.role = null; }
  }
  await poll();
  setInterval(poll, POLL_MS);
  setInterval(tick, 250);
  // keep the session alive across a long matchday
  setInterval(() => { if (api.isSignedIn()) api.refreshSession().catch(() => {}); }, 45 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
