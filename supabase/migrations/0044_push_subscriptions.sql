-- 0044 — push subscriptions, and the two RPCs that manage them.
--
-- A spectator who has added the app to their home screen can opt in to a
-- notification when a goal goes in or a match ends. Opt-in only, and
-- per-club by default rather than everything, because twelve group matches on
-- one Saturday is a lot of buzzing for someone who came to watch one club.
--
-- WRITES GO THROUGH SECURITY-DEFINER RPCs, not through the table, exactly as
-- every other write in this app does. The table itself gets no insert, update
-- or delete policy at all, so a spectator can subscribe and unsubscribe and
-- can do nothing else — not read the list, not see anyone else's endpoint.
--
-- ON THE ENDPOINT AS A SECRET. A push endpoint is a long unguessable URL
-- issued by Apple or Google, and it is the only thing identifying a
-- subscription. `unsubscribe_push` therefore takes the endpoint and needs no
-- other proof: knowing it is the proof, the same way a password-reset link
-- works. It is never exposed by any read path, which is why there isn't one.
--
-- THE p256dh AND auth KEYS ARE NOT SECRETS OF OURS. They are the browser's
-- public key material for encrypting a payload to that one device. They are
-- useless without the endpoint and cannot decrypt anything.

begin;

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  keys        jsonb not null,
  -- NULL means every match. A team id means only matches that club is in -
  -- either side. Deliberately nullable rather than a magic 'all' string.
  team_id     text references public.teams(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Bumped whenever a send succeeds, so a dead endpoint is visible.
  last_sent_at timestamptz,
  fail_count  integer not null default 0
);

create index if not exists push_subscriptions_team on public.push_subscriptions(team_id);

comment on table public.push_subscriptions is
  'Opt-in Web Push endpoints. team_id null = all matches. No read policy exists by design.';

alter table public.push_subscriptions enable row level security;
-- No policies at all: RLS on with none defined denies everything to anon and
-- authenticated alike. The RPCs below are security definer and bypass it.

/**
 * Subscribe, or change an existing subscription's club. Idempotent on the
 * endpoint: a browser that re-subscribes with the same endpoint updates its
 * choice rather than creating a duplicate, which matters because pressing the
 * toggle twice is the most ordinary thing in the world.
 */
create or replace function public.subscribe_push(
  p_endpoint text, p_keys jsonb, p_team text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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

  insert into public.push_subscriptions (endpoint, keys, team_id)
  values (p_endpoint, p_keys, p_team)
  on conflict (endpoint) do update
    set keys = excluded.keys,
        team_id = excluded.team_id,
        fail_count = 0;          -- a re-subscribe revives an endpoint we had given up on
end $$;

/** Toggling off removes the row outright. There is no "disabled" state to get
 *  out of sync with the browser's own permission. */
create or replace function public.unsubscribe_push(p_endpoint text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;

revoke all on function public.subscribe_push(text, jsonb, text) from public;
revoke all on function public.unsubscribe_push(text) from public;
grant execute on function public.subscribe_push(text, jsonb, text) to anon, authenticated;
grant execute on function public.unsubscribe_push(text) to anon, authenticated;

do $$
declare n int;
begin
  -- the table exists and is locked down
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='push_subscriptions') then
    raise exception 'push_subscriptions was not created';
  end if;
  if not exists (select 1 from pg_class where relname='push_subscriptions' and relrowsecurity) then
    raise exception 'RLS must be enabled on push_subscriptions';
  end if;
  select count(*) into n from pg_policies
   where schemaname='public' and tablename='push_subscriptions';
  if n <> 0 then
    raise exception 'push_subscriptions must have NO policies; found %', n;
  end if;

  -- the RPCs are callable by a spectator
  if not exists (select 1 from information_schema.role_routine_grants
                  where routine_name='subscribe_push' and grantee='anon') then
    raise exception 'anon cannot call subscribe_push';
  end if;
  if not exists (select 1 from information_schema.role_routine_grants
                  where routine_name='unsubscribe_push' and grantee='anon') then
    raise exception 'anon cannot call unsubscribe_push';
  end if;

  -- and they behave: subscribe, re-subscribe (no duplicate), unsubscribe
  perform public.subscribe_push('https://example.invalid/test-endpoint-0044',
    '{"p256dh":"x","auth":"y"}'::jsonb, null);
  perform public.subscribe_push('https://example.invalid/test-endpoint-0044',
    '{"p256dh":"x","auth":"y"}'::jsonb, 'bri');
  select count(*) into n from public.push_subscriptions
   where endpoint = 'https://example.invalid/test-endpoint-0044';
  if n <> 1 then raise exception 're-subscribing duplicated a row (%)', n; end if;
  select count(*) into n from public.push_subscriptions
   where endpoint = 'https://example.invalid/test-endpoint-0044' and team_id = 'bri';
  if n <> 1 then raise exception 're-subscribing did not update the club'; end if;

  perform public.unsubscribe_push('https://example.invalid/test-endpoint-0044');
  select count(*) into n from public.push_subscriptions
   where endpoint = 'https://example.invalid/test-endpoint-0044';
  if n <> 0 then raise exception 'unsubscribe left the row behind'; end if;

  -- and they refuse rubbish
  begin
    perform public.subscribe_push('short', '{"p256dh":"x","auth":"y"}'::jsonb, null);
    raise exception 'a too-short endpoint should have been rejected';
  exception when others then
    if sqlerrm = 'a too-short endpoint should have been rejected' then raise; end if;
  end;
  begin
    perform public.subscribe_push('https://example.invalid/endpoint-long-enough',
      '{"p256dh":"x"}'::jsonb, null);
    raise exception 'missing auth key should have been rejected';
  exception when others then
    if sqlerrm = 'missing auth key should have been rejected' then raise; end if;
  end;

  -- nothing was left behind by the checks
  select count(*) into n from public.push_subscriptions;
  if n <> 0 then raise exception 'the assertions left % row(s) behind', n; end if;
end $$;

commit;
