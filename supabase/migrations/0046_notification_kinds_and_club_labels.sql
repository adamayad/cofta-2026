-- 0046 — what each club is called in a notification, and which alerts a
--        subscriber actually wants.
--
-- ── CLUB LABELS ──────────────────────────────────────────────────────
-- A notification has room for a scoreline and almost nothing else, so the app's
-- usual "full church name over the city" is impossible there and it has been
-- falling back to the CITY. That reads badly for half these clubs: "Willesden"
-- is not what anyone calls Kidane Mihret, and "Hounslow 2–1 Croydon" names two
-- places rather than two churches.
--
-- `short_label` is the name a club goes by in one line. Organiser-supplied:
--   gg    Archangel Michael      km    Kidane Mihret
--   smpk  Pope Kyrillos VI       bri   Anba Abraam
--   cro   St Shenouda            rot   St Anthony
--
-- STEVENAGE WAS NOT IN THAT LIST. `ste` is set to "St George" to follow the
-- pattern the other six establish — every one of them is the church rather
-- than the town — because leaving it as "Stevenage" would put a town and six
-- churches in the same sentence. It is a one-line UPDATE to change and it is
-- flagged in the summary rather than buried here.
--
-- This is display only. It is NOT an alias in the archive sense: nothing
-- resolves a team FROM this string, so it cannot collide with anything.
--
-- ── ALERT KINDS ──────────────────────────────────────────────────────
-- Seven things can now be notified, and a subscriber picks which. The default
-- is goals and full time — the two that a spectator would miss if they were
-- not told, and the two the app already sent. Everything else is opt-in,
-- because twelve matches of cards and kick-offs on one Saturday is a phone
-- nobody wants in their pocket.

begin;

alter table public.teams add column if not exists short_label text;

update public.teams set short_label = v.label from (values
  ('gg',   'Archangel Michael'),
  ('km',   'Kidane Mihret'),
  ('smpk', 'Pope Kyrillos VI'),
  ('bri',  'Anba Abraam'),
  ('cro',  'St Shenouda'),
  ('rot',  'St Anthony'),
  ('ste',  'St George'),          -- inferred from the pattern; see the header
  ('stm',  'St Mark')             -- not entered in 2026, but keeps its label
) as v(id, label) where teams.id = v.id;

comment on column public.teams.short_label is
  'One-line name for places with no room for church-over-city, e.g. push notifications. Display only.';

-- ── which alerts each subscriber wants ───────────────────────────────
alter table public.push_subscriptions
  add column if not exists kinds text[] not null default array['goal','full_time']::text[];

comment on column public.push_subscriptions.kinds is
  'Alert kinds this device wants: goal, card, motm, start, half_time, second_half, full_time.';

-- subscribe_push gains the kinds argument. The old three-argument signature is
-- dropped first: leaving both would give PostgREST two overloads to choose
-- between and it refuses the call as ambiguous.
drop function if exists public.subscribe_push(text, jsonb, text);

create or replace function public.subscribe_push(
  p_endpoint text, p_keys jsonb, p_team text default null, p_kinds text[] default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  allowed constant text[] := array['goal','card','motm','start','half_time','second_half','full_time'];
  wanted text[];
begin
  if p_endpoint is null or length(p_endpoint) < 20 then
    raise exception 'a push endpoint is required';
  end if;
  if p_keys is null or not (p_keys ? 'p256dh' and p_keys ? 'auth') then
    raise exception 'push keys must carry p256dh and auth';
  end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team) then
    raise exception 'unknown club %', p_team;
  end if;

  -- Unknown kinds are dropped rather than rejected: a device running an older
  -- build must still be able to subscribe, and a future build asking for a
  -- kind this database has never heard of should not be turned away outright.
  wanted := coalesce(
    (select array_agg(k) from unnest(coalesce(p_kinds, array['goal','full_time'])) k
      where k = any(allowed)),
    array[]::text[]);
  -- Subscribing to nothing at all is not a subscription; fall back to the
  -- default rather than storing a row that can never fire.
  if array_length(wanted, 1) is null then wanted := array['goal','full_time']; end if;

  insert into public.push_subscriptions (endpoint, keys, team_id, kinds)
  values (p_endpoint, p_keys, p_team, wanted)
  on conflict (endpoint) do update
    set keys = excluded.keys, team_id = excluded.team_id,
        kinds = excluded.kinds, fail_count = 0;
end $$;

revoke all on function public.subscribe_push(text, jsonb, text, text[]) from public;
grant execute on function public.subscribe_push(text, jsonb, text, text[]) to anon, authenticated;

do $$
declare n int; k text[];
begin
  -- every entered club has a label, and none of them is a bare city
  select count(*) into n from public.teams where short_label is null;
  if n <> 0 then raise exception '% club(s) have no short_label', n; end if;
  if exists (select 1 from public.teams where short_label = city) then
    raise exception 'a short_label is still just the city';
  end if;

  -- the RPC stores exactly the kinds asked for, minus anything unknown
  perform public.subscribe_push('https://example.invalid/kinds-check-0046',
    '{"p256dh":"x","auth":"y"}'::jsonb, 'bri', array['goal','card','nonsense']);
  select kinds into k from public.push_subscriptions
   where endpoint = 'https://example.invalid/kinds-check-0046';
  if not (k @> array['goal','card'] and array_length(k,1) = 2) then
    raise exception 'kinds stored as %, expected goal+card with nonsense dropped', k;
  end if;

  -- asking for nothing usable falls back rather than storing a dead row
  perform public.subscribe_push('https://example.invalid/kinds-check-0046',
    '{"p256dh":"x","auth":"y"}'::jsonb, 'bri', array['rubbish']);
  select kinds into k from public.push_subscriptions
   where endpoint = 'https://example.invalid/kinds-check-0046';
  if not (k @> array['goal','full_time']) then
    raise exception 'empty kinds should fall back to the default, got %', k;
  end if;

  -- and an older client that sends no kinds at all still works
  perform public.subscribe_push('https://example.invalid/kinds-check-0046',
    '{"p256dh":"x","auth":"y"}'::jsonb, null);
  select kinds into k from public.push_subscriptions
   where endpoint = 'https://example.invalid/kinds-check-0046';
  if not (k @> array['goal','full_time']) then
    raise exception 'a kindless call should default, got %', k;
  end if;

  perform public.unsubscribe_push('https://example.invalid/kinds-check-0046');
  select count(*) into n from public.push_subscriptions
   where endpoint like 'https://example.invalid/%';
  if n <> 0 then raise exception 'the assertions left % row(s) behind', n; end if;

  -- existing subscribers were not disturbed: they keep the default
  select count(*) into n from public.push_subscriptions where kinds is null;
  if n <> 0 then raise exception '% subscription(s) have null kinds', n; end if;
end $$;

commit;
