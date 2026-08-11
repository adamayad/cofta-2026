-- ============================================================
-- COFTA 2026 — three structural fixes from live testing
--
-- 1. Knockout teams persist at kick-off. They previously lived only in the
--    browser's slot resolution, so a started semi-final showed "To be
--    confirmed" to everyone: the database rows still held null.
--    set_clock('start') now requires and writes them.
-- 2. One-off tie shoot-outs are real records (scores kept), and become the
--    fifth tie-break: the winner ranks above the loser in the table, and the
--    Sunday line-up follows from the table with no manual overrides.
-- 3. reset_tournament() for rehearsals: wipes events, shoot-outs, overrides
--    and match state; keeps clubs and squads.
--
-- NOTE: set_clock changed signature, so the old function is DROPPED --
-- grants die with it and are re-issued below (see 0006 for why).
-- ============================================================

create table public.tie_shootouts (
  group_letter text not null check (group_letter in ('A','B')),
  team_a       text not null references public.teams(id),
  team_b       text not null references public.teams(id),
  score_a      int  not null,
  score_b      int  not null,
  set_by       uuid references auth.users(id),
  set_at       timestamptz not null default now(),
  primary key (group_letter, team_a, team_b),
  check (team_a < team_b),
  check (score_a <> score_b)
);
alter table public.tie_shootouts enable row level security;
create policy read_ties on public.tie_shootouts for select using (true);

create or replace function public.set_tie_shootout(
  p_group text, p_team_a text, p_team_b text, p_score_a int, p_score_b int
) returns void
language plpgsql security definer set search_path = public as $$
declare lo text; hi text; slo int; shi int;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  if p_team_a = p_team_b then raise exception 'same_team'; end if;
  if p_score_a = p_score_b then raise exception 'shootout_level'; end if;

  if p_team_a < p_team_b then lo:=p_team_a; hi:=p_team_b; slo:=p_score_a; shi:=p_score_b;
  else lo:=p_team_b; hi:=p_team_a; slo:=p_score_b; shi:=p_score_a; end if;

  insert into public.tie_shootouts (group_letter, team_a, team_b, score_a, score_b, set_by)
  values (p_group, lo, hi, slo, shi, auth.uid())
  on conflict (group_letter, team_a, team_b)
  do update set score_a = excluded.score_a, score_b = excluded.score_b,
                set_by = excluded.set_by, set_at = now();

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'tie_shootout',
          jsonb_build_object('group',p_group,'a',lo,'b',hi,'sa',slo,'sb',shi));
end $$;

drop function if exists public.set_clock(uuid, text, int, bigint);

create or replace function public.set_clock(
  p_match uuid,
  p_action text,
  p_expected_version int,
  p_half_ms bigint default 1200000,
  p_home text default null,
  p_away text default null
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
    raise exception 'stale_version:%', m.version using errcode = '40001';
  end if;

  banked := m.clock_accum_ms
          + case when m.clock_running
                 then (extract(epoch from (now() - m.clock_anchor)) * 1000)::bigint
                 else 0 end;

  if p_action = 'start' then
    if m.status <> 'scheduled' then raise exception 'bad_transition'; end if;
    if m.home_team is null or m.away_team is null then
      if p_home is null or p_away is null then raise exception 'teams_not_set'; end if;
      if p_home = p_away then raise exception 'same_team'; end if;
      m.home_team := coalesce(m.home_team, p_home);
      m.away_team := coalesce(m.away_team, p_away);
    end if;
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
    home_team = m.home_team, away_team = m.away_team,
    version = version + 1, controlled_by = auth.uid(), controlled_at = now(),
    updated_at = now()
  where id = p_match returning * into m;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'clock:' || p_action, p_match, jsonb_build_object('version', m.version));

  return m;
end $$;

create or replace function public.reset_tournament() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;

  delete from public.match_events;
  delete from public.slot_overrides;
  delete from public.tie_shootouts;

  update public.matches set
    status = 'scheduled', home_score = 0, away_score = 0,
    pens_home = 0, pens_away = 0, pens_decided = false,
    forfeit_side = null, clock_running = false, clock_anchor = null,
    clock_accum_ms = 0, locked = false, version = 0,
    controlled_by = null, controlled_at = null, updated_at = now();

  update public.matches set home_team = null, away_team = null
  where stage in ('SF1','SF2','FINAL');

  update public.teams set disqualified = false;

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'reset_tournament', '{}'::jsonb);
end $$;

create or replace function public.snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) - 'created_at' order by t.group_letter, t.city), '[]'::jsonb) from public.teams t),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'team', p.team_id, 'name', p.name, 'no', p.shirt_no)
        order by p.shirt_no nulls last, p.name), '[]'::jsonb)
      from public.players p where p.active),
    'slots', (select coalesce(jsonb_object_agg(slot, team_id), '{}'::jsonb) from public.slot_overrides),
    'ties', (select coalesce(jsonb_agg(jsonb_build_object(
        'g', ts.group_letter, 'a', ts.team_a, 'b', ts.team_b,
        'sa', ts.score_a, 'sb', ts.score_b)), '[]'::jsonb) from public.tie_shootouts ts),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'stage', m.stage, 'day', m.day, 'kickoff', m.kickoff, 'pitch', m.pitch,
        'home', m.home_team, 'away', m.away_team, 'hs', m.home_score, 'as', m.away_score,
        'ph', m.pens_home, 'pa', m.pens_away, 'pd', m.pens_decided,
        'ff', m.forfeit_side, 'status', m.status,
        'run', m.clock_running, 'anchor', m.clock_anchor, 'accum', m.clock_accum_ms,
        'v', m.version) order by m.day, m.kickoff, m.pitch), '[]'::jsonb) from public.matches m),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'm', e.match_id, 't', e.type, 's', e.side,
        'min', e.minute_label, 'p', e.player_id) order by e.created_at desc), '[]'::jsonb)
      from public.match_events e where not e.voided)
  );
$$;

revoke all on function public.set_clock(uuid,text,int,bigint,text,text) from public, anon, authenticated;
revoke all on function public.set_tie_shootout(text,text,text,int,int)  from public, anon, authenticated;
revoke all on function public.reset_tournament()                        from public, anon, authenticated;
revoke all on function public.snapshot()                                from public, anon, authenticated;

grant execute on function public.set_clock(uuid,text,int,bigint,text,text) to authenticated;
grant execute on function public.set_tie_shootout(text,text,text,int,int)  to authenticated;
grant execute on function public.reset_tournament()                        to authenticated;
grant execute on function public.snapshot()                                to anon, authenticated;
