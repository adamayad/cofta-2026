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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // WHO IS ASKING. The caller's own token is checked against is_admin(), so a
  // spectator holding the publishable key cannot make every phone buzz.
  const authz = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authz } } });
  const { data: isAdmin } = await asCaller.rpc('is_admin');
  if (!isAdmin) return new Response('not an organiser', { status: 403 });

  const { match_id, kind } = await req.json().catch(() => ({}));
  if (!match_id || !['goal', 'full_time'].includes(kind)) {
    return new Response('match_id and kind required', { status: 400 });
  }

  // EVERY WORD IS READ BACK FROM THE DATABASE, not taken from the request.
  const { data: m } = await admin.from('matches')
    .select('id, stage, home_team, away_team, home_score, away_score, status')
    .eq('id', match_id).single();
  if (!m) return new Response('no such match', { status: 404 });

  const { data: teams } = await admin.from('teams').select('id, name, city');
  const by = Object.fromEntries((teams ?? []).map((t) => [t.id, t]));
  const nameOf = (id: string | null) => id ? (by[id]?.city ?? id) : 'TBC';

  const score = `${nameOf(m.home_team)} ${m.home_score}–${m.away_score} ${nameOf(m.away_team)}`;
  const title = kind === 'goal' ? '⚽ GOAL!' : 'Full time';
  const body = kind === 'goal' ? score : `${score} · full time`;
  const payload = JSON.stringify({
    title, body, kind, tag: `match-${m.id}`,
    url: `/?match=${encodeURIComponent(m.id)}`,
  });

  // Who wants it: everyone (team_id null), or anyone following either club.
  const { data: subs } = await admin.from('push_subscriptions')
    .select('endpoint, keys, team_id')
    .or(`team_id.is.null,team_id.eq.${m.home_team},team_id.eq.${m.away_team}`);

  let sent = 0; const dead: string[] = [];
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
      // 404/410 mean the subscription is gone for good. REMOVE IT rather than
      // retrying forever: a dead endpoint retried every goal all weekend is a
      // slow leak that ends with sends timing out for everyone else.
      if (res.status === 404 || res.status === 410) dead.push(s.endpoint);
      else if (res.ok) sent++;
    } catch { dead.push(s.endpoint); }
  }

  if (dead.length) {
    await admin.from('push_subscriptions').delete().in('endpoint', dead);
  }
  return Response.json({ sent, removed: dead.length, of: (subs ?? []).length });
});
