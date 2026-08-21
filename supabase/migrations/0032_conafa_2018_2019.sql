-- 0032_conafa_2018_2019.sql
--
-- CONAFA 2018 and 2019, Brighton champions, organiser-confirmed.
--
-- Read as two editions rather than one 2018-19 season: every other CONAFA
-- edition in the archive is a single calendar year, and the original wording
-- was "2018 and 2019".
--
-- This narrows but does not close the CONAFA gap. Adam believes there was no
-- CONAFA in 2020, 2021 or 2022, and that belief is recorded in
-- archive_meta.no_tournament_years marked `confidence: believed` — kept
-- separate from COFTA's 2013 and 2020, which are confirmed non-events. "We
-- checked and it did not happen" and "we are fairly sure it did not happen"
-- are different facts. No rows exist either way, so nothing renders
-- differently; the distinction is there so a later source can settle it
-- rather than be assumed to have already agreed.

begin;

insert into public.archive_editions
  (id, competition, year, display_name, category, date_start, date_end, venue,
   format, team_count, match_count, champion_team_id, runner_up_team_id,
   final_summary, data_confidence, source, notes)
values
  ('conafa-2018', 'CONAFA', 2018, 'CONAFA 2018', 'men', null, null, null,
   null, null, null, '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal', 'Adam, organiser-confirmed',
   '{"teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates or venue.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),
  ('conafa-2019', 'CONAFA', 2019, 'CONAFA 2019', 'men', null, null, null,
   null, null, null, '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal', 'Adam, organiser-confirmed',
   '{"teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates or venue.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb);

insert into public.archive_edition_teams (edition_id, team_id)
select v.ed, t.id
from (values ('conafa-2018'), ('conafa-2019')) as v(ed)
cross join public.archive_teams t
where t.short_name = 'Brighton' and t.parent_club is null
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.archive_editions where competition = 'CONAFA';
  if n <> 10 then raise exception 'expected 10 CONAFA editions, found %', n; end if;

  select count(*) into n from public.archive_editions;
  if n <> 37 then raise exception 'expected 37 editions, found %', n; end if;

  select count(*) into n from public.archive_editions e
    join public.archive_teams t on t.id = e.champion_team_id
   where e.id in ('conafa-2018','conafa-2019') and t.short_name = 'Brighton';
  if n <> 2 then raise exception 'both new CONAFA rows must be Brighton, found %', n; end if;

  -- COFTA 2018 and 2019 are a different competition and must be untouched
  select count(*) into n from public.archive_editions
   where competition = 'COFTA' and year in (2018, 2019);
  if n <> 2 then raise exception 'COFTA 2018/2019 must still exist'; end if;

  if exists (select 1 from public.archive_editions
              where competition = 'CONAFA' and year in (2020, 2021, 2022)) then
    raise exception 'CONAFA 2020-2022 are unrecorded and must not be invented';
  end if;
end $$;

commit;
