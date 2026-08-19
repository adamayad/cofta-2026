-- ============================================================
-- COFTA 2026 — assists, and an archive of finished tournaments
--
-- Two concerns in one migration because they land together: both add to
-- snapshot(), and replacing that function twice in two files would leave a
-- window where one of them is missing from the payload.
-- ============================================================

-- ── assists ─────────────────────────────────────────────────
-- An assist hangs off the goal it created, so it lives on the event rather
-- than in a table of its own. Nullable because the overwhelming majority of
-- goals are logged at speed with nobody named at all: attribution is a
-- second pass, never a gate on the score moving.
--
-- on delete set null, not cascade: removing a player must never delete the
-- goal they set up.
alter table public.match_events
  add column if not exists assist_player uuid references public.players(id) on delete set null;

comment on column public.match_events.assist_player is
  'Only meaningful where type = ''goal''. An own goal never has an assist, '
  'and an assist never belongs to the scorer. Enforced in edit_event().';

-- edit_event gains the assist. The signature changes, so the old function is
-- DROPPED rather than replaced: adding a defaulted parameter creates an
-- overload, and PostgREST cannot choose between them (see 0006 onwards).
-- Grants die with the drop and are re-issued at the foot of this file.
drop function if exists public.edit_event(uuid, uuid, text);

create or replace function public.edit_event(
  p_event uuid, p_player uuid, p_minute text, p_assist uuid default null
) returns public.match_events
language plpgsql security definer set search_path = public as $$
declare e public.match_events;
begin
  if not public.is_admin() then raise exception 'not_authorised' using errcode='42501'; end if;
  if p_minute is null or length(p_minute) > 8
     or p_minute !~ '^\d{1,2}(\+\d{1,2})?[′'']?$' then
    raise exception 'bad_minute';
  end if;

  select * into e from public.match_events where id = p_event and not voided for update;
  if not found then raise exception 'no_such_event'; end if;

  -- An assist exists only on a goal, only alongside a named scorer, and never
  -- belongs to the scorer. Checked here rather than in a table constraint
  -- because the rule spans columns and needs to name what went wrong.
  if p_assist is not null then
    if e.type <> 'goal'  then raise exception 'assist_not_a_goal';    end if;
    if p_player is null  then raise exception 'assist_without_scorer'; end if;
    if p_assist = p_player then raise exception 'assist_is_scorer';    end if;
  end if;

  -- FULL REPLACE, as before: every field is set from what was passed. The
  -- client therefore sends the assist it is currently showing on every edit,
  -- so correcting a minute can never silently drop the assist beside it.
  update public.match_events
    set player_id     = p_player,
        assist_player = p_assist,
        minute_label  = regexp_replace(p_minute, '[′'']$', '') || '′'
  where id = p_event
  returning * into e;

  insert into public.audit_log(actor, action, match_id, detail)
  values (auth.uid(), 'event:edit', e.match_id,
          jsonb_build_object('event', p_event, 'player', p_player,
                             'assist', p_assist, 'minute', p_minute));
  return e;
end $$;

-- ── archive of finished tournaments ─────────────────────────
-- Deliberately not modelled: previous years are read-only documents, not
-- live fixtures. A jsonb blob per competition/gender/year keeps a decade of
-- results out of the schema, and adding next year's competition is a
-- one-line change to the check constraint below.
create table if not exists public.past_tournaments (
  competition text not null check (competition in ('cofta','conafa','costa','ark')),
  gender      text not null check (gender in ('men','women')),
  year        int  not null,
  data        jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  primary key (competition, gender, year)
);

comment on table public.past_tournaments is
  'Archive of finished tournaments. reset_tournament() deliberately does NOT '
  'touch this table: a rehearsal reset clears this year''s scores and must '
  'never erase previous years.';

alter table public.past_tournaments enable row level security;

-- Public read, like every other spectator-facing table. No insert/update/
-- delete policy: writes go through set_past_tournament() only.
drop policy if exists read_past on public.past_tournaments;
create policy read_past on public.past_tournaments for select using (true);

create or replace function public.set_past_tournament(
  p_competition text, p_gender text, p_year int, p_data jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select role from public.admins where user_id = auth.uid()), '')
     <> 'organiser' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'bad_data';
  end if;
  if p_year is null or p_year < 1900 or p_year > 2200 then
    raise exception 'bad_year';
  end if;

  -- Upsert: re-entering a year corrects it. The check constraints on the
  -- table reject an unknown competition or gender before we get here.
  insert into public.past_tournaments (competition, gender, year, data, updated_by, updated_at)
  values (p_competition, p_gender, p_year, p_data, auth.uid(), now())
  on conflict (competition, gender, year) do update
    set data = excluded.data, updated_by = excluded.updated_by, updated_at = now();

  insert into public.audit_log(actor, action, detail)
  values (auth.uid(), 'past_tournament:set',
          jsonb_build_object('competition', p_competition, 'gender', p_gender,
                             'year', p_year));
end $$;

-- ── snapshot ────────────────────────────────────────────────
-- Events gain 'a' (the assist) and the payload gains 'history'. The archive
-- is small and static — a few rows of jsonb that change once a year — so it
-- rides along with the 5-second poll rather than earning a second endpoint.
-- Same signature, so this is a replace and the grants survive; re-issued
-- below anyway, per house style.
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
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'competition', pt.competition, 'gender', pt.gender,
        'year', pt.year, 'data', pt.data)
        order by pt.competition, pt.gender, pt.year desc), '[]'::jsonb)
      from public.past_tournaments pt),
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
$$;

-- ── privileges ──────────────────────────────────────────────
-- Postgres grants EXECUTE on a new function to PUBLIC, which anon inherits,
-- so revoke from PUBLIC and grant back explicitly (0003, 0006).
revoke all on function public.edit_event(uuid, uuid, text, uuid)          from public, anon, authenticated;
revoke all on function public.set_past_tournament(text, text, int, jsonb) from public, anon, authenticated;
revoke all on function public.snapshot()                                  from public, anon, authenticated;

grant execute on function public.edit_event(uuid, uuid, text, uuid)          to authenticated;
grant execute on function public.set_past_tournament(text, text, int, jsonb) to authenticated;
grant execute on function public.snapshot()                                  to anon, authenticated;
