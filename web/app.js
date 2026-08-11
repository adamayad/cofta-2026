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

const state = {
  snap: null, teams: {}, matches: [], events: [], slots: {}, players: [],
  picker: null,        // { type, side } while an organiser chooses a player
  view: 'fixtures', day: 1, matchId: null, from: 'fixtures',
  admin: false, lastFetch: 0, error: null, busy: false, pens: null,
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
async function poll() {
  const sent = Date.now();
  try {
    const snap = await api.fetchSnapshot();
    M.syncFromSnapshot(snap.now, sent);
    state.snap = snap;
    state.teams = Object.fromEntries((snap.teams || []).map(t => [t.id, t]));
    state.matches = snap.matches || [];
    state.events = snap.events || [];
    state.players = snap.players || [];
    state.slots = snap.slots || {};
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
const crest  = (id) => CREST[id] || '';

/** Knockout ties whose teams are not yet set get filled from the tables. */
function resolvedMatches() {
  const list = state.matches.map(m => ({ ...m }));
  const teamsArr = Object.values(state.teams);
  if (!teamsArr.length) return list;
  const slots = M.resolveSlots(teamsArr, list, state.slots);
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
function clubBlock(id, cls = '') {
  if (!id) return `<span class="side tbc ${cls}" style="--c:var(--line2)">
    <span class="who"><b>To be confirmed</b></span></span>`;
  return `<span class="side ${cls}" style="--c:${colOf(id)}">
    <span class="tile" style="--c:${colOf(id)}"><img src="${crest(id)}" alt=""></span>
    <span class="who"><b>${esc(nameOf(id))}</b><i>${esc(cityOf(id))}</i></span></span>`;
}

/* ── fixtures ────────────────────────────────────────────── */
function fixtureRow(m) {
  let score, sub;
  if (!M.hasStarted(m) && !m.ff) {
    score = '<span class="pend">v</span>';
    sub = `<span class="st">${esc(m.kickoff)}</span>`;
  } else {
    score = `${m.hs}\u2013${m.as}`;
    const live = M.isLive(m);
    sub = `<span class="st ${live ? 'live' : ''}">${esc(M.statusLabel(m))}</span>`;
  }
  return `<button class="fx" data-match="${m.id}">
    <span class="t"><b>${esc(m.kickoff)}</b>${esc(M.stageLabel(m))}</span>
    <span class="n">${clubBlock(m.home)}${clubBlock(m.away)}</span>
    <span class="r tnum">${score}${sub}</span></button>`;
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
  const side = (id, score, other) => `
    <div class="sl ${lead(score, other)}" style="--c:${colOf(id)}">
      ${id ? `<span class="bdg"><img src="${crest(id)}" alt=""></span>` : '<span class="bdg"></span>'}
      <span class="who"><b>${esc(nameOf(id))}</b><i>${esc(cityOf(id))}</i></span>
      <span class="gl tnum">${score}</span></div>`;

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
        <span class="mk tnum ${x.t === 'goal' ? 'goal' : ''}">${esc(x.min || '')}</span>
        <span class="tx">${eventText(x, m)}${x.pending ? ' <em>sending\u2026</em>' : ''}</span>
        ${state.admin && !x.pending ? `<button class="undo" data-void="${x.id}">Undo</button>` : '<span></span>'}
      </li>`).join('')
    : '<div class="empty">Nothing to report yet.</div>';

  return `<button class="back" data-view="${state.from}">&larr; ${state.from === 'live' ? 'Live now' : 'All fixtures'}</button>
    <div class="stack">${side(m.home, hs, as)}${side(m.away, as, hs)}</div>
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

  return `<div class="picker">
      <div class="pkhd"><span>${label}</span>
        <button data-pick-cancel="1">Cancel</button></div>
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

  const tbl = (g) => M.standings(teamsArr, ms, g).map((r, i) => `
      <tr class="${i < 2 && !r.team.disqualified ? 'up' : ''} ${r.team.disqualified ? 'dq' : ''} ${r.unresolved ? 'unres' : ''}">
        <td class="nm"><span class="in"><span class="rk">${i + 1}</span>
          <span class="tile" style="--c:${r.team.colour}"><img src="${crest(r.team.id)}" alt=""></span>
          <span class="who"><b>${esc(r.team.name)}${r.team.disqualified ? '<span class="tag">DQ</span>' : ''}${r.unresolved ? '<span class="tag lvl">Level</span>' : ''}</b>
          <i>${esc(r.team.city)}</i></span></span></td>
        <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
        <td>${r.p ? (r.gd > 0 ? '+' : r.gd < 0 ? '\u2212' : '') + Math.abs(r.gd) : '\u2013'}</td>
        <td class="p">${r.pts}</td></tr>`).join('');

  const head = `<thead><tr><th class="nm">Club</th><th>P</th><th>W</th><th>D</th>
    <th>L</th><th>GD</th><th>Pts</th></tr></thead>`;

  const slot = (id, fb) => id ? esc(cityOf(id)) : fb;
  const s = M.resolveSlots(teamsArr, ms, state.slots);

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
    M.unresolvedPairs(teamsArr, ms, g).map(p => ({ g, ...p })))
    .filter(p => p.i <= 1);   // 3rd v 4th decides nothing, so say nothing
  if (!pairs.length) return '';
  const names = pairs.map(p =>
    `${cityOf(p.a.team.id)} and ${cityOf(p.b.team.id)}`).join('; ');
  return `<div class="banner warn">${esc(names)} finished level on points,
    head-to-head, goal difference and goals scored. Under the rules that is
    settled by a one-off penalty shoot-out.</div>`;
}

/** Which semi-final slots a level pair decides. Pair i is rows i and i+1:
 *  the top pair decides both qualifying slots; the 2nd/3rd pair decides only
 *  who takes the runner-up slot; 3rd/4th decides nothing. */
function tieSlots(g, i) {
  if (i === 0) return {
    winner: g === 'A' ? 'sf1_home' : 'sf2_home',
    loser:  g === 'A' ? 'sf2_away' : 'sf1_away',
  };
  if (i === 1) return { winner: g === 'A' ? 'sf2_away' : 'sf1_away', loser: null };
  return null;
}

/** The organiser's prompt: enter the one-off shoot-out result and the Sunday
 *  line-up fills in from it. Whoever is running that group's pitch does it —
 *  both admin accounts see the same panel, so either can. */
function tieShootoutPanels(teamsArr, ms) {
  const pairs = ['A', 'B'].flatMap(g =>
    M.unresolvedPairs(teamsArr, ms, g).map(p => ({ g, ...p })));
  if (!pairs.length) return '';

  return pairs.map(p => {
    const slots = tieSlots(p.g, p.i);
    if (!slots) return '';
    const key = p.g + p.i;
    const sc = state.tiePens[key] ?? { a: 0, b: 0 };
    const settled = slots.winner && state.slots[slots.winner];

    if (settled) return `<div class="banner">${esc(cityOf(p.a.team.id))} and
      ${esc(cityOf(p.b.team.id))} finished level; the one-off shoot-out result
      has been entered and the Sunday line-up reflects it.</div>`;

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
          rules go to a one-off penalty shoot-out. Enter the result and the
          Sunday line-up fills in from it.</p>
        ${row('a', p.a.team.id, sc.a)}${row('b', p.b.team.id, sc.b)}
        <div class="two" style="grid-template-columns:1fr">
          <button class="act" data-tieconfirm="${key}" ${sc.a === sc.b ? 'disabled' : ''}>
            Confirm shoot-out result</button></div>
      </div>`;
  }).join('');
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
function viewAdmin() {
  if (state.admin) {
    return `<div class="sect">Signed in</div>
      <p class="note" style="padding-top:0">You have write access. Open any match to run its clock
        and log events. Controls appear inline.</p>
      <button class="act ghost" id="signout">Sign out</button>`;
  }
  return `<div class="sect">Organiser sign in</div>
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
  ['fixtures', 'live', 'tables', 'awards', 'admin'].forEach(v =>
    $('nav-' + v)?.classList.toggle('on', navFor === v));

  const body =
    state.view === 'fixtures' ? viewFixtures() :
    state.view === 'live'     ? viewLive()     :
    state.view === 'match'    ? viewMatch()    :
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
  const mm = $('mmin'), el = $('mel');
  if (mm) mm.textContent = M.minuteLabel(m);
  if (el) el.textContent = M.mmss(M.elapsedMs(m));
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
  const t = ev.target.closest('[data-view],[data-day],[data-match],[data-clock],[data-goal],[data-card],[data-pick],[data-pick-side],[data-pick-cancel],[data-void],[data-ff],[data-pen],[data-pen-confirm],[data-tiepen],[data-tieconfirm],[data-dq],#signin,#signout');
  if (!t) return;

  if (t.dataset.view) { state.view = t.dataset.view; state.picker = null; render(); return; }
  if (t.dataset.day) { state.day = +t.dataset.day; state.picker = null; render(); return; }
  if (t.dataset.match) {
    state.from = (state.view === 'live') ? 'live' : 'fixtures';
    state.matchId = t.dataset.match; state.view = 'match';
    state.pens = null; state.picker = null; render(); return;
  }

  const m = currentMatch();

  if (t.dataset.clock && m) return guard(() =>
    api.setClock(m.id, t.dataset.clock, m.v, M.HALF_MS));

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
      M.unresolvedPairs(teamsArr, ms, g).map(p => ({ g, ...p })))
      .find(p => p.g + p.i === key);
    const sc = state.tiePens[key];
    if (!pair || !sc || sc.a === sc.b) return;
    const slots = tieSlots(pair.g, pair.i);
    if (!slots) return;
    const winner = sc.a > sc.b ? pair.a.team.id : pair.b.team.id;
    const loser  = sc.a > sc.b ? pair.b.team.id : pair.a.team.id;
    return guard(async () => {
      if (slots.winner) await api.setSlot(slots.winner, winner);
      if (slots.loser)  await api.setSlot(slots.loser, loser);
      delete state.tiePens[key];
    });
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
      if (!state.admin) { $('autherr').textContent = 'Signed in, but this account is not an organiser.'; }
      state.view = state.admin ? 'fixtures' : 'admin';
      await poll();
    } catch (e) { $('autherr').textContent = e.message; }
    return;
  }

  if (t.id === 'signout') { api.signOut(); state.admin = false; render(); return; }
});

document.addEventListener('change', (ev) => {
  const s = ev.target.closest('[data-slot]');
  if (!s) return;
  guard(() => api.setSlot(s.dataset.slot, s.value || null));
});

/* ── boot ────────────────────────────────────────────────── */
(async function boot() {
  if (api.isSignedIn()) {
    try { state.admin = !!(await api.amAdmin()); } catch { state.admin = false; }
  }
  await poll();
  setInterval(poll, POLL_MS);
  setInterval(tick, 250);
  // keep the session alive across a long matchday
  setInterval(() => { if (api.isSignedIn()) api.refreshSession().catch(() => {}); }, 45 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
