/**
 * notify — fan a goal or full-time notification out to subscribed devices.
 *
 * Called by an ORGANISER'S DEVICE straight after the write lands, carrying
 * their own token. It is not a database trigger, and that was a choice: a
 * trigger would need either a Database Webhook configured by hand in the
 * dashboard or a service-role key embedded in a migration, and the second of
 * those puts a credential in the repo. This way the only secret in play is the
 * VAPID private key, which lives in the function's own secret store.
 *
 * IT DOES NOT TRUST ITS CALLER'S DESCRIPTION OF THE WORLD. The request says
 * only which match and whether this is a goal or full time; every word of the
 * notification is then read back out of the database. A caller cannot make a
 * phone say something that did not happen.
 *
 * Secrets required (set in Supabase, never in this repo):
 *   VAPID_PRIVATE_KEY  the private half of the pair whose public half is in api.js
 *   VAPID_SUBJECT      mailto: address; Apple rejects pushes without a contact
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const VAPID_PUBLIC = 'BLlBwzJMaTgBve3vDrZc5624vmM5dXKJPjrz5JuX4Xj3yK5KP7q7Aw8UpI1plXFIwuNTS5lnHYu2T6bqMsDSs-s';

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s: string) => {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** The VAPID Authorization header for one push origin. Signed ES256 JWT. */
async function vapidHeader(audience: string) {
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: Deno.env.get('VAPID_PRIVATE_KEY')!,
      x: b64url(unb64url(VAPID_PUBLIC).slice(1, 33)),
      y: b64url(unb64url(VAPID_PUBLIC).slice(33, 65)),
      ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@cofta.co.uk',
  })));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(`${header}.${body}`));
  return `vapid t=${header}.${body}.${b64url(sig)}, k=${VAPID_PUBLIC}`;
}

/**
 * Encrypt a payload to one subscription, RFC 8291 aes128gcm.
 *
 * This is the fiddly part and it is fiddly for a reason: the payload is
 * end-to-end encrypted to the device, so Apple and Google relay it without
 * being able to read it. Every step below is prescribed by the RFC — the
 * salt, the ephemeral key, the info strings and their exact byte layout.
 */
async function encrypt(payload: string, p256dh: string, auth: string) {
  const ua = unb64url(p256dh);            // the device's public key
  const authSecret = unb64url(auth);

  const local = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));

  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: await crypto.subtle.importKey(
        'raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []) },
    local.privateKey, 256));

  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
    const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
  };

  const cat = (...a: Uint8Array[]) => {
    const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
    let o = 0; for (const x of a) { out.set(x, o); o += x.length; }
    return out;
  };
  const enc = (s: string) => new TextEncoder().encode(s);

  // PRK combining the two public keys, per RFC 8291 §3.4
  const keyInfo = cat(enc('WebPush: info\0'), ua, localPub);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The record is the payload followed by a single 0x02 delimiter byte.
  const body = cat(enc(payload), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, key, body));

  // Header: salt(16) | record size(4, big-endian) | key length(1) | key(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, new Uint8Array([localPub.length]), localPub, ct);
}

/**
 * CORS. THIS IS NOT BOILERPLATE - its absence is what stopped notifications
 * working from a second device. The browser sends an OPTIONS preflight before
 * any cross-origin POST carrying Authorization and apikey headers, and this
 * function used to answer that with 405 and no CORS headers - so the browser
 * blocked the real POST before it ever left the device. Nothing reached the
 * server, nothing appeared in any log except a lone OPTIONS 405, and the
 * symptom was "it works on my phone but not the other one", because whether a
 * preflight is sent at all differs between browsers and contexts.
 *
 * Every response below carries these, not just the preflight: a POST reply
 * without them is unreadable to the page that asked for it.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });

  // FAIL LOUDLY AND EARLY IF THE KEY IS MISSING. Without this the first
  // subscriber's importKey() throws, the catch below treats it as a dead
  // endpoint, and a misconfiguration silently deletes the entire subscriber
  // list on the first goal of the tournament.
  if (!Deno.env.get('VAPID_PRIVATE_KEY')) {
    return Response.json({ error: 'VAPID_PRIVATE_KEY is not set on this project',
      sent: 0, of: 0 }, { status: 500, headers: CORS });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // WHO IS ASKING. The caller's own token is checked against is_admin(), so a
  // spectator holding the publishable key cannot make every phone buzz.
  const authz = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authz } } });
  const { data: isAdmin } = await asCaller.rpc('is_admin');
  if (!isAdmin) return new Response('not an organiser', { status: 403, headers: CORS });

  const { match_id, kind, event_id, update } = await req.json().catch(() => ({}));
  if (!match_id || !['goal', 'full_time', 'test'].includes(kind)) {
    return new Response('match_id and kind required', { status: 400, headers: CORS });
  }

  // EVERY WORD IS READ BACK FROM THE DATABASE, not taken from the request.
  const { data: m } = await admin.from('matches')
    .select('id, stage, home_team, away_team, home_score, away_score, status, '
          + 'pens_home, pens_away, pens_decided')
    .eq('id', match_id).single();
  if (!m) return new Response('no such match', { status: 404, headers: CORS });

  const { data: teams } = await admin.from('teams').select('id, name, city');
  const by = Object.fromEntries((teams ?? []).map((t) => [t.id, t]));
  const nameOf = (id: string | null) => id ? (by[id]?.city ?? id) : 'TBC';

  // ── the notification itself ─────────────────────────────────────────
  //
  // THE SCORELINE IS THE HEADLINE, FotMob-style, because that is the one fact
  // someone glancing at a lock screen wants. A notification reading "GOAL!"
  // with the score buried underneath makes you open the app to learn it.
  //
  // AND THE BALL MARKS WHO SCORED. A notification has no bold, no colour and
  // no styling, so the only way to show which side the goal belongs to is
  // POSITION: the ball sits at that club's end of the scoreline.
  //   ⚽ Brighton 2–1 Croydon     home scored
  //   Brighton 2–1 Croydon ⚽     away scored
  // Those are different at a glance in a way "GOAL! Brighton 2–1 Croydon" is
  // not — and glancing is the entire interaction.
  const home = nameOf(m.home_team), away = nameOf(m.away_team);
  const line = `${home} ${m.home_score}–${m.away_score} ${away}`;

  let title: string, body: string;

  if (kind === 'test') {
    title = 'COFTA test';
    body = 'Notifications are working. This is a test.';
  } else if (kind === 'full_time') {
    title = 'Full time';
    // A knockout settled on penalties is not a draw. A notification that says
    // "1–1" and stops is actively misleading about who went through.
    body = m.pens_decided
      ? `${line} · ${m.pens_home > m.pens_away ? home : away} win ${m.pens_home}–${m.pens_away} on pens`
      : line;
  } else {
    // Which event: the one named, or the newest goal still standing. `voided`
    // matters — a goal logged and then taken back must never be the one we
    // describe to several hundred phones.
    let ev: { type: string; side: string; minute_label: string | null;
              player_id: string | null; voided: boolean } | null = null;
    if (event_id) {
      const { data } = await admin.from('match_events')
        .select('type, side, minute_label, player_id, voided')
        .eq('id', event_id).maybeSingle();
      ev = data;
    }
    if (!ev || ev.voided) {
      const { data } = await admin.from('match_events')
        .select('type, side, minute_label, player_id, voided')
        .eq('match_id', m.id).eq('voided', false)
        .in('type', ['goal', 'own_goal'])
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      ev = data;
    }

    title = (ev?.side ?? 'home') === 'home' ? `⚽ ${line}` : `${line} ⚽`;

    let scorer = '';
    if (ev?.player_id) {
      const { data: p } = await admin.from('players')
        .select('name').eq('id', ev.player_id).maybeSingle();
      scorer = p?.name ?? '';
    }
    const minute = ev?.minute_label ?? '';

    // Own goals name the club and not the man. The scoreline already says who
    // it counted for; adding a name to it in a church tournament is a cruelty
    // the app has no reason to commit.
    body = ev?.type === 'own_goal'
      ? ['Own goal', minute].filter(Boolean).join(' · ')
      : [scorer, minute].filter(Boolean).join(' ') || 'Goal';
  }

  const payload = JSON.stringify({
    title, body, kind,
    // Same tag per match, so a second goal REPLACES the first rather than
    // stacking six notifications from one game.
    tag: kind === 'test' ? 'cofta-test' : `match-${m.id}`,
    // `update` is the follow-up that fills in the scorer once someone has
    // picked him. It rewrites the notification already on the lock screen and
    // deliberately does NOT buzz again: two buzzes for one goal teaches people
    // to ignore the first.
    renotify: !update,
    url: `/?match=${encodeURIComponent(m.id)}`,
  });

  // Who wants it: everyone (team_id null), or anyone following either club.
  //
  // The clubs are built into the filter conditionally, because a knockout
  // fixture has NULL teams until kick-off pins them, and `team_id.eq.null` is
  // not valid PostgREST — it throws, and the whole send fails. In practice a
  // goal implies a pinned match, but a test push aimed at the final before it
  // has teams would have hit exactly this.
  const clubs = [m.home_team, m.away_team].filter(Boolean) as string[];
  const filter = ['team_id.is.null', ...clubs.map((c) => `team_id.eq.${c}`)].join(',');
  const { data: subs } = await admin.from('push_subscriptions')
    .select('endpoint, keys, team_id, fail_count')
    .or(filter);

  let sent = 0;
  const dead: string[] = [];      // gone for good — the push service said so
  const failed: string[] = [];    // failed THIS time; still perfectly valid
  const problems: string[] = [];

  for (const s of subs ?? []) {
    try {
      const url = new URL(s.endpoint);
      const cipher = await encrypt(payload, s.keys.p256dh, s.keys.auth);
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': await vapidHeader(`${url.protocol}//${url.host}`),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          'TTL': '600',                       // a goal is not news in an hour
          'Urgency': kind === 'goal' ? 'high' : 'normal',
        },
        body: cipher,
      });
      // ONLY THE PUSH SERVICE GETS TO DECLARE A SUBSCRIPTION DEAD, and only
      // with 404 or 410. Those mean the browser threw the subscription away
      // and it will never work again, so keeping it is a slow leak that ends
      // with every send timing out.
      if (res.status === 404 || res.status === 410) { dead.push(s.endpoint); continue; }
      if (res.ok) { sent++; continue; }
      // Anything else — 429, 500, a bad request — is this attempt failing, not
      // the subscription being invalid. Count it and leave it alone.
      failed.push(s.endpoint);
      problems.push(`${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
    } catch (e) {
      // AND A LOCAL THROW IS NEVER THE SUBSCRIBER'S FAULT. A missing or
      // malformed VAPID key, a crypto failure, a DNS blip — every one of those
      // used to land in `dead` and DELETE the row. One misconfiguration would
      // have wiped the whole subscriber list on the first goal, silently.
      failed.push(s.endpoint);
      problems.push(String((e as Error)?.message ?? e).slice(0, 120));
    }
  }

  if (dead.length) {
    await admin.from('push_subscriptions').delete().in('endpoint', dead);
  }
  if (sent) {
    await admin.from('push_subscriptions')
      .update({ last_sent_at: new Date().toISOString(), fail_count: 0 })
      .not('endpoint', 'in', `(${[...dead, ...failed].map((e) => `"${e}"`).join(',') || '""'})`);
  }
  for (const e of failed) {
    const row = (subs ?? []).find((s) => s.endpoint === e);
    await admin.from('push_subscriptions')
      .update({ fail_count: (row?.fail_count ?? 0) + 1 }).eq('endpoint', e);
  }

  return Response.json({
    sent, removed: dead.length, failed: failed.length,
    of: (subs ?? []).length,
    // Surfaced so a dry run can see WHY nothing arrived without reading logs.
    problems: problems.slice(0, 3),
  }, { headers: CORS });
});
