-- 0041 — COFTA 2009 gains a runner-up, a final and a semi-final.
--
-- Organiser-confirmed:
--   Semi-final  St Mark 1-0 Stevenage
--   Final       St Mark 1-0 Croydon
--
-- The row held only "champion: St Mark" and nothing else. Nothing here
-- contradicts anything: runner_up was NULL, so this fills a gap rather than
-- overwriting a fact.
--
-- Cabinet effect, and the reason to be careful about which club gets what:
--   * CROYDON gain a 2009 runner-up line, distinct from their 2005 and 2006
--     championships and from their 2012 runner-up.
--   * STEVENAGE gain a 2009 semi-final appearance — an entrant row, not a
--     final. Distinct from their 2008 championship (0034) and from the
--     runner-up lines they already hold.
--
-- Home and away are not recorded for either match, only who beat whom. Both
-- rows leave the orientation NULL rather than guessing from who is named first.
--
-- The OTHER semi-final is not recorded at all, so the fourth semi-finalist is
-- unknown and no row pretends otherwise.

begin;

update public.archive_editions e
   set runner_up_team_id = t.id,
       final_summary = 'St Mark beat Croydon 1-0 in the final',
       source = 'Adam''s COFTA champions roll and 2009 semi-final and final detail, organiser-confirmed',
       notes = e.notes || jsonb_build_object(
         'teams_note', 'The finalists and the beaten semi-finalist. This is not the full entrant list.',
         'semi_finals', jsonb_build_array(
            jsonb_build_object('winner','St Mark','loser','Stevenage','score','1-0')),
         'known_gaps', jsonb_build_array(
           'Home/away orientation not recorded for the final or the semi-final.',
           'The other semi-final is not recorded, so the fourth semi-finalist is unknown.',
           'No dates.',
           'No full entrant list, group stage, standings or other match data.',
           'No goalscorers, awards or player data.'))
  from public.archive_teams t
 where e.id = 'cofta-2009'
   and t.short_name = 'Croydon' and t.parent_club is null;

insert into public.archive_edition_teams (edition_id, team_id)
select 'cofta-2009', t.id from public.archive_teams t
 where t.parent_club is null and t.short_name in ('Croydon','Stevenage')
on conflict do nothing;

insert into public.archive_matches
  (id, edition_id, stage, label, home_team_id, away_team_id, home_score, away_score,
   events_status, gap_note, notes)
values
  ('COFTA09-SF1', 'cofta-2009', 'semi_final', 'Semi-final', null, null, null, null, 'score_only',
   'Home and away are not recorded; only that St Mark beat Stevenage 1-0.',
   '{"winner":"St Mark","loser":"Stevenage","score":"1-0"}'::jsonb),
  ('COFTA09-FINAL', 'cofta-2009', 'final', 'Final', null, null, null, null, 'score_only',
   'Home and away are not recorded; only that St Mark beat Croydon 1-0.',
   '{"winner":"St Mark","loser":"Croydon","score":"1-0"}'::jsonb)
on conflict (id) do nothing;

do $$
declare n int;
begin
  -- champion untouched, runner-up filled
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams c on c.id = e.champion_team_id
                   join public.archive_teams r on r.id = e.runner_up_team_id
                  where e.id = 'cofta-2009'
                    and c.short_name = 'St Mark' and r.short_name = 'Croydon') then
    raise exception 'cofta-2009 must read St Mark champion, Croydon runner-up';
  end if;

  select count(*) into n from public.archive_edition_teams where edition_id = 'cofta-2009';
  if n <> 3 then raise exception 'cofta-2009 expected 3 known participants, found %', n; end if;

  -- Stevenage are an entrant and a semi-finalist, NOT the runner-up
  if exists (select 1 from public.archive_editions e
               join public.archive_teams t on t.id = e.runner_up_team_id
              where e.id = 'cofta-2009' and t.short_name = 'Stevenage') then
    raise exception 'Stevenage must not be recorded as the 2009 runner-up';
  end if;

  select count(*) into n from public.archive_matches where edition_id = 'cofta-2009';
  if n <> 2 then raise exception 'cofta-2009 expected 2 match rows, found %', n; end if;

  -- neither match invented an orientation
  select count(*) into n from public.archive_matches
   where edition_id = 'cofta-2009' and (home_team_id is not null or away_team_id is not null);
  if n <> 0 then raise exception '% cofta-2009 match(es) invented a home/away orientation', n; end if;
end $$;

commit;
