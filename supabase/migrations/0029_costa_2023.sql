-- 0029_costa_2023.sql
--
-- COSTA 2023, organiser-confirmed: Brighton champions, nothing else recorded.
-- Fills the gap between the 2022 and 2024 editions the archive already holds.
--
-- It carries the same origins_unrecorded note as every other COSTA edition:
-- the competition's founding year is still unknown, and 2022 remains only the
-- earliest edition the archive holds rather than the first that was played.

begin;

insert into public.archive_editions
  (id, competition, year, display_name, category, date_start, date_end, venue,
   format, team_count, match_count, champion_team_id, runner_up_team_id,
   final_summary, data_confidence, source, notes)
values
  ('costa-2023', 'COSTA', 2023, 'COSTA 2023', 'men', null, null, null,
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal', 'Adam, organiser-confirmed',
   '{"origins_unrecorded":"COSTA''s founding year is unknown. The earliest edition the archive holds is not known to be the first.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates or venue.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb);

insert into public.archive_edition_teams (edition_id, team_id)
select 'costa-2023', t.id
from public.archive_teams t
where t.short_name = 'Brighton' and t.parent_club is null
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.archive_editions where competition = 'COSTA';
  if n <> 4 then raise exception 'expected 4 COSTA editions, found %', n; end if;

  select count(*) into n from public.archive_editions;
  if n <> 35 then raise exception 'expected 35 editions, found %', n; end if;

  -- every COSTA edition keeps the origins note, including the new one
  select count(*) into n from public.archive_editions
   where competition = 'COSTA' and notes ? 'origins_unrecorded';
  if n <> 4 then raise exception 'all 4 COSTA editions need the origins note, % have it', n; end if;

  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams t on t.id = e.champion_team_id
                  where e.id = 'costa-2023' and t.short_name = 'Brighton') then
    raise exception 'costa-2023 champion must be Brighton';
  end if;
end $$;

commit;
