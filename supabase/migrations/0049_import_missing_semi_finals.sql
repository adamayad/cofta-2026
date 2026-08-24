-- 0049 — import the six semi-finals that exist in tournament_archive.json but
--        never reached the database.
--
-- Found 2026-08-24 while resolving Q13. The JSON is the archive's source of
-- truth and the database is supposed to follow it; for three editions it did
-- not. Counted against `stage = 'semi_final'`:
--
--     cofta-2009    1 in the JSON   1 in the database   ok
--     cofta-2010    2               0
--     cofta-2014    2               0
--     conafa-2016   2               0
--
-- `0038`–`0040` wrote the narrative for these years and put the semi-final
-- detail into PROSE — 0040 records "Brighton opened through Mina Muharib"
-- inside a note and creates no row — so the rounds were described but never
-- stored.
--
-- ── READ THIS BEFORE EXPECTING TO SEE ANYTHING ───────────────────────
-- ALL THREE EDITIONS ARE `data_confidence = 'minimal'`, so the client renders
-- them through `thinEdition()`, which shows champion, runner-up, entrants,
-- awards and notes and NEVER LOOKS AT MATCHES. These six rows are therefore
-- invisible on the site the moment they land, exactly like the 14 match rows
-- and 3 event rows already sitting in minimal editions — cofta-2014 alone has
-- eleven matches nobody can see.
--
-- That is not a reason to skip the import: the database should agree with the
-- source whether or not a renderer currently reads it, and any future decision
-- to show matches on thin editions needs these rows to exist first. It IS a
-- reason not to claim this migration fixes anything a reader can see. It does
-- not. The renderer is a separate, deliberate decision.
--
-- ── WHAT IS NOT INVENTED ─────────────────────────────────────────────
-- Every one of these six is missing something, and the missing parts stay
-- missing:
--   * No home/away for any of them. The sources give a winner and a loser, not
--     an orientation, so `home_team_id`/`away_team_id` stay NULL and the result
--     lives in `notes`, exactly as COFTA 2009's semi-final already does.
--   * `COFTA10-SF2` has NO NAMED OPPONENT. Croydon is probable by elimination
--     and is recorded in the gap note as probable — never as a team id.
--   * Both CONAFA 2016 semis are reported only as "won by one goal". A margin
--     is not a score; neither may ever render as 1-0.
--   * Two were decided on penalties with the shoot-out score unrecorded.
--     `decided_by` says penalties, `shootout_home`/`shootout_away` stay NULL.
--   * No goal events are created. COFTA 2014's Mina Muharib goal stays prose
--     on purpose: an event row would change that edition's goal counts, which
--     is what C18 exists to prevent, and the identity ruling that surfaced all
--     this was about who he is, not about what he scored.
--
-- Team ids are resolved through `archive_edition_teams` rather than written in,
-- both because generated ids do not belong in a migration and because it scopes
-- each name to its own edition — "St Mark" and "Manchester" are exactly the
-- kind of strings that collide across the registry.

begin;

with t as (
  select et.edition_id, at.short_name, at.id
    from public.archive_edition_teams et
    join public.archive_teams at on at.id = et.team_id
   where et.edition_id in ('cofta-2010','cofta-2014','conafa-2016')
),
rows_to_add(id, edition_id, label, decided_by, so_winner_name, events_status,
            gap_note, notes) as (values

  ('COFTA10-SF1', 'cofta-2010', 'Semi-final', 'penalties', 'Brighton', 'partial',
   'Home and away are not recorded. Level after normal time and won by Brighton on penalties; neither the normal-time score nor the shoot-out score is recorded.',
   '{"winner":"Brighton","loser":"St Mark"}'::jsonb),

  ('COFTA10-SF2', 'cofta-2010', 'Semi-final', null, null, 'partial',
   'Home and away are not recorded, and the report does not name Rotherham''s opponent. Rotherham came back from a goal down to win. Croydon is probable by elimination but is deliberately not recorded as data.',
   '{"winner":"Rotherham"}'::jsonb),

  ('COFTA14-SF1', 'cofta-2014', 'Semi-final', null, null, 'partial',
   'Home and away are not recorded, and the report gives no scoreline that can be read with confidence. A repeat of the 2012 final. Brighton opened through Mina Muharib, his fourth goal of the tournament, and scored a second on the break.',
   '{"winner":"Brighton","loser":"Croydon"}'::jsonb),

  ('COFTA14-SF2', 'cofta-2014', 'Semi-final', 'penalties', 'Nottingham', 'partial',
   'Home and away are not recorded. Golders Green led 2-0; Nottingham levelled to force penalties and won the shoot-out. The shoot-out score is not recorded.',
   '{"winner":"Nottingham","loser":"Golders Green","score":"2-2"}'::jsonb),

  ('CONAFA16-SF1', 'conafa-2016', 'Semi-final', null, null, 'partial',
   'Home and away are not recorded. The report gives the margin as one goal and does not state the score, which must never be rendered as 1-0.',
   '{"winner":"Brighton","loser":"Golders Green","margin":"one goal"}'::jsonb),

  ('CONAFA16-SF2', 'conafa-2016', 'Semi-final', null, null, 'partial',
   'Home and away are not recorded. The report gives the margin as one goal and does not state the score, which must never be rendered as 1-0.',
   '{"winner":"Manchester","loser":"Rotherham","margin":"one goal"}'::jsonb)
)
insert into public.archive_matches
  (id, edition_id, stage, label, home_team_id, away_team_id,
   home_score, away_score, decided_by, shootout_home, shootout_away,
   shootout_winner_id, events_status, gap_note, notes)
select r.id, r.edition_id, 'semi_final', r.label,
       null, null,          -- orientation unknown, and it stays unknown
       null, null,          -- no scoreline may be inferred from a winner
       r.decided_by,
       null, null,          -- shoot-out scores are not recorded for either
       w.id,
       r.events_status, r.gap_note, r.notes
  from rows_to_add r
  left join t w on w.edition_id = r.edition_id and w.short_name = r.so_winner_name
 where not exists (select 1 from public.archive_matches m where m.id = r.id);

-- A NAMED DOLLAR TAG, AND NO `for ... loop`. Both matter, and this cost two
-- rejected attempts: the Supabase connector's statement splitter swallowed the
-- block's terminator when it contained `end loop;`, and reported it as
-- "syntax error at end of input" with the body truncated at a bare `end`.
-- Straight-line checks under `$do$` apply cleanly. Nothing about the
-- assertions themselves changed - only the shape they are written in.
do $do$
declare n int;
begin
  -- six new rows, and the four editions now agree with the JSON
  select count(*) into n from public.archive_matches
   where id in ('COFTA10-SF1','COFTA10-SF2','COFTA14-SF1','COFTA14-SF2',
                'CONAFA16-SF1','CONAFA16-SF2');
  if n <> 6 then raise exception 'expected 6 new semi-final rows, found %', n; end if;

  select count(*) into n from public.archive_matches
   where stage = 'semi_final'
     and edition_id in ('cofta-2009','cofta-2010','cofta-2014','conafa-2016');
  if n <> 7 then raise exception 'expected 7 semi-finals across the four editions, found %', n; end if;

  -- NOTHING WAS INVENTED. No orientation, no scoreline, no shoot-out score.
  select count(*) into n from public.archive_matches
   where stage = 'semi_final' and edition_id in ('cofta-2010','cofta-2014','conafa-2016')
     and (home_team_id is not null or away_team_id is not null
          or home_score is not null or away_score is not null
          or shootout_home is not null or shootout_away is not null);
  if n <> 0 then raise exception '% row(s) invented a team, score or shoot-out', n; end if;

  -- The two penalty wins carry their winner; the other four claim no shoot-out.
  select count(*) into n from public.archive_matches
   where id in ('COFTA10-SF1','COFTA14-SF2')
     and decided_by = 'penalties' and shootout_winner_id is not null;
  if n <> 2 then raise exception 'the two shoot-out winners did not resolve'; end if;

  select count(*) into n from public.archive_matches
   where id in ('COFTA10-SF2','COFTA14-SF1','CONAFA16-SF1','CONAFA16-SF2')
     and (decided_by is not null or shootout_winner_id is not null);
  if n <> 0 then raise exception '% row(s) claimed a shoot-out they do not have', n; end if;

  -- COFTA 2010's unnamed opponent stays unnamed, and Croydon is nowhere in it.
  select count(*) into n from public.archive_matches
   where id = 'COFTA10-SF2'
     and (notes ->> 'loser' is not null or notes::text ilike '%croydon%');
  if n <> 0 then raise exception 'COFTA10-SF2 must not name an opponent the report does not'; end if;

  -- A margin is not a score: neither CONAFA row may carry one.
  select count(*) into n from public.archive_matches
   where id in ('CONAFA16-SF1','CONAFA16-SF2') and notes ->> 'score' is not null;
  if n <> 0 then raise exception 'a one-goal margin must never be stored as a score'; end if;

  -- AND NO GOAL EVENTS WERE CREATED. C18: 2014's tallies are untouched.
  select count(*) into n from public.archive_match_events
   where match_id in ('COFTA10-SF1','COFTA10-SF2','COFTA14-SF1','COFTA14-SF2',
                      'CONAFA16-SF1','CONAFA16-SF2');
  if n <> 0 then raise exception '% event(s) were created; this migration adds none', n; end if;

  select count(*) into n from public.archive_awards
   where edition_id = 'cofta-2014' and award_type = 'top_scorer'
     and player_canonical = 'Nduoma Chilaka' and value = 5;
  if n <> 1 then raise exception 'Nduoma Chilaka must still be recorded with 5 goals'; end if;
end
$do$;

commit;
