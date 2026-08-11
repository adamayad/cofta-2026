-- ============================================================
-- COFTA 2026 — write path
-- Every write goes through a function so that:
--   * the SERVER stamps the time (client clocks are never trusted)
--   * the version guard rejects a conflicting second write
--   * retries are idempotent
-- ============================================================

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- Server time, fetched once on load so every phone can correct its offset.
create or replace function public.server_time() returns timestamptz
language sql stable as $$ select now(); $$;

-- ── clock transitions ───────────────────────────────────────
-- action: 'start' | 'pause' | 'resume' | 'half_time' | 'second_half' | 'full_time'
-- p_expected_version guards against two admins driving one match.
create or replace function public.set_clock(
  p_match uuid,
  p_action text,
  p_expected_version int,
  p_half_ms bigint default 1200000      -- 20 minutes
) returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  banked bigint;
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'no_such_match'; end if;

  if m.version <> p_expected_version then
    -- Someone else moved this match on. Reject rather than overwrite.
    raise exception 'stale_version:%', m.version using errcode = '40001';
  end if;

  -- bank any running time using SERVER now()
  banked := m.clock_accum_ms
          + case when m.clock_running
                 then (extract(epoch from (now() - m.clock_anchor)) * 1000)::bigint
                 else 0 end;

  if p_action = 'start' then
    if m.status <> 'scheduled' then raise exception 'bad_transition'; end if;
    m.status := 'first_half'; m.clock_accum_ms := 0;
    m.clock_running := true;  m.clock_anchor := now();
    m.locked := true;

  elsif p_action = 'pause' then
    if m.status not in ('first_half','second_half') then raise exception 'bad_transition'; end if;
    m.clock_accum_ms := banked; m.clock_running := false; m.clock_anchor := null;

  elsif p_action = 'resume' then
    if m.status not in ('first_half','second_half') then raise exception 'bad_transition'; end if;
    m.clock_running := true; m.clock_anchor := now();

  elsif p_action = 'half_time' then
    if m.status <> 'first_half' then raise exception 'bad_transition'; end if;
    m.clock_accum_ms := banked; m.clock_running := false;
    m.clock_anchor := null;    m.status := 'half_time';

  elsif p_action = 'second_half' then
    if m.status <> 'half_time' then raise exception 'bad_transition'; end if;
    -- second half always begins at exactly one half, however long the break ran
    m.clock_accum_ms := p_half_ms; m.clock_running := true;
    m.clock_anchor := now();      m.status := 'second_half';

  elsif p_action = 'full_time' then
    if m.status not in ('first_half','second_half') then raise exception 'bad_transition'; end if;
    m.clock_accum_ms := banked; m.clock_running := false;
    m.clock_anchor := null;    m.status := 'full_time';

  else
    raise exception 'unknown_action';
  end if;

  update public.matches set
    status = m.status, clock_running = m.clock_running, clock_anchor = m.clock_anchor,
    clock_accum_ms = m.clock_accum_ms, locked = m.locked,
    version = version + 1, controlled_by = auth.uid(), controlled_at = now(),
    updated_at = now()
  where id = p_match returning * into m;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'clock:' || p_action, p_match, jsonb_build_object('version', m.version));

  return m;
end $$;

-- ── logging an event ────────────────────────────────────────
-- p_id comes from the client. Re-sending it is a no-op, so a retry on a
-- flaky connection can never count the same goal twice.
create or replace function public.log_event(
  p_id uuid, p_match uuid, p_type public.event_type,
  p_side text default null, p_player uuid default null,
  p_elapsed bigint default null, p_minute text default null
) returns public.match_events
language plpgsql security definer set search_path = public as $$
declare e public.match_events;
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  insert into public.match_events
    (id, match_id, type, side, player_id, elapsed_ms, minute_label, created_by)
  values (p_id, p_match, p_type, p_side, p_player, p_elapsed, p_minute, auth.uid())
  on conflict (id) do nothing;

  select * into e from public.match_events where id = p_id;
  return e;
end $$;

-- Undo keeps the row and marks it void, so nothing is lost.
create or replace function public.void_event(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  update public.match_events set voided = true where id = p_id;
  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'event:void', jsonb_build_object('event', p_id));
end $$;

-- ── shootout (knockouts only) ───────────────────────────────
create or replace function public.set_shootout(
  p_match uuid, p_home int, p_away int, p_decided boolean
) returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  select * into m from public.matches where id = p_match;
  if m.stage in ('A','B') then raise exception 'no_shootout_in_groups'; end if;
  if m.status <> 'full_time' then raise exception 'not_full_time'; end if;
  if p_decided and p_home = p_away then raise exception 'shootout_level'; end if;

  update public.matches set pens_home = p_home, pens_away = p_away,
    pens_decided = p_decided, version = version + 1, updated_at = now()
  where id = p_match returning * into m;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'shootout', p_match, jsonb_build_object('h',p_home,'a',p_away,'decided',p_decided));
  return m;
end $$;

-- ── forfeit: 3-0, no clock ──────────────────────────────────
create or replace function public.set_forfeit(p_match uuid, p_side text)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  if p_side is not null and p_side not in ('home','away') then raise exception 'bad_side'; end if;

  update public.matches set
    forfeit_side = p_side,
    status = case when p_side is null then 'scheduled' else 'full_time' end::public.match_status,
    clock_running = false, clock_anchor = null, clock_accum_ms = 0,
    locked = (p_side is not null),
    version = version + 1, updated_at = now()
  where id = p_match returning * into m;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'forfeit', p_match, jsonb_build_object('side', p_side));
  return m;
end $$;

create or replace function public.set_disqualified(p_team text, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  update public.teams set disqualified = p_value where id = p_team;
  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'disqualify', jsonb_build_object('team',p_team,'value',p_value));
end $$;

create or replace function public.set_slot(p_slot text, p_team text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  insert into public.slot_overrides(slot, team_id, set_by, set_at)
  values (p_slot, p_team, auth.uid(), now())
  on conflict (slot) do update set team_id = excluded.team_id,
    set_by = excluded.set_by, set_at = now();
  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'slot', jsonb_build_object('slot',p_slot,'team',p_team));
end $$;

-- ── one small JSON payload for every spectator ──────────────
create or replace function public.snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) - 'created_at'), '[]'::jsonb) from public.teams t),
    'slots', (select coalesce(jsonb_object_agg(slot, team_id), '{}'::jsonb) from public.slot_overrides),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'stage', m.stage, 'day', m.day, 'kickoff', m.kickoff, 'pitch', m.pitch,
        'home', m.home_team, 'away', m.away_team, 'hs', m.home_score, 'as', m.away_score,
        'ph', m.pens_home, 'pa', m.pens_away, 'pd', m.pens_decided,
        'ff', m.forfeit_side, 'status', m.status,
        'run', m.clock_running, 'anchor', m.clock_anchor, 'accum', m.clock_accum_ms,
        'v', m.version)), '[]'::jsonb) from public.matches m),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'm', e.match_id, 't', e.type, 's', e.side,
        'min', e.minute_label, 'p', e.player_id) order by e.created_at desc), '[]'::jsonb)
      from public.match_events e where not e.voided)
  );
$$;
