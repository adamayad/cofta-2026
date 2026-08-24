-- 0036 — CONAFA 2015 and 2016: the full article text.
--
-- Supersedes the partial blocks 0026 imported from the same two sources. Same
-- articles, read in full, plus the Ireland identification 0035 has now made.
--
-- CONAFA 2015 — ALL ELEVEN ENTRANTS ARE NOW NAMED, so teams_note stops
-- apologising for seven missing ones. Group qualifiers are recorded; the group
-- TABLES and the semi-final pairings are not, and are not inferred. Nottingham
-- progressed from their own group as hosts and did not reach the final; how
-- they went out is not stated, so nothing says.
--
-- CONAFA 2016 — five of eleven named, and that does not change: the report
-- names the four semi-finalists and the debutants and no more. What is added
-- is Ireland's ABSENCE. They entered in 2015 and could not attend in 2016, and
-- recording that turns a hole in their record into a known fact. The final
-- score stays null: the report says the deciding goal came minutes before the
-- whistle and never gives a number. It is not 1-0 because it sounds like 1-0.

begin;

-- ── CONAFA 2015 ────────────────────────────────────────────────────────
update public.archive_editions
   set source = 'https://ukmidcopts.org/news/conafa-2015/ (full article text) ; organiser-confirmed',
       team_count = 11,
       notes = notes
             || jsonb_build_object(
                  'team_count_basis',
                    'stated by the source as a record entry, and the eleven are now all named',
                  'teams_note', 'All eleven entrants are named.',
                  'qualifiers', jsonb_build_object(
                     'Group A', jsonb_build_array('Nottingham','Golders Green'),
                     'Group B', jsonb_build_array('Brighton','Manchester'),
                     'note', 'Who progressed from each group. The group tables themselves, and the semi-final pairings and scores, are not recorded.'),
                  'edition_note',
                    'Hosted by Nottingham. A record eleven teams. Brighton, St Mary & St Mina of Ireland and the Eritrean Orthodox side all entered for the first time. St Mark arrived as defending champions, having won the first CONAFA in 2014.',
                  'known_gaps', jsonb_build_array(
                    'Final home/away orientation not recorded.',
                    'No dates or venue.',
                    'Semi-final pairings and scores not recorded. Nottingham progressed from their group as hosts but did not reach the final; how they went out is not stated.',
                    'Group tables and match results not recorded.',
                    'No goalscorers, awards or player data.'))
 where id = 'conafa-2015';

-- the seven entrants the partial import could not name
insert into public.archive_edition_teams (edition_id, team_id)
select 'conafa-2015', t.id from public.archive_teams t
 where t.parent_club is null
   and t.short_name in ('St Mark','Manchester','St Mary & St Mark',
                        'Croydon','Rotherham','Stevenage','Eritrean')
on conflict do nothing;

-- ── CONAFA 2016 ────────────────────────────────────────────────────────
update public.archive_editions
   set notes = notes
             || jsonb_build_object(
                  'absentees', jsonb_build_array(
                     jsonb_build_object(
                       'club', 'St Mary & St Mina, Ireland',
                       'reason', 'Unable to attend. Entrants in 2015, absent in 2016 - recorded so the gap in their record is a known absence rather than a missing name among the six unnamed entrants.')),
                  'edition_note',
                    'The third CONAFA, hosted by Nottingham. Eleven teams. St Mary & St Mina of Ireland, debutants the year before, were unable to attend. St Mary & St George, East London were debutants. The report notes three different winners in as many years, corroborating the 2014, 2015 and 2016 champions.')
 where id = 'conafa-2016';

do $$
declare n int;
begin
  -- 2015 now names all eleven
  select count(*) into n from public.archive_edition_teams where edition_id = 'conafa-2015';
  if n <> 11 then raise exception 'expected 11 CONAFA 2015 entrants, found %', n; end if;

  -- including the two clubs 0035 created
  if not exists (select 1 from public.archive_edition_teams et
                   join public.archive_teams t on t.id = et.team_id
                  where et.edition_id = 'conafa-2015'
                    and t.canonical_name = 'St Mary & St Mark' and t.city = 'Birmingham') then
    raise exception 'CONAFA 2015 must include St Mary & St Mark, Birmingham';
  end if;
  if not exists (select 1 from public.archive_edition_teams et
                   join public.archive_teams t on t.id = et.team_id
                  where et.edition_id = 'conafa-2015' and t.canonical_name = 'Eritrean Orthodox') then
    raise exception 'CONAFA 2015 must include the Eritrean Orthodox side';
  end if;
  -- and Ireland, under its corrected name
  if not exists (select 1 from public.archive_edition_teams et
                   join public.archive_teams t on t.id = et.team_id
                  where et.edition_id = 'conafa-2015'
                    and t.canonical_name = 'St Mary & St Mina' and t.city = 'Ireland') then
    raise exception 'CONAFA 2015 must include St Mary & St Mina, Ireland';
  end if;
  -- the two St Mina clubs did NOT both get attached (G4 in practice)
  select count(*) into n from public.archive_edition_teams et
    join public.archive_teams t on t.id = et.team_id
   where et.edition_id = 'conafa-2015' and t.canonical_name = 'St Mary & St Mina';
  if n <> 2 then
    raise exception 'CONAFA 2015 had both St Mina clubs as entrants (Manchester and Ireland); expected exactly 2 distinct rows, found %', n;
  end if;

  -- 2016: Ireland is NOT an entrant, and their absence is recorded
  if exists (select 1 from public.archive_edition_teams et
               join public.archive_teams t on t.id = et.team_id
              where et.edition_id = 'conafa-2016'
                and t.canonical_name = 'St Mary & St Mina' and t.city = 'Ireland') then
    raise exception 'Ireland must NOT be a CONAFA 2016 entrant';
  end if;
  if not exists (select 1 from public.archive_editions
                  where id = 'conafa-2016' and notes ? 'absentees') then
    raise exception 'CONAFA 2016 must record Ireland as an absentee';
  end if;
  select count(*) into n from public.archive_edition_teams where edition_id = 'conafa-2016';
  if n <> 5 then raise exception 'CONAFA 2016 entrant count must stay at 5, found %', n; end if;

  -- the final score is still not invented
  if exists (select 1 from public.archive_editions
              where id = 'conafa-2016' and final_summary ilike '%1-0%') then
    raise exception 'CONAFA 2016 final score must remain unstated';
  end if;

  -- champions and runners-up untouched on both
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams t on t.id = e.champion_team_id
                  where e.id = 'conafa-2015' and t.short_name = 'Brighton') then
    raise exception 'conafa-2015 champion must still be Brighton';
  end if;
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams t on t.id = e.champion_team_id
                  where e.id = 'conafa-2016' and t.short_name = 'Manchester') then
    raise exception 'conafa-2016 champion must still be Manchester';
  end if;
end $$;

commit;
