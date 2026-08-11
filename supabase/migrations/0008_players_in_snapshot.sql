-- ============================================================
-- COFTA 2026 — squads
-- Squads must reach the app for goalscorer and card attribution.
-- Small payload: 8 clubs x up to 23 names.
-- ============================================================

create or replace function public.snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) - 'created_at'), '[]'::jsonb) from public.teams t),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'team', p.team_id, 'name', p.name, 'no', p.shirt_no)
        order by p.shirt_no nulls last, p.name), '[]'::jsonb)
      from public.players p where p.active),
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

-- Squad entry, with the 23-man maximum enforced server-side.
create or replace function public.add_player(
  p_team text, p_name text, p_shirt int default null
) returns public.players
language plpgsql security definer set search_path = public as $$
declare pl public.players; n int;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;

  select count(*) into n from public.players where team_id = p_team and active;
  if n >= 23 then raise exception 'squad_full'; end if;

  insert into public.players (team_id, name, shirt_no)
  values (p_team, btrim(p_name), p_shirt)
  returning * into pl;

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'player:add', jsonb_build_object('team',p_team,'name',p_name));
  return pl;
end $$;

create or replace function public.remove_player(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  update public.players set active = false where id = p_id;
end $$;

-- See 0006: privileges must be re-granted after creating any function.
revoke all on function public.snapshot()                     from public, anon, authenticated;
revoke all on function public.add_player(text, text, int)    from public, anon, authenticated;
revoke all on function public.remove_player(uuid)            from public, anon, authenticated;

grant execute on function public.snapshot()                  to anon, authenticated;
grant execute on function public.add_player(text, text, int) to authenticated;
grant execute on function public.remove_player(uuid)         to authenticated;
