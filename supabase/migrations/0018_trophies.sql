-- ============================================================
-- COFTA 2026 — confirming the three trophies
--
-- The leaderboards compute who is leading. They cannot decide who WON:
--   * the golden boot and player of the tournament can end level, and a
--     shared trophy is a decision someone makes, not an arithmetic result;
--   * the golden glove is counted by club but presented to a goalkeeper,
--     and no column in this database knows which keeper that is.
--
-- So all three are recorded here as an organiser's explicit act. Every
-- trophy belongs to one or more PLAYERS, including the glove.
--
-- The role check is the one from reset_tournament(): pitch accounts run
-- matches, organisers hold the tournament-wide decisions. Hiding the panel
-- in the app is cosmetic; this is the gate.
-- ============================================================

create table if not exists public.trophy_awards (
  trophy     text not null check (trophy in
               ('golden_boot','player_of_tournament','golden_glove')),
  player_id  uuid not null references public.players(id) on delete cascade,
  awarded_by uuid references auth.users(id),
  awarded_at timestamptz not null default now(),
  primary key (trophy, player_id)
);

alter table public.trophy_awards enable row level security;

-- Public read, in line with every other spectator-facing table. There is no
-- insert/update/delete policy anywhere: writes go through set_trophy() only.
drop policy if exists read_trophies on public.trophy_awards;
create policy read_trophies on public.trophy_awards for select using (true);

-- ------------------------------------------------------------
-- set_trophy: replace one trophy's winners outright.
--
-- Delete-then-insert inside the function's own transaction, so no spectator
-- ever polls the gap and sees a trophy with nobody holding it. Confirming
-- again is how a correction is made — there is no separate edit path.
-- ------------------------------------------------------------
create or replace function public.set_trophy(p_trophy text, p_players uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce((select role from public.admins where user_id = auth.uid()), '')
     <> 'organiser' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  if p_trophy not in ('golden_boot','player_of_tournament','golden_glove') then
    raise exception 'unknown_trophy';
  end if;

  -- A trophy with no winner is not a state worth being able to reach; use
  -- reset_tournament() to clear the board.
  if p_players is null or coalesce(array_length(p_players, 1), 0) = 0 then
    raise exception 'no_players';
  end if;

  -- Every id must be a real player. Letting the insert quietly drop an
  -- unknown one would present the trophy to fewer people than were confirmed.
  if (select count(*) from public.players p where p.id = any(p_players))
     <> (select count(distinct x) from unnest(p_players) as t(x)) then
    raise exception 'no_such_player';
  end if;

  delete from public.trophy_awards where trophy = p_trophy;

  insert into public.trophy_awards (trophy, player_id, awarded_by)
  select distinct p_trophy, x, auth.uid() from unnest(p_players) as t(x);
  get diagnostics n = row_count;

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'trophy:' || p_trophy,
          jsonb_build_object('players', to_jsonb(p_players), 'count', n));
end $$;

-- ------------------------------------------------------------
-- snapshot(): carry the confirmed trophies to every device.
--
-- Shaped as { trophy: [player_id, ...] } so a shared trophy is the same
-- shape as a sole one. Same signature, so this is a replace and the existing
-- grants survive — they are re-issued below anyway, per house style.
-- ------------------------------------------------------------
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
    'trophies', (select coalesce(jsonb_object_agg(w.trophy, w.players), '{}'::jsonb) from (
        select trophy, jsonb_agg(player_id order by player_id) as players
        from public.trophy_awards group by trophy) w),
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

-- ------------------------------------------------------------
-- reset_tournament(): a rehearsal must clear the trophies too, or the next
-- run starts with last night's winners still presented.
-- `where true` throughout — Supabase preloads safeupdate on API connections
-- and refuses an unqualified DELETE/UPDATE (see 0014).
-- ------------------------------------------------------------
create or replace function public.reset_tournament() returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select role from public.admins where user_id = auth.uid()), '')
     <> 'organiser' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  delete from public.match_events   where true;
  delete from public.slot_overrides where true;
  delete from public.tie_shootouts  where true;
  delete from public.trophy_awards  where true;

  update public.matches set
    status = 'scheduled', home_score = 0, away_score = 0,
    pens_home = 0, pens_away = 0, pens_decided = false,
    forfeit_side = null, clock_running = false, clock_anchor = null,
    clock_accum_ms = 0, locked = false, version = 0,
    controlled_by = null, controlled_at = null, updated_at = now()
  where true;

  update public.matches set home_team = null, away_team = null
  where stage in ('SF1','SF2','FINAL');

  update public.teams set disqualified = false where true;

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'reset_tournament', '{}'::jsonb);
end $$;

-- ------------------------------------------------------------
-- Privileges. Postgres grants EXECUTE on a new function to PUBLIC, which
-- anon inherits — so revoke from PUBLIC and grant back explicitly (0003,
-- 0006). set_trophy is authenticated-only; the role check inside it does the
-- rest. snapshot stays readable by anonymous spectators.
-- ------------------------------------------------------------
revoke all on function public.set_trophy(text, uuid[]) from public, anon, authenticated;
revoke all on function public.reset_tournament()       from public, anon, authenticated;
revoke all on function public.snapshot()               from public, anon, authenticated;

grant execute on function public.set_trophy(text, uuid[]) to authenticated;
grant execute on function public.reset_tournament()       to authenticated;
grant execute on function public.snapshot()               to anon, authenticated;
