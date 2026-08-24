-- 0039 — COFTA 2012 enrichment, and the archive's largest known margin.
--
-- Source: the COFTA 2012 report, organiser-supplied full text. It CORROBORATES
-- both details the archive already held from the Coptic Youth UK blog — that
-- St Mark withdrew after day one, and that Nottingham reached the semi-finals
-- without winning a game. Two independent sources, same facts, recorded as a
-- corroboration rather than re-stated as if new.
--
-- ROTHERHAM ARE CONFIRMED ABSENT, which is a different fact from being missing
-- from a partial list — they were finalists in both 2010 and 2011, so their
-- absence is the interesting part of their record for that year.
--
-- BRIGHTON 11-1 STEVENAGE, a group match the report calls the greatest defeat
-- in COFTA history. Stored as a match row with home and away NULL: the report
-- gives the margin and the sides, not the fixture orientation, and a ten-goal
-- result is exactly the kind of row someone will later read orientation off.
--
-- The final gains extra time before penalties, and Croydon leading first. The
-- scorer of that opening goal is given in the report ONLY as a nickname, which
-- is not a usable player name and is deliberately not stored as one.
--
-- Three years running, 2010-2012, is recorded as a notable achievement and NOT
-- as new championship data: the three titles are already on the roll.

begin;

update public.archive_editions
   set
       team_count = 5,
       source = 'COFTA 2012 report (organiser-supplied full text); Adam''s COFTA champions roll, organiser-confirmed; http://copticyouthuk.blogspot.com/2012/10/cofta-coptic-orthodox-football-tries.html',
       notes = notes || jsonb_build_object(
         'teams_note', 'All five entrants are named.',
         'absentees', jsonb_build_array(
            jsonb_build_object('club','Rotherham',
              'reason','Did not enter, having been finalists in both 2010 and 2011. Confirmed absent by the report rather than merely unlisted.')),
         'edition_note', 'Brighton''s third COFTA in a row, the first time any club had won three consecutively. Nottingham returned after several years away and reached the semi-finals without winning a game. St Mark withdrew after day one. Stevenage went out at the group stage.',
         'notable', jsonb_build_array(
            'Brighton became the first club to win COFTA three years running, 2010 to 2012.',
            'Brighton 11-1 Stevenage is the largest margin the archive holds.'),
         'corroborations', jsonb_build_array(
            'The organiser-supplied report independently confirms both details the archive already held from the Coptic Youth UK blog: that St Mark withdrew after day one, and that Nottingham reached the semi-finals without winning a game. Two sources, same facts.'),
         'final_note', 'Croydon led first; Brighton equalised from a penalty. The tie went to extra time and then to penalties. No score at any stage is recorded. The report names Croydon''s scorer only by a nickname, which is not a usable name and is not stored.',
         'known_gaps', jsonb_build_array(
           'Regulation and extra-time scores not stated for the final; only that it went to penalties.',
           'Shootout score not recorded.',
           'Stevenage''s two draws with Nottingham are described but no scores are given.',
           'No dates.',
           'No group tables, standings or other match data.',
           'No goalscorer or award data. The final''s opening scorer is given only as a nickname and is deliberately not stored as a player.'))
 where id = 'cofta-2012';

insert into public.archive_edition_teams (edition_id, team_id)
select 'cofta-2012', t.id from public.archive_teams t
 where t.parent_club is null and t.short_name = 'Stevenage'
on conflict do nothing;

-- The record margin. home/away null on purpose — see the header.
insert into public.archive_matches
  (id, edition_id, stage, group_name, round, label, match_date, kickoff_time, pitch, venue,
   home_team_id, away_team_id, home_score, away_score, decided_by,
   shootout_home, shootout_away, shootout_winner_id, events_status, gap_note, notes)
select 'COFTA12-GROUP-BRI-STE', 'cofta-2012', 'group', null, null,
       'Group match', null, null, null, null,
       null, null, null, null, null,
       null, null, null, 'score_only',
       'Home and away are not recorded; only that Brighton beat Stevenage 11-1.',
       jsonb_build_object(
         'winner','Brighton','loser','Stevenage','score','11-1',
         'record_note','The report calls this the greatest defeat in COFTA history. Recorded as the archive''s largest known margin, ten goals.')
on conflict (id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.archive_edition_teams where edition_id = 'cofta-2012';
  if n <> 5 then raise exception 'cofta-2012 expected 5 entrants, found %', n; end if;

  -- Rotherham are absent from the entrant list AND recorded as absent
  if exists (select 1 from public.archive_edition_teams et
               join public.archive_teams t on t.id = et.team_id
              where et.edition_id = 'cofta-2012' and t.short_name = 'Rotherham') then
    raise exception 'Rotherham must not be a 2012 entrant';
  end if;
  if not exists (select 1 from public.archive_editions
                  where id = 'cofta-2012' and notes ? 'absentees') then
    raise exception 'Rotherham''s absence must be recorded';
  end if;

  -- the record margin exists and claims no orientation
  if not exists (select 1 from public.archive_matches
                  where id = 'COFTA12-GROUP-BRI-STE'
                    and home_team_id is null and away_team_id is null
                    and notes ->> 'score' = '11-1') then
    raise exception 'the 11-1 row is missing or has invented an orientation';
  end if;

  -- the result already on the row is untouched
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams c on c.id = e.champion_team_id
                   join public.archive_teams r on r.id = e.runner_up_team_id
                  where e.id = 'cofta-2012'
                    and c.short_name = 'Brighton' and r.short_name = 'Croydon') then
    raise exception 'cofta-2012 finalists must be unchanged';
  end if;

  -- and no nickname leaked in as a player
  if exists (select 1 from public.archive_editions
              where id = 'cofta-2012' and notes::text ilike '%eerk%') then
    raise exception 'the nickname must not be stored';
  end if;
end $$;

commit;
