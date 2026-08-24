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
/**
 * The session survives in memory even when it cannot be written down.
 *
 * `localStorage.setItem` throws on a phone in private browsing or one whose
 * storage is full, and this sits on the sign-in path: unguarded, an organiser
 * tapping Sign in got an exception and no explanation, on the one device that
 * has to work. Now the write is attempted and the in-memory copy carries the
 * session regardless, so they are signed in for as long as the page is open —
 * which is the whole match — and only lose it on a reload.
 *
 * `undefined` means "nothing set this run, defer to storage"; `null` means
 * signed out, and must beat a stale stored value that failed to delete.
 */
let memSession;

export function getSession() {
  if (memSession !== undefined) return memSession;
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); }
  catch { return null; }
}
function setSession(s) {
  memSession = s || null;
  try {
    if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode or a full disk — the in-memory copy stands in */ }
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

/* ── the last role the server confirmed ──────────────────── */
/**
 * An organiser's phone restarting during an outage is exactly when the
 * offline queue matters most, and it was exactly when the app dropped them
 * into the spectator view: the boot-time role check is a network call, and a
 * failed network call is indistinguishable from "not an admin".
 *
 * So the answer is remembered. This is UI trust only — it decides which
 * buttons render, nothing else. Every write still goes through an RPC that
 * checks the role in the database, so a revoked admin can tap all they like
 * and the queue will fail those events on drain, which is what should happen.
 */
const ROLE_KEY = 'cofta.role.v1';

export function cachedRole() {
  try { return JSON.parse(localStorage.getItem(ROLE_KEY) || 'null'); }
  catch { return null; }
}

/** Ask the server who we are and remember the answer. Throws when the network
 *  is down, which is the case the cache exists for. */
export async function checkRole() {
  const admin = !!(await rpc('is_admin', {}, true));
  const role  = admin ? await rpc('my_role', {}, true) : null;
  const seen  = { admin, role };
  try { localStorage.setItem(ROLE_KEY, JSON.stringify(seen)); } catch {}
  return seen;
}

export function signOut() {
  setSession(null);
  // the remembered role goes with the session, or the next person to open
  // this phone inherits the last organiser's buttons
  try { localStorage.removeItem(ROLE_KEY); } catch {}
}

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

/* ── push notifications ────────────────────────────────── */
/** The VAPID public key. PUBLIC BY DESIGN, exactly like the publishable key
 *  above: it is handed to every phone that subscribes, and it identifies the
 *  sender rather than authorising anything. Its private half signs each push
 *  and lives ONLY in the Edge Function's secret store - never in this repo. */
export const VAPID_PUBLIC_KEY =
  'BLlBwzJMaTgBve3vDrZc5624vmM5dXKJPjrz5JuX4Xj3yK5KP7q7Aw8UpI1plXFIwuNTS5lnHYu2T6bqMsDSs-s';

export const subscribePush = (endpoint, keys, teamId, kinds) =>
  rpc('subscribe_push', { p_endpoint: endpoint, p_keys: keys,
    p_team: teamId ?? null, p_kinds: kinds ?? null });

export const unsubscribePush = (endpoint) =>
  rpc('unsubscribe_push', { p_endpoint: endpoint });

/** Ask the Edge Function to fan a notification out. Called by an ORGANISER's
 *  device straight after a goal or a full-time whistle lands, with their own
 *  token: the function verifies the caller before it sends anything, so a
 *  spectator cannot make everyone's phone buzz. */
export async function firePush(matchId, kind, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
    method: 'POST', headers: headers(true),
    body: JSON.stringify({ match_id: matchId, kind, ...opts }),
  });
  if (!r.ok) throw new Error(`notify failed (${r.status})`);
  return r.json().catch(() => null);
}

// is_admin/my_role are deliberately not exported individually: checkRole() is
// the only door, so no future caller can check the role without refreshing the
// cache that an offline boot depends on.

/* ── the historical archive ──────────────────────────────── */
/**
 * Thirteen finished tournaments, 2022-2026. Deliberately NOT part of
 * snapshot(): every phone polls that every five seconds, and the weekend
 * egress budget is sized without 99 matches and 260 events riding along.
 *
 * These are direct table reads under public-read RLS, fetched only when
 * someone opens History, and cached hard with no expiry.
 *
 * **Bump ARCHIVE_V in any migration that touches an archive_* table.** Not
 * only when the shape changes — that was the original rule and it was wrong.
 * Results of finished tournaments are immutable, but their presentation is
 * not: 0022 split names from cities, 0023 added women's crests, 0024 fixed
 * three church names and 0025 wired twelve crest files. A phone that had
 * opened History before any of those keeps the old copy for ever, because
 * nothing else ever invalidates it. That is what happened to the archive
 * crests — the files and the database were both right, and devices still
 * drew monograms.
 */
const ARCHIVE_V = 'v14';   // v14: 0050 added winner_team_id/loser_team_id to archive_matches
const cacheKey = (what) => `cofta.archive.${ARCHIVE_V}.${what}`;

/** Bumping the version orphans the previous one, and localStorage is a small
 *  budget shared with the snapshot and the write queue. Sweep on first read
 *  rather than leaving a dead copy of the whole archive per bump. */
function pruneOldArchives() {
  const keep = `cofta.archive.${ARCHIVE_V}.`;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('cofta.archive.') && !k.startsWith(keep)) localStorage.removeItem(k);
    }
  } catch { /* private mode, or a full disk — the cache is optional anyway */ }
}

function cached(what) {
  pruneOldArchives();
  try { return JSON.parse(localStorage.getItem(cacheKey(what)) || 'null'); }
  catch { return null; }
}
function cache(what, value) {
  try { localStorage.setItem(cacheKey(what), JSON.stringify(value)); } catch {}
  return value;
}

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers(false) });
  if (!r.ok) throw new Error(`archive read failed (${r.status})`);
  return r.json();
}

/** Clubs and editions: small, and needed by every History page. */
export async function fetchArchiveIndex() {
  const hit = cached('index');
  if (hit) return hit;
  const [teams, editions, entrants] = await Promise.all([
    rest('archive_teams?select=id,canonical_name,city,short_name,live_team_id,display,parent_club'),
    rest('archive_editions?select=*&order=year.desc,date_start.desc'),
    rest('archive_edition_teams?select=edition_id,team_id'),
  ]);
  return cache('index', { teams, editions, entrants });
}

/** One edition's detail, fetched the first time it is opened. Matches come
 *  first because the events query filters on their ids. */
export async function fetchArchiveEdition(id) {
  const hit = cached('ed.' + id);
  if (hit) return hit;
  const q = encodeURIComponent(id);
  const matches = await rest(
    `archive_matches?select=*&edition_id=eq.${q}&order=match_date.asc,kickoff_time.asc,id.asc`);
  const inList = matches.length ? matches.map(m => `"${m.id}"`).join(',') : '""';
  const [events, groups, standings, boards, awards] = await Promise.all([
    rest(`archive_match_events?select=*&match_id=in.(${inList})&order=match_id.asc,seq.asc`),
    rest(`archive_groups?select=*&edition_id=eq.${q}&order=name.asc`),
    rest(`archive_standings?select=*&order=position.asc`),
    rest(`archive_leaderboards?select=*&edition_id=eq.${q}&order=rank.asc`),
    rest(`archive_awards?select=*&edition_id=eq.${q}`),
  ]);
  const mine = new Set(groups.map(g => g.id));
  return cache('ed.' + id, {
    matches, events, groups,
    standings: standings.filter(s => mine.has(s.group_id)),
    boards, awards,
  });
}

/** Organiser view only: the conflict register behind the flags. */
export async function fetchArchiveConflicts() {
  const hit = cached('conflicts');
  if (hit) return hit;
  return cache('conflicts', await rest('archive_conflicts?select=*&order=id.asc'));
}

/**
 * Cross-edition honours, for the trophy cabinets.
 *
 * A cabinet spans every edition at once, so it cannot be assembled from the
 * per-edition fetches. Both tables are small — 39 awards, and only the
 * rank-one leaderboard rows — so this is one round trip, cached like the rest
 * of the archive.
 *
 * The flagged published summaries are excluded here rather than in the view:
 * they are a conflicting table the archive keeps for the record, never a
 * statement that somebody won something.
 */
export async function fetchArchiveHonours() {
  const hit = cached('honours');
  if (hit) return hit;
  const [awards, boards] = await Promise.all([
    // player_canonical too: an award is rendered under the canonical spelling,
    // so leaving it out silently fell back to the source's — the 2014 report's
    // "Chilaki" against the same player's "Chilaka" everywhere else.
    rest('archive_awards?select=edition_id,award_type,player_name,player_canonical,team_id,value'
       + '&is_published_summary=eq.false&match_id=is.null'),
    rest('archive_leaderboards?select=edition_id,board_type,rank,player_name,team_id,value'
       + '&rank=eq.1&is_canonical=eq.true'),
  ]);
  return cache('honours', { awards, boards });
}

/**
 * Every player the archive records against a club, for the Players list on a
 * History club page.
 *
 * Four small reads, all of them whole tables: 260 match events, 99 matches,
 * 216 leaderboard rows, 46 awards. Fetching the lot once and joining in the
 * client beats a per-club round trip, and beats adding a view or an RPC for
 * something this size. Cached under ARCHIVE_V like the rest of the archive.
 *
 * `archive_matches` comes along only to map a match to its edition — the
 * events table carries `match_id` and no edition, and a player's years are the
 * most useful thing on the row after their name.
 *
 * Boards are taken at EVERY rank here, not just rank one as `fetchArchiveHonours`
 * does. That read is looking for winners; this one is looking for anyone who
 * appeared, and eleventh on the scoring charts still played.
 */
export async function fetchArchiveRoster() {
  const hit = cached('roster');
  if (hit) return hit;
  const [events, matches, boards, awards] = await Promise.all([
    rest('archive_match_events?select=match_id,team_id,player_name,player_canonical,'
       + 'event_type,assist_player,assist_canonical'),
    rest('archive_matches?select=id,edition_id'),
    rest('archive_leaderboards?select=edition_id,player_name,player_canonical,team_id'
       + '&is_canonical=eq.true'),
    // Same distrust flag as the honours read: a summary table the archive
    // keeps for the record is not evidence that anyone turned out.
    rest('archive_awards?select=edition_id,player_name,player_canonical,team_id'
       + '&is_published_summary=eq.false'),
  ]);
  return cache('roster', { events, matches, boards, awards });
}
