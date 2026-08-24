-- 0040 — COFTA 2014: both group tables, both semi-finals, and the own goal.
--
-- Source: the COFTA 2014 official report, organiser-supplied full text.
--
-- THE OWN GOAL IS THE POINT OF THIS MIGRATION. The final's free-kick — the
-- goal that reads like Nduoma Chilaka's — is explicitly described as going in
-- off the goalkeeper's heel and being AWARDED AS AN OWN GOAL. It is stored as
-- an own_goal event, conceded by Brighton, with no player, and it is not one
-- of Chilaka's five.
--
-- AND THE FIVE IS NOT RECOMPUTED. The report attributes only two of his goals
-- in so many words (the pair of headers in the 2-2 with Croydon) and there is
-- no goal-by-goal record for 2014, so whether the 5 ever included that own
-- goal CANNOT be determined from what survives. The organiser-confirmed figure
-- therefore stands untouched. What C18 exists to prevent is the two failure
-- modes on either side of that: someone reading the own goal as a sixth
-- Chilaka goal, or quietly reducing the 5 to 4 to make the arithmetic close.
-- Neither is supported by anything.
--
-- MINA MUHARIB IS FLAGGED, NOT RESOLVED. He opens the semi-final for Brighton,
-- his fourth of the tournament. Brighton's CONAFA 2016 top scorer is also a
-- Mina Muharib. Same club, same name, two years apart — which is exactly the
-- evidence this archive has always refused to merge on. Q13, held.
--
-- AMIR AMEEN'S HAT-TRICK has no fixture: the report gives neither opponent nor
-- score for the Rotherham win it came in. Recorded with match_id NULL rather
-- than hung on an invented fixture.
--
-- GROUP B ORIENTATIONS are the report's order of mention, not a stated fixture
-- list, and the row says so. Group A is complete bar one dead rubber whose
-- result the report does not give.

begin;

update public.archive_editions
   set
       format = 'Two groups of three, semi-finals, final',
       team_count = 6,
       source = 'COFTA 2014 official report (organiser-supplied full text); Adam''s COFTA champions roll, organiser-confirmed',
       notes = notes || jsonb_build_object(
         'groups', jsonb_build_object(
            'Group A', jsonb_build_array('Golders Green','Stevenage','Brighton'),
            'Group B', jsonb_build_array('Croydon','Nottingham','Rotherham'),
            'qualified', jsonb_build_object(
               'Group A', jsonb_build_array('Brighton','Golders Green'),
               'Group B', jsonb_build_array('Croydon','Nottingham'))),
         'semi_finals', jsonb_build_array(
            jsonb_build_object('winner','Brighton','loser','Croydon','score',null,
              'note','A repeat of the 2012 final. Brighton opened through Mina Muharib, his fourth goal of the tournament, and scored a second on the break. The report does not give a scoreline that can be read with confidence, so no score is stored.'),
            jsonb_build_object('winner','Nottingham','loser','Golders Green','score','2-2',
              'decided_by','penalties',
              'note','Golders Green led 2-0; Nottingham levelled to force penalties and won the shoot-out. The shoot-out score is not recorded.')),
         'final_note', 'One of Nottingham''s two goals was a free-kick that went in off the goalkeeper''s heel and was AWARDED AS AN OWN GOAL. It is not one of Nduoma Chilaka''s. Nottingham''s other scorer and Brighton''s scorer are not named.',
         'matches_note', 'Group A is recorded in full bar one dead rubber. Group B is recorded only as far as the report describes it, and its home/away orientations are the report''s order of mention, not a stated fixture list.',
         'edition_note', 'The tenth annual COFTA. Nottingham won it, coming through a shoot-out in the semi-final and beating Brighton 2-1 in the final.',
         'narrative', 'David Morgan of Brighton and Mark Khalil, Nottingham''s captain and golden glove, were both singled out. Golders Green were coached by Hani Mohib. Nottingham''s captain Mikael pledged more training for the year ahead.',
         'corroborations', jsonb_build_array(
            'The report calls this the tenth annual tournament, independently corroborating the existing count. A second source for the same fact; no new conflict entry is warranted.',
            'The report states there was no tournament in 2013, corroborating the confirmed gap year.'),
         'known_gaps', jsonb_build_array(
           'Final home/away orientation not recorded, and neither of the two named goals in it has a scorer.',
           'The semi-final against Croydon has no usable scoreline.',
           'The semi-final shoot-out score is not recorded.',
           'One Group A dead rubber has no result, and Group B''s scores are largely absent.',
           'Amir Ameen''s hat-trick cannot be attached to a fixture.',
           'No dates.'))
 where id = 'cofta-2014';

insert into public.archive_matches
  (id, edition_id, stage, group_name, round, label, home_team_id, away_team_id,
   home_score, away_score, events_status, gap_note, notes)
select v.id, 'cofta-2014', 'group', v.grp, null, v.grp,
       h.id, a.id, v.hs, v.as_, v.status, v.gap, v.notes
  from (values
    ('COFTA14-A-01','Group A','Golders Green','Brighton',   0,    0,    'score_only', null, '{}'::jsonb),
    ('COFTA14-A-02','Group A','Golders Green','Stevenage',  1,    0,    'score_only', null,
      '{"dispute_note":"Stevenage disputed that the goal crossed the line. The result stands as recorded."}'::jsonb),
    ('COFTA14-A-03','Group A','Brighton','Stevenage',       1,    0,    'score_only', null,
      '{"dispute_note":"A penalty, which Stevenage disputed as no handball. The result stands as recorded."}'::jsonb),
    ('COFTA14-A-04','Group A','Brighton','Golders Green',   1,    0,    'score_only', null, '{}'::jsonb),
    ('COFTA14-A-05','Group A','Golders Green','Stevenage',  2,    0,    'score_only', null, '{}'::jsonb),
    ('COFTA14-A-06','Group A','Brighton','Stevenage',       null, null, 'partial',
      'The final Group A game, a dead rubber. The report does not give the result.', '{}'::jsonb),
    ('COFTA14-B-01','Group B','Nottingham','Croydon',       2,    2,    'score_only', null,
      '{"note":"Nottingham came back from 2-0 down. Both of their goals were headers by Nduoma Chilaka."}'::jsonb),
    ('COFTA14-B-02','Group B','Croydon','Nottingham',       null, null, 'partial',
      'Croydon won. No score recorded.', '{}'::jsonb),
    ('COFTA14-B-03','Group B','Nottingham','Rotherham',     null, null, 'partial',
      'Nottingham won. No score recorded.', '{}'::jsonb),
    ('COFTA14-B-04','Group B','Croydon','Rotherham',        1,    1,    'score_only', null,
      '{"note":"The decisive Group B match. Rotherham led first, scorer not named; Anthony equalised for Croydon very late, minute not recorded."}'::jsonb)
  ) as v(id, grp, home, away, hs, as_, status, gap, notes)
  join public.archive_teams h on h.short_name = v.home and h.parent_club is null
  join public.archive_teams a on a.short_name = v.away and a.parent_club is null
on conflict (id) do nothing;

-- Chilaka's two headers: two distinct events, as the report describes them.
insert into public.archive_match_events
  (match_id, seq, minute, team_id, player_name, player_canonical, event_type, event_source, flag, note)
select 'COFTA14-B-01', s.seq, null, t.id, 'Nduoma Chilaki', 'Nduoma Chilaka', 'goal',
       'COFTA 2014 official report', null, 'Header.'
  from generate_series(1,2) as s(seq)
  join public.archive_teams t on t.short_name = 'Nottingham' and t.parent_club is null;

-- The own goal. Conceded by Brighton, credited to Nottingham, no player.
insert into public.archive_match_events
  (match_id, seq, minute, team_id, player_name, player_canonical, event_type, event_source, flag, note)
select 'COFTA14-FINAL', 1, null, t.id, null, null, 'own_goal',
       'COFTA 2014 official report', 'own_goal_no_player',
       'A free-kick that went in off the goalkeeper''s heel and was awarded as an own goal. Explicitly NOT one of Nduoma Chilaka''s goals.'
  from public.archive_teams t where t.short_name = 'Brighton' and t.parent_club is null;

-- The final itself, so the own goal has somewhere to hang.
insert into public.archive_matches
  (id, edition_id, stage, label, home_team_id, away_team_id, home_score, away_score,
   events_status, gap_note, notes)
select 'COFTA14-FINAL', 'cofta-2014', 'final', 'Final', null, null, null, null, 'partial',
       'Home and away are not recorded; only that Nottingham beat Brighton 2-1.',
       '{"winner":"Nottingham","loser":"Brighton","score":"2-1"}'::jsonb
on conflict (id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.archive_matches where edition_id = 'cofta-2014';
  if n <> 11 then raise exception 'cofta-2014 expected 11 match rows, found %', n; end if;

  -- CHILAKA'S TALLY IS UNCHANGED. This is the assertion C18 exists for.
  if not exists (select 1 from public.archive_awards
                  where edition_id = 'cofta-2014' and award_type = 'top_scorer'
                    and player_canonical = 'Nduoma Chilaka' and value = 5) then
    raise exception 'Nduoma Chilaka must still be recorded with 5 goals';
  end if;

  -- the own goal exists, is an own_goal, and carries no player
  select count(*) into n from public.archive_match_events
   where match_id = 'COFTA14-FINAL' and event_type = 'own_goal'
     and player_name is null and player_canonical is null;
  if n <> 1 then raise exception 'expected exactly 1 unattributed own goal in the final, found %', n; end if;

  -- and it was NOT credited to Chilaka by any route
  if exists (select 1 from public.archive_match_events
              where match_id = 'COFTA14-FINAL' and player_canonical = 'Nduoma Chilaka') then
    raise exception 'the final''s own goal must never be attributed to Chilaka';
  end if;

  -- his two headers are two events, not one
  select count(*) into n from public.archive_match_events
   where match_id = 'COFTA14-B-01' and player_canonical = 'Nduoma Chilaka' and event_type = 'goal';
  if n <> 2 then raise exception 'expected 2 Chilaka goals in COFTA14-B-01, found %', n; end if;

  -- the dead rubber and the two unscored Group B games kept their nulls
  select count(*) into n from public.archive_matches
   where edition_id = 'cofta-2014' and home_score is null and events_status = 'partial';
  if n <> 3 then raise exception 'expected 3 result-less rows, found %', n; end if;

  -- the final result on the edition row is untouched
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams c on c.id = e.champion_team_id
                   join public.archive_teams r on r.id = e.runner_up_team_id
                  where e.id = 'cofta-2014'
                    and c.short_name = 'Nottingham' and r.short_name = 'Brighton'
                    and e.final_summary ilike '%2-1%') then
    raise exception 'cofta-2014 final must still read Nottingham 2-1 Brighton';
  end if;

  -- the other two awards are untouched
  select count(*) into n from public.archive_awards where edition_id = 'cofta-2014';
  if n <> 3 then raise exception 'cofta-2014 must still have exactly 3 awards, found %', n; end if;
end $$;

commit;
