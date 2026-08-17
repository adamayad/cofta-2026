/**
 * COFTA 2026 — data layer
 *
 * No dependencies on purpose. Everything is plain fetch against Supabase's
 * REST endpoints, so this deploys as static files with no build step.
 *
 * Spectators only ever call snapshot(). Admin writes go through the RPCs
 * that enforce the version guard and the audit log.
 */

export const SUPABASE_URL = 'https://faodniafqglgzmdosgfq.supabase.co';
export const PUBLISHABLE_KEY = 'sb_publishable_9P1vft0yq7PuQ1RvaALB7g_bUJE1nbF';

const TOKEN_KEY = 'cofta.session.v1';

/* ── session ─────────────────────────────────────────────── */
export function getSession() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); }
  catch { return null; }
}
function setSession(s) {
  if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
  else localStorage.removeItem(TOKEN_KEY);
}
export const isSignedIn = () => !!getSession()?.access_token;

function headers(auth = false) {
  const h = { 'apikey': PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
  const s = getSession();
  h['Authorization'] = (auth && s?.access_token)
    ? `Bearer ${s.access_token}` : `Bearer ${PUBLISHABLE_KEY}`;
  return h;
}

/** Usernames are synthetic emails on a reserved domain. Typing "pitch1"
 *  signs in as pitch1@cofta.example; a full address still works as-is. */
const ADMIN_DOMAIN = 'cofta.example';

export async function signIn(username, password) {
  const email = username.includes('@') ? username : `${username}@${ADMIN_DOMAIN}`;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');
  setSession(data);
  return data;
}

export function signOut() { setSession(null); }

/** Access tokens expire after an hour. Refresh quietly so a matchday
 *  session never dies mid-half. */
export async function refreshSession() {
  const s = getSession();
  if (!s?.refresh_token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!r.ok) { setSession(null); return null; }
  const data = await r.json();
  setSession(data);
  return data;
}

/* ── rpc ─────────────────────────────────────────────────── */
export async function rpc(fn, args = {}, auth = false) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: headers(auth), body: JSON.stringify(args),
  });
  const text = await r.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!r.ok) {
    const msg = body?.message || body?.error || `${fn} failed (${r.status})`;
    // an expired token looks like a permissions error; refresh once and retry
    if (r.status === 401 && auth) {
      const s = await refreshSession();
      if (s) return rpc(fn, args, auth);
    }
    const e = new Error(msg); e.status = r.status; e.body = body; throw e;
  }
  return body;
}

/* ── reads ───────────────────────────────────────────────── */
export const fetchSnapshot = () => rpc('snapshot');

/* ── writes (admin) ──────────────────────────────────────── */
export const uuid = () =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

export const setClock = (matchId, action, version, halfMs, home = null, away = null) =>
  rpc('set_clock', {
    p_match: matchId, p_action: action,
    p_expected_version: version, p_half_ms: halfMs,
    p_home: home, p_away: away,
  }, true);

export const setTieShootout = (group, teamA, teamB, scoreA, scoreB) =>
  rpc('set_tie_shootout', {
    p_group: group, p_team_a: teamA, p_team_b: teamB,
    p_score_a: scoreA, p_score_b: scoreB,
  }, true);

export const resetTournament = () => rpc('reset_tournament', {}, true);

export const addPlayer = (teamId, name, shirt) =>
  rpc('add_player', { p_team: teamId, p_name: name, p_shirt: shirt ?? null }, true);

export const removePlayer = (id) => rpc('remove_player', { p_id: id }, true);

export const setManager = (teamId, name) =>
  rpc('set_team_manager', { p_team: teamId, p_name: name }, true);

export const logEvent = (o) =>
  rpc('log_event', {
    p_id: o.id, p_match: o.matchId, p_type: o.type,
    p_side: o.side ?? null, p_player: o.playerId ?? null,
    p_elapsed: o.elapsedMs ?? null, p_minute: o.minute ?? null,
  }, true);

export const voidEvent = (id) => rpc('void_event', { p_id: id }, true);

export const setShootout = (matchId, home, away, decided) =>
  rpc('set_shootout', { p_match: matchId, p_home: home, p_away: away, p_decided: decided }, true);

export const setForfeit = (matchId, side) =>
  rpc('set_forfeit', { p_match: matchId, p_side: side }, true);

export const setDisqualified = (teamId, value) =>
  rpc('set_disqualified', { p_team: teamId, p_value: value }, true);

/** Replaces that trophy's winners outright — one call, one atomic swap. */
export const setTrophy = (trophy, playerIds) =>
  rpc('set_trophy', { p_trophy: trophy, p_players: playerIds }, true);

export const setSlot = (slot, teamId) =>
  rpc('set_slot', { p_slot: slot, p_team: teamId }, true);

export const amAdmin = () => rpc('is_admin', {}, true);
export const myRole = () => rpc('my_role', {}, true);
