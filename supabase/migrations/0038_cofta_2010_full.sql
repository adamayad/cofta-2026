-- 0038 — COFTA 2010 upgraded from a scoreline to a tournament, and Ladies
--        COFTA 2010 given the date and venue the same report announces.
--
-- Source: the COFTA 2010 official report, organiser-supplied full text. Stored
-- on the row and cited; the narrative detail lives in notes.narrative.
--
-- DATES CORRECTED, 10-12 September to 11-12 September. The report is
-- contemporaneous and is taken as correct. Logged as C17 rather than silently
-- overwritten, because the range being replaced was itself organiser-supplied
-- and someone should be able to find out where it came from.
--
-- VENUE is more specific than the era-level "Shephalbury Park, Stevenage" this
-- row inherited: the Coptic Orthodox Church Centre, Shephalbury Park.
--
-- WHAT IS DELIBERATELY NOT RECORDED. Rotherham's semi-final opponent. The
-- report says they came back from a goal down and never names who from. The
-- entrant list makes Croydon the only real candidate, and that is precisely
-- why it is a note and not a team_id — an inference that obvious is the kind
-- that gets promoted to fact by the next person to read it.
--
-- LADIES COFTA 2010 gets 2 October 2010 and the Coptic Orthodox Church Centre,
-- STEVENAGE — a DIFFERENT venue from the men's tournament three weeks earlier,
-- and the two must not be merged into one venue string.

begin;

update public.archive_editions
   set date_start = date '2010-09-11',
       date_end   = date '2010-09-12',
       venue      = 'Coptic Orthodox Church Centre, Shephalbury Park',
       format     = 'Two groups, semi-finals, final',
       team_count = 6,

       source = 'COFTA 2010 official report (organiser-supplied full text); Adam''s COFTA champions roll, organiser-confirmed',
       notes = (notes - 'venue_note') || jsonb_build_object(
         'date_note', 'The official report gives 11-12 September. The archive previously held 10-12 September; that earlier range is superseded and the discrepancy is logged as C17.',
         'teams_note', 'All six entrants are named.',
         'group_stage', jsonb_build_object(
            'Group A', jsonb_build_object(
               'qualified', jsonb_build_array('Brighton','Croydon'),
               'note', 'Brighton topped the group; Croydon qualified second. Full table not recorded.'),
            'Group B', jsonb_build_object(
               'qualified', jsonb_build_array('Rotherham','St Mark'),
               'note', 'Both qualified. Order not recorded.'),
            'non_qualifiers', jsonb_build_array(
               jsonb_build_object('club','Stevenage',
                 'note','Four points from four games; did not qualify.'))),
         'semi_finals', jsonb_build_array(
            jsonb_build_object('winner','Brighton','loser','St Mark','score',null,
              'decided_by','penalties',
              'note','Level after normal time; Brighton went through on penalties. Neither the normal-time score nor the shoot-out score is recorded.'),
            jsonb_build_object('winner','Rotherham','loser',null,'score',null,
              'decided_by',null,
              'note','Rotherham came back from a goal down to win. The report does not name their opponent. Probable but unconfirmed: Croydon - recorded as a note, never as data.')),
         'edition_note', 'Rotherham''s first COFTA, and they reached the final at the first attempt. Brighton won the first of three consecutive titles.',
         'narrative', 'Rotherham were debutants; St Mark used a substitute recorded only as "Mark Bishoy"; the report is anonymous and written in a light-hearted style.',
         'known_gaps', jsonb_build_array(
           'Final home/away orientation not recorded; only the winner, loser and score.',
           'Semi-final scores not recorded, and Rotherham''s semi-final opponent is not named.',
           'Group tables not recorded beyond who qualified, and Stevenage''s four points.',
           'No goalscorers, awards or player data.'))
 where id = 'cofta-2010';

insert into public.archive_edition_teams (edition_id, team_id)
select 'cofta-2010', t.id from public.archive_teams t
 where t.parent_club is null
   and t.short_name in ('Brighton','Croydon','Golders Green','Rotherham','St Mark','Stevenage')
on conflict do nothing;

update public.archive_editions
   set date_start = date '2010-10-02',
       date_end   = date '2010-10-02',
       venue      = 'Coptic Orthodox Church Centre, Stevenage',
       source     = 'COFTA 2010 official report (which announces the date and venue); Adam, organiser-confirmed',
       notes      = notes || jsonb_build_object(
         'venue_note', 'A different venue from the men''s tournament three weeks earlier, which was at the Coptic Orthodox Church Centre, Shephalbury Park. The two are recorded separately and must not be merged.')
 where id = 'ladies-cofta-2010';

do $$
declare n int;
begin
  if not exists (select 1 from public.archive_editions
                  where id = 'cofta-2010'
                    and date_start = date '2010-09-11' and date_end = date '2010-09-12') then
    raise exception 'cofta-2010 dates not corrected';
  end if;

  select count(*) into n from public.archive_edition_teams where edition_id = 'cofta-2010';
  if n <> 6 then raise exception 'cofta-2010 expected 6 entrants, found %', n; end if;

  -- the result that was already there is untouched
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams c on c.id = e.champion_team_id
                   join public.archive_teams r on r.id = e.runner_up_team_id
                  where e.id = 'cofta-2010'
                    and c.short_name = 'Brighton' and r.short_name = 'Rotherham'
                    and e.final_summary ilike '%3-0%') then
    raise exception 'cofta-2010 final must still read Brighton 3-0 Rotherham';
  end if;

  -- the unnamed semi-final opponent stayed unnamed
  if (select notes #>> '{semi_finals,1,loser}' from public.archive_editions
       where id = 'cofta-2010') is not null then
    raise exception 'Rotherham''s semi-final opponent must remain unrecorded';
  end if;

  -- Ladies COFTA 2010: its own date, and NOT the men's venue
  if not exists (select 1 from public.archive_editions
                  where id = 'ladies-cofta-2010' and date_start = date '2010-10-02'
                    and venue = 'Coptic Orthodox Church Centre, Stevenage') then
    raise exception 'ladies-cofta-2010 date or venue wrong';
  end if;
  if (select venue from public.archive_editions where id = 'ladies-cofta-2010')
   = (select venue from public.archive_editions where id = 'cofta-2010') then
    raise exception 'the two 2010 venues must stay distinct';
  end if;
end $$;

commit;
