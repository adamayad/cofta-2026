-- 0026_archive_backfill_2005_2021.sql
--
-- Backfills the deep history of the four men's competitions plus one early
-- women's edition, from Adam's organiser-confirmed roll and four published
-- sources. Adam's word is canonical; published detail fills in around it and
-- is cited on the row.
--
-- 21 new editions:
--   COFTA        2005-2012, 2014-2019, 2021   (15)   no 2013, no 2020
--   Ladies COFTA 2010                          (1)   women
--   COSTA        2022                          (1)
--   CONAFA       2014-2017                     (4)
--
-- Three existing rows are touched, all deliberately and all named in the
-- brief: conafa-2023 (enrichment), ark-cup-2026 and the COSTA series
-- (origins markers). Nothing else from 2022-2026 is altered.
--
-- Every new edition is data_confidence 'minimal'. Where a source is silent
-- the column stays null: no synthesised fixtures, no zero-filled counts, and
-- in particular NO invented scorelines. CONAFA 2016's final is the sharp
-- case - the report says the deciding goal came late but never gives the
-- score, so the score is null and stays null.

begin;

-- ── 1. one new club ────────────────────────────────────────────────────
--
-- The third club carrying St George, and the second carrying the exact
-- church name "St Mary & St George". Nottingham and East London differ ONLY
-- by city. Any future dedupe pass that matches on canonical_name alone will
-- silently merge two real clubs and destroy both records; the assertions at
-- the end of this migration exist to catch that.
--
-- Earlier archive ids were UUIDv5 under a namespace that is no longer
-- recoverable from the repo. New ids use a documented scheme instead:
--   uuidv5(DNS, 'archive_team:' || canonical name with city)
-- computed once and hard-coded here, exactly as 0021 hard-codes its own.
insert into public.archive_teams
  (id, canonical_name, short_name, aliases, merge_status, live_team_id, display, parent_club, city)
values
  ('ad74b633-54db-55a4-819c-ad21c9561862',
   'St Mary & St George', 'East London',
   array['St Mary & St George, East London','St Mary & St George East London','East London']::text[],
   'confirmed', null, null, null, 'East London')
on conflict (id) do nothing;

-- ── 2. the editions ────────────────────────────────────────────────────
insert into public.archive_editions
  (id, competition, year, display_name, category, date_start, date_end, venue,
   format, team_count, match_count, champion_team_id, runner_up_team_id,
   final_summary, data_confidence, source, notes)
values

-- COFTA 2005-2012 ------------------------------------------------------
  ('cofta-2005', 'COFTA', 2005, 'COFTA 2005', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '80c0d7d3-0edc-5643-862f-ed24b3bf1c06', null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"inaugural":true,"edition_note":"The first COFTA tournament.","venue_note":"Adam gives Shephalbury Park, Stevenage as the venue for this era of COFTA. An era-level statement, not a per-edition record.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2006', 'COFTA', 2006, 'COFTA 2006', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '80c0d7d3-0edc-5643-862f-ed24b3bf1c06', null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2007', 'COFTA', 2007, 'COFTA 2007', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   null, null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","edition_note":"The tournament was held; who won it is not recorded.","known_gaps":["Champion unknown - records being sought.","No runner-up, final or scoreline.","No dates, entrant list, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2008', 'COFTA', 2008, 'COFTA 2008', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   null, null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","edition_note":"The tournament was held; who won it is not recorded.","known_gaps":["Champion unknown - records being sought.","No runner-up, final or scoreline.","No dates, entrant list, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2009', 'COFTA', 2009, 'COFTA 2009', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   'cbc82a7a-c720-5126-971e-ed80479934d3', null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2010', 'COFTA', 2010, 'COFTA 2010', 'men', '2010-09-10', '2010-09-12', 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', '561f2ff1-d4d4-577c-bfde-a907d2117d87',
   'Brighton beat Rotherham 3-0 in the final', 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the finalists are known. This is not the entrant list.","final_orientation_note":"Home and away sides of the final are not recorded; the winner, loser and score are.","final":{"home":null,"away":null,"score":"3-0","decided_by":null,"winner":"Brighton","loser":"Rotherham"},"known_gaps":["Final home/away orientation not recorded.","No entrant list beyond the two finalists.","No group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2011', 'COFTA', 2011, 'COFTA 2011', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', '561f2ff1-d4d4-577c-bfde-a907d2117d87',
   'Brighton beat Rotherham in the final', 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the finalists are known. This is not the entrant list.","final":{"home":null,"away":null,"score":null,"decided_by":null,"winner":"Brighton","loser":"Rotherham"},"known_gaps":["No final scoreline.","No dates.","No entrant list beyond the two finalists.","No group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2012', 'COFTA', 2012, 'COFTA 2012', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', '80c0d7d3-0edc-5643-862f-ed24b3bf1c06',
   'Brighton beat Croydon on penalties after extra time', 'minimal',
   'Adam''s COFTA champions roll, organiser-confirmed; further detail from http://copticyouthuk.blogspot.com/2012/10/cofta-coptic-orthodox-football-tries.html',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","edition_note":"St Mark withdrew after day one. Nottingham reached the semi-finals without winning a game. Both details from the Coptic Youth UK blog report, October 2012.","teams_note":"Finalists plus the two clubs named in the blog report. This is not the entrant list.","final":{"home":null,"away":null,"score":null,"decided_by":"penalties","extra_time":true,"shootout":{"home":null,"away":null},"winner":"Brighton","loser":"Croydon"},"known_gaps":["Regulation and extra-time scores not stated; only that the final went to penalties.","Shootout score not recorded.","No dates.","No full entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

-- COFTA 2014-2019, 2021 (no tournament in 2013 or 2020) ----------------
  ('cofta-2014', 'COFTA', 2014, 'COFTA 2014', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '743e2246-6b55-5f58-8d23-35ce49b9e88b', '4b5ef0e2-895c-5466-a254-704f8e08396b',
   'Nottingham beat Brighton 2-1 in the final', 'minimal',
   'Adam''s COFTA champions roll, organiser-confirmed; awards also published in the COFTA 2014 report',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the finalists are known. This is not the entrant list.","final":{"home":null,"away":null,"score":"2-1","decided_by":null,"winner":"Nottingham","loser":"Brighton"},"known_gaps":["Final home/away orientation not recorded.","No dates.","No entrant list beyond the two finalists.","No group stage, standings or match data.","No goalscorers beyond the three award winners."]}'::jsonb),

  ('cofta-2015', 'COFTA', 2015, 'COFTA 2015', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', '561f2ff1-d4d4-577c-bfde-a907d2117d87',
   'Brighton beat Rotherham in the final', 'minimal', 'Adam''s COFTA champions roll and awards, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the finalists are known. This is not the entrant list.","final":{"home":null,"away":null,"score":null,"decided_by":null,"winner":"Brighton","loser":"Rotherham"},"known_gaps":["No final scoreline.","No dates.","No entrant list beyond the two finalists.","No group stage, standings or match data.","Player of the tournament''s club not stated.","Top scorer''s goal count not stated."]}'::jsonb),

  ('cofta-2016', 'COFTA', 2016, 'COFTA 2016', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal', 'Adam''s COFTA champions roll and awards, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates.","No entrant list, group stage, standings or match data.","Top scorer''s goal count not stated."]}'::jsonb),

  ('cofta-2017', 'COFTA', 2017, 'COFTA 2017', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2018', 'COFTA', 2018, 'COFTA 2018', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2019', 'COFTA', 2019, 'COFTA 2019', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', 'f427c65b-cb87-5a3b-81e8-6809e4d8563f',
   'Brighton beat Worthing in the final', 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the finalists are known. This is not the entrant list.","final":{"home":null,"away":null,"score":null,"decided_by":null,"winner":"Brighton","loser":"Worthing"},"known_gaps":["No final scoreline.","No dates.","No entrant list beyond the two finalists.","No group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('cofta-2021', 'COFTA', 2021, 'COFTA 2021', 'men', null, null, 'Shephalbury Park, Stevenage',
   null, null, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal', 'Adam''s COFTA champions roll, organiser-confirmed',
   '{"venue_note":"Era-level statement from Adam, not a per-edition record.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

-- Ladies COFTA 2010 (women) --------------------------------------------
  ('ladies-cofta-2010', 'Ladies COFTA', 2010, 'Ladies COFTA 2010', 'women', null, null, null,
   null, null, null,
   'cbc82a7a-c720-5126-971e-ed80479934d3', '98a9121a-bb83-5462-aebd-41fe0ce8fd67',
   'St Mark beat Golders Green in the final', 'minimal', 'Adam, organiser-confirmed',
   '{"competition_note":"The same Ladies COFTA competition as the archive''s 2025 edition, fifteen years earlier.","teams_note":"Only the finalists are known. This is not the entrant list.","final":{"home":null,"away":null,"score":null,"decided_by":null,"winner":"St Mark","loser":"Golders Green"},"known_gaps":["No final scoreline.","No dates or venue.","No entrant list beyond the two finalists.","No group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

-- COSTA 2022 ------------------------------------------------------------
  ('costa-2022', 'COSTA', 2022, 'COSTA 2022', 'men', null, null, null,
   'Six teams, single round-robin over five rounds of 30-minute matches, 10:00 to 16:00 with a midday lunch break. Champion decided on the league table; no knockout stage.',
   6, 15,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null,
   null, 'minimal',
   'Adam, organiser-confirmed; official timetable posted by ''Coptic FC Brighton'' on Facebook, 29 March 2022 (screenshot held by Adam)',
   '{"edition_note":"A spring tournament, unlike the September COFTA.","team_count_basis":"stated by the timetable","match_count_basis":"arithmetic of a six-team single round-robin, consistent with the timetable''s five rounds","teams_note":"The timetable prints ''Brighton A'' and ''Brighton B''. ''Brighton A'' is St Mary & St Abraam, Brighton. ''Brighton B'' is in fact St Demiana & Pope Kyrillos VI, WORTHING, per Adam - it is not a Brighton second team. This identification is scoped to COSTA 2022 only and is deliberately NOT a global alias, in case a genuine Brighton B appears later. Standing guard: Worthing is not SMPK.","source_labels":{"Brighton A":"St Mary & St Abraam, Brighton","Brighton B":"St Demiana & Pope Kyrillos VI, Worthing"},"known_gaps":["Runner-up unknown.","Exact dates not recorded; the timetable was posted 29 March 2022.","No venue.","The per-fixture timetable text was not supplied to the compiler - only its structure. The fifteen individual fixtures are NOT recorded and have not been invented.","No standings, scores or match data.","No goalscorers, awards or player data."]}'::jsonb),

-- CONAFA 2014-2017 ------------------------------------------------------
  ('conafa-2014', 'CONAFA', 2014, 'CONAFA 2014', 'men', null, null, null,
   null, 9, null,
   'cbc82a7a-c720-5126-971e-ed80479934d3', '743e2246-6b55-5f58-8d23-35ce49b9e88b',
   'St Mark beat Nottingham in the final', 'minimal',
   'https://ukmidcopts.org/news/conafa-2015/ ; organiser-confirmed',
   '{"inaugural":true,"edition_note":"The inaugural CONAFA.","team_count_basis":"stated by the source","teams_note":"Only the finalists are named. Nine teams competed; the other seven are not recorded.","final":{"home":null,"away":null,"score":null,"decided_by":null,"winner":"St Mark","loser":"Nottingham"},"known_gaps":["No final scoreline.","No dates or venue.","Seven of the nine entrants are not named.","No group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('conafa-2015', 'CONAFA', 2015, 'CONAFA 2015', 'men', null, null, null,
   null, 11, null,
   '4b5ef0e2-895c-5466-a254-704f8e08396b', '98a9121a-bb83-5462-aebd-41fe0ce8fd67',
   'Brighton beat Golders Green 1-0 in the final', 'minimal',
   'https://ukmidcopts.org/news/conafa-2015/ ; organiser-confirmed',
   '{"edition_note":"Hosted by Nottingham. A record eleven teams, including debutants from the Republic of Ireland. Brighton entered CONAFA for the first time in 2015, after a four-year unbeaten run ended in September 2014.","host_club":"St Mary & St George, Nottingham","team_count_basis":"stated by the source as a record entry","teams_note":"Finalists, hosts and the named debutants only. Eleven teams competed; the rest are not recorded.","final":{"home":null,"away":null,"score":"1-0","decided_by":null,"winner":"Brighton","loser":"Golders Green"},"known_gaps":["Final home/away orientation not recorded.","No dates or venue.","Seven of the eleven entrants are not named.","No group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb),

  ('conafa-2016', 'CONAFA', 2016, 'CONAFA 2016', 'men', null, null, null,
   null, 11, null,
   '88a5403b-5f3c-5c57-91cf-c2b1b34bd7ce', '4b5ef0e2-895c-5466-a254-704f8e08396b',
   'Manchester beat Brighton in the final; the deciding goal came minutes before the whistle', 'minimal',
   'https://ukmidcopts.org/news/conafa-2016/ ; organiser-confirmed',
   '{"edition_note":"The third CONAFA, hosted by Nottingham. Eleven teams. The Republic of Ireland were unable to attend. St Mary & St George, East London were debutants. The report notes three different winners in as many years, corroborating the 2014, 2015 and 2016 champions.","host_club":"St Mary & St George, Nottingham","team_count_basis":"stated by the source","teams_note":"Only the clubs named in the report: the four semi-finalists and the debutants. Eleven teams competed; the remaining six are not recorded and have not been invented.","final":{"home":null,"away":null,"score":null,"decided_by":null,"winner":"Manchester","loser":"Brighton","note":"The report says the deciding goal came minutes before the final whistle but does NOT state the score. Never assume 1-0."},"semi_finals":[{"winner":"Brighton","loser":"Golders Green","margin":"one goal","score":null},{"winner":"Manchester","loser":"Rotherham","margin":"one goal","score":null}],"group_qualifiers":{"Group A":["Manchester","Golders Green"],"Group B":["Rotherham","Brighton"]},"known_gaps":["Final scoreline NOT stated by the source - only that the deciding goal came late.","Semi-final scores not stated, only that each was won by a single goal.","No dates or venue.","Six of the eleven entrants are not named.","No standings or match data.","No goalscorers, awards or player data.","The full report text was not supplied to the compiler; the cited URL is the record."]}'::jsonb),

  ('conafa-2017', 'CONAFA', 2017, 'CONAFA 2017', 'men', null, null, null,
   null, null, null,
   '88a5403b-5f3c-5c57-91cf-c2b1b34bd7ce', null,
   null, 'minimal',
   'https://manchestercopts.org/ministries/sports/ ; organiser-confirmed',
   '{"edition_note":"The Manchester church''s own site states they won both the 2016 and 2017 tournaments, and first took part in 2015 - corroborating the CONAFA 2016 report.","teams_note":"Only the champion is known. This is not the entrant list.","known_gaps":["No runner-up, final or scoreline.","No dates or venue.","No entrant list, group stage, standings or match data.","No goalscorers, awards or player data."]}'::jsonb);

-- ── 3. entrants ────────────────────────────────────────────────────────
--
-- Only clubs a source actually names. A team_count of 9 or 11 with two names
-- against it is the honest record; inventing seven more to reach the count
-- is not. Joined on short_name so a mistyped uuid cannot silently attach a
-- record to the wrong club.
insert into public.archive_edition_teams (edition_id, team_id)
select v.edition_id, t.id
from (values
  ('cofta-2005', 'Croydon'),
  ('cofta-2006', 'Croydon'),
  ('cofta-2009', 'St Mark'),
  ('cofta-2010', 'Brighton'), ('cofta-2010', 'Rotherham'),
  ('cofta-2011', 'Brighton'), ('cofta-2011', 'Rotherham'),
  ('cofta-2012', 'Brighton'), ('cofta-2012', 'Croydon'),
  ('cofta-2012', 'St Mark'),  ('cofta-2012', 'Nottingham'),
  ('cofta-2014', 'Nottingham'), ('cofta-2014', 'Brighton'),
  ('cofta-2015', 'Brighton'), ('cofta-2015', 'Rotherham'),
  ('cofta-2016', 'Brighton'),
  ('cofta-2017', 'Brighton'),
  ('cofta-2018', 'Brighton'),
  ('cofta-2019', 'Brighton'), ('cofta-2019', 'Worthing'),
  ('cofta-2021', 'Brighton'),
  ('ladies-cofta-2010', 'St Mark'), ('ladies-cofta-2010', 'Golders Green'),
  ('costa-2022', 'Golders Green'), ('costa-2022', 'Brighton'),
  ('costa-2022', 'Worthing'),      ('costa-2022', 'St Mark'),
  ('costa-2022', 'Croydon'),       ('costa-2022', 'Rotherham'),
  ('conafa-2014', 'St Mark'), ('conafa-2014', 'Nottingham'),
  ('conafa-2015', 'Brighton'), ('conafa-2015', 'Golders Green'),
  ('conafa-2015', 'Nottingham'), ('conafa-2015', 'Ireland'),
  ('conafa-2016', 'Manchester'), ('conafa-2016', 'Brighton'),
  ('conafa-2016', 'Golders Green'), ('conafa-2016', 'Rotherham'),
  ('conafa-2016', 'East London'),
  ('conafa-2017', 'Manchester')
) as v(edition_id, short)
join public.archive_teams t
  on t.short_name = v.short and t.parent_club is null
on conflict do nothing;

-- ── 4. awards ──────────────────────────────────────────────────────────
--
-- 'most_clean_sheets' is the archive's existing type for what the club calls
-- the golden glove; the client already maps it onto that trophy.
--
-- Chilaka/Chilaki: Adam's spelling is canonical and goes in player_canonical.
-- The published report's spelling is kept in player_name, because that column
-- exists to hold the string as its source printed it.
insert into public.archive_awards
  (edition_id, match_id, award_type, player_name, player_canonical, team_id, value, is_published_summary, flag)
values
  ('cofta-2014', null, 'top_scorer', 'Nduoma Chilaki', 'Nduoma Chilaka',
   '743e2246-6b55-5f58-8d23-35ce49b9e88b', 5, true, null),
  ('cofta-2014', null, 'player_of_the_tournament', 'Ashley Brown', 'Ashley Brown',
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null, true, null),
  ('cofta-2014', null, 'most_clean_sheets', 'Mark Khalil', 'Mark Khalil',
   '743e2246-6b55-5f58-8d23-35ce49b9e88b', null, true, null),
  ('cofta-2015', null, 'top_scorer', 'Amir Morcos', 'Amir Morcos',
   '743e2246-6b55-5f58-8d23-35ce49b9e88b', null, false, null),
  -- Club deliberately null: Adam did not state one. An Amir Ameen appears as
  -- a Rotherham player in the 2014 report, which is a lead and not an
  -- identification, so it is flagged rather than applied.
  ('cofta-2015', null, 'player_of_the_tournament', 'Amir Ameen', 'Amir Ameen',
   null, null, false, 'club_not_stated'),
  ('cofta-2016', null, 'top_scorer', 'Mina Muharib', 'Mina Muharib',
   '4b5ef0e2-895c-5466-a254-704f8e08396b', null, false, null);

-- ── 5. CONAFA 2023: enrichment, not correction ─────────────────────────
--
-- Adam states the final finished 1-1 and was decided 3-1 on penalties. The
-- archive held no score at all - null, not a different number - so there is
-- nothing to contradict and no conflict-register entry is warranted. The
-- edition has no archive_matches rows, so there is no match row to correct
-- either; the figures live on the edition, as they do for cofta-2023.
update public.archive_editions
   set final_summary = 'Brighton 1-1 SMPK (Brighton won 3-1 on penalties)',
       notes = notes
             || jsonb_build_object(
                  'final', jsonb_build_object(
                    'home', null, 'away', null,
                    'home_score', 1, 'away_score', 1,
                    'decided_by', 'penalties',
                    'shootout', jsonb_build_object('winner_score', 3, 'loser_score', 1),
                    'winner', 'Brighton', 'loser', 'SMPK'),
                  'final_orientation_note',
                  'Home and away sides of the final are not recorded; 1-1 and the 3-1 shootout are. Added 2026-08-21 from Adam, organiser-confirmed, where the archive previously held nulls.')
             || jsonb_build_object('known_gaps',
                  (notes->'known_gaps')
                  - 'No regulation scoreline for the final.'
                  - 'No penalty shootout score.')
 where id = 'conafa-2023';

-- ── 6. competition origins ─────────────────────────────────────────────
--
-- Two opposite facts, and the second is the one that matters. The Ark Cup
-- 2026 IS the first Ark Cup and may say so. COSTA's beginning is simply not
-- known, so no view may present its earliest archived edition as inaugural -
-- costa-2022 is the earliest the archive holds, which is not the same thing
-- as the first that was played.
update public.archive_editions
   set notes = notes || '{"inaugural":true,"edition_note":"The first Ark Cup."}'::jsonb
 where id = 'ark-cup-2026';

update public.archive_editions
   set notes = notes || '{"origins_unrecorded":"COSTA''s founding year is unknown. The earliest edition the archive holds is not known to be the first."}'::jsonb
 where competition = 'COSTA';

-- ── 7. assertions ──────────────────────────────────────────────────────
--
-- The migration fails rather than half-importing. The St George check is the
-- point of the exercise: three clubs, two of them sharing a church name
-- exactly, must survive as three rows.
do $$
declare
  n int;
begin
  select count(*) into n from public.archive_editions;
  if n <> 34 then
    raise exception 'expected 34 editions after import, found %', n;
  end if;

  select count(*) into n from public.archive_editions where competition = 'COFTA';
  if n <> 19 then
    raise exception 'expected 19 COFTA editions (2005-2012, 2014-2019, 2021-2025), found %', n;
  end if;

  if exists (select 1 from public.archive_editions where competition='COFTA' and year in (2013, 2020)) then
    raise exception 'COFTA 2013 and 2020 must not exist: no tournament was held';
  end if;

  -- the three St George clubs, separate rows, never merged
  select count(*) into n from public.archive_teams
   where (canonical_name = 'St George' and city = 'Stevenage')
      or (canonical_name = 'St Mary & St George' and city = 'Nottingham')
      or (canonical_name = 'St Mary & St George' and city = 'East London');
  if n <> 3 then
    raise exception 'the three St George clubs must exist as separate rows, found %', n;
  end if;

  -- the two Pope Kyrillos clubs, likewise
  select count(*) into n from public.archive_teams
   where canonical_name in ('St Mary & Pope Kyrillos VI', 'St Demiana & Pope Kyrillos VI')
     and parent_club is null;
  if n <> 2 then
    raise exception 'SMPK and Worthing must exist as separate rows, found %', n;
  end if;

  -- no global Brighton B alias may have leaked onto Worthing
  if exists (select 1 from public.archive_teams
              where 'Brighton B' = any(aliases)) then
    raise exception 'Brighton B must not become a global alias; it is scoped to costa-2022';
  end if;

  -- the two unknown champions stay unknown
  select count(*) into n from public.archive_editions
   where competition = 'COFTA' and champion_team_id is null;
  if n <> 2 then
    raise exception 'exactly COFTA 2007 and 2008 should have no champion, found % such rows', n;
  end if;

  -- the checked rows
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams t on t.id = e.runner_up_team_id
                  where e.id = 'cofta-2024' and t.canonical_name = 'St George' and t.city = 'Stevenage') then
    raise exception 'cofta-2024 runner-up must be St George, Stevenage';
  end if;

  if not exists (select 1 from public.archive_editions
                  where id = 'conafa-2023'
                    and (notes->'final'->>'home_score') = '1'
                    and (notes->'final'->'shootout'->>'winner_score') = '3') then
    raise exception 'conafa-2023 final must read 1-1 with a 3-1 shootout';
  end if;

  -- ladies-cofta-2010 is women's and must never be men's
  if not exists (select 1 from public.archive_editions
                  where id = 'ladies-cofta-2010' and category = 'women') then
    raise exception 'ladies-cofta-2010 must be category women';
  end if;
end $$;

commit;
