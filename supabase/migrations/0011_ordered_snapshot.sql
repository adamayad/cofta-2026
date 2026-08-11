-- ============================================================
-- COFTA 2026 — canonical snapshot ordering
--
-- The snapshot had no ORDER BY, so Postgres returned matches in heap
-- order — and updated rows move, which made every match being played
-- sink to the bottom of the fixtures list. The client now sorts
-- defensively too, but the payload should be canonical at source:
-- day, kick-off, pitch.
-- ============================================================

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

revoke all on function public.snapshot() from public, anon, authenticated;
grant execute on function public.snapshot() to anon, authenticated;
