-- 0043 — Vespers and Liturgy: the two things on the timetable that are not
--        matches, and must never be stored as matches.
--
-- The draw includes Vespers for all players on the Saturday evening and
-- Liturgy on the Sunday morning, both at St George Cathedral. Players need to
-- see them; the Fixtures tab is where they will look. But a match row for
-- Vespers would carry two empty team slots, a score of 0-0, a kick-off time
-- and a tappable match page, and would be counted by every assertion in the
-- app that says "twelve group matches". Hence its own small table.
--
-- WHY THIS RIDES IN snapshot() DESPITE THE STANDING RULE. The rule is that the
-- ARCHIVE must never ride in snapshot, because it is ~250KB polled by every
-- phone every five seconds. These are two rows of about sixty bytes gzipped,
-- against a snapshot measured today at 5,504 bytes over the wire. That is
-- roughly a 1% increase on a poll that totals ~29.5GB for a thousand devices
-- over eight hours. The alternative — a separate cached read — would add
-- another loader, another failure latch to get right, and another cache
-- version to remember to bump, for a saving of about 0.3GB on a 250GB plan.
-- Not worth it. The judgement is size, not category.
--
-- READ-ONLY BY CONSTRUCTION, like the archive: public read, no write policy,
-- no RPC. These change by migration, which is the honest level of ceremony for
-- two lines on a printed timetable. If the organiser ever needs to move
-- Vespers on the day, that is a one-line UPDATE run from the dashboard, and it
-- reaches every phone on the next five-second poll with no deploy at all —
-- which is exactly why the times live in the database rather than in app.js.

begin;

create table if not exists public.schedule_events (
  id        text primary key,
  day       integer not null check (day in (1, 2)),
  at_time   text    not null,          -- 'HH:MM', the same convention as matches.kickoff
  title     text    not null,
  detail    text,                      -- who it is for, if that is not obvious
  location  text
);

comment on table public.schedule_events is
  'Non-match items on the weekend timetable: services, ceremonies, breaks. Never fixtures.';

alter table public.schedule_events enable row level security;

-- Public read, and nothing else. Deliberately no insert/update/delete policy:
-- the table changes by migration or by an organiser at the SQL editor.
drop policy if exists schedule_events_read on public.schedule_events;
create policy schedule_events_read on public.schedule_events for select using (true);

grant select on public.schedule_events to anon, authenticated;

insert into public.schedule_events (id, day, at_time, title, detail, location) values
  ('vespers-sat', 1, '17:30', 'Vespers', 'All players', 'St George Cathedral'),
  ('liturgy-sun', 2, '09:30', 'Liturgy', 'All players, arrive 09:30', 'St George Cathedral')
on conflict (id) do update
  set day = excluded.day, at_time = excluded.at_time, title = excluded.title,
      detail = excluded.detail, location = excluded.location;

-- ── snapshot() gains one key ─────────────────────────────────────────
-- CREATE OR REPLACE, not DROP: the signature is unchanged, so the existing
-- grants survive. Dropping it would kill them and take the whole app down for
-- every spectator at once — see the standing note about DROP FUNCTION.
create or replace function public.snapshot()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
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
    'schedule', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'day', s.day, 'at', s.at_time, 'title', s.title,
        'detail', s.detail, 'where', s.location) order by s.day, s.at_time), '[]'::jsonb)
      from public.schedule_events s),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'stage', m.stage, 'day', m.day, 'kickoff', m.kickoff, 'pitch', m.pitch,
        'home', m.home_team, 'away', m.away_team, 'hs', m.home_score, 'as', m.away_score,
        'ph', m.pens_home, 'pa', m.pens_away, 'pd', m.pens_decided,
        'ff', m.forfeit_side, 'status', m.status,
        'run', m.clock_running, 'anchor', m.clock_anchor, 'accum', m.clock_accum_ms,
        'v', m.version) order by m.day, m.kickoff, m.pitch), '[]'::jsonb) from public.matches m),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'm', e.match_id, 't', e.type, 's', e.side,
        'min', e.minute_label, 'p', e.player_id,
        'a', e.assist_player) order by e.created_at desc), '[]'::jsonb)
      from public.match_events e where not e.voided)
  );
$function$;

do $$
declare n int; snap jsonb;
begin
  select count(*) into n from public.schedule_events;
  if n <> 2 then raise exception 'expected 2 schedule events, found %', n; end if;

  -- they are NOT matches, and nothing about the draw moved
  select count(*) into n from public.matches;
  if n not in (0, 15) then raise exception 'match count unexpectedly %', n; end if;

  -- snapshot still works, still has every key it had, and now has schedule
  snap := public.snapshot();
  if snap is null then raise exception 'snapshot() returned null'; end if;
  if not (snap ? 'schedule') then raise exception 'snapshot has no schedule key'; end if;
  if not (snap ? 'matches' and snap ? 'teams' and snap ? 'players' and snap ? 'events'
          and snap ? 'slots' and snap ? 'ties' and snap ? 'trophies' and snap ? 'now') then
    raise exception 'snapshot lost a key it used to have';
  end if;
  if jsonb_array_length(snap -> 'schedule') <> 2 then
    raise exception 'snapshot schedule should hold 2 items, holds %',
      jsonb_array_length(snap -> 'schedule');
  end if;

  -- the anon role can still read it, which is the whole point
  if not exists (select 1 from information_schema.role_table_grants
                  where table_name = 'schedule_events' and grantee = 'anon'
                    and privilege_type = 'SELECT') then
    raise exception 'anon cannot read schedule_events';
  end if;
end $$;

commit;
