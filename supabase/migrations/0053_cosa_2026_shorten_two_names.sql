-- 0053 — COSA 2026: "Mariam Makkar" becomes "Mariam M", and Myven is just
--        "Myven". Organiser instruction, 25 August 2026.
--
-- Both are women named in a public archive that anyone with the link can read.
-- Shortening an identifier is a privacy decision and the organiser's to make;
-- this migration's job is to make sure it is done COMPLETELY, because a
-- half-done rename is worse than none — it looks removed while the full name
-- is still one query away.
--
-- ── THIS DELIBERATELY OVERWRITES `player_name`, WHICH IS NORMALLY SACRED ──
-- The archive's rule is that `player_name` holds the string exactly as its
-- source printed it and `player_canonical` holds the merged identity — the
-- pair exists precisely so a spelling can be corrected without destroying the
-- record of what was published. Here the point of the change IS to stop
-- holding the surname, and match pages render `player_name`, so preserving it
-- would defeat the instruction entirely and leave the name on screen. Both
-- columns move. Recorded as a deviation rather than done quietly.
--
-- ── THE TWO PLACES A NAIVE RENAME MISSES ─────────────────────────────
-- Updating the player columns alone leaves the surname fully readable:
--
--   1. `archive_matches.notes` for COSA26-G2 carries an
--      `assists_in_goal_order` array with the name inside the jsonb.
--   2. `archive_conflicts` D3 spells it out three times in prose. Conflict
--      flags are organiser-only IN THE UI, but the table is public-read
--      through PostgREST — verified with the publishable key alone — so
--      "only organisers see it" was never true of the data.
--
-- The assertions at the end scan every one of these tables for either
-- surname, so a future column that carries a name cannot silently escape.
--
-- Myven only needs `player_canonical`: the source already printed just
-- "Myven", and it was the archive's own merge that attached the surname.
-- This does not un-merge anything — every row still resolves to one player,
-- because the canonical is still identical across all of them.

begin;

update public.archive_awards
   set player_name      = replace(player_name, 'Mariam Makkar', 'Mariam M'),
       player_canonical = replace(player_canonical, 'Mariam Makkar', 'Mariam M')
 where player_name ilike '%Makkar%' or player_canonical ilike '%Makkar%';

update public.archive_leaderboards
   set player_name      = replace(player_name, 'Mariam Makkar', 'Mariam M'),
       player_canonical = replace(player_canonical, 'Mariam Makkar', 'Mariam M')
 where player_name ilike '%Makkar%' or player_canonical ilike '%Makkar%';

update public.archive_match_events
   set player_name      = replace(player_name, 'Mariam Makkar', 'Mariam M'),
       player_canonical = replace(player_canonical, 'Mariam Makkar', 'Mariam M'),
       assist_player    = replace(assist_player, 'Mariam Makkar', 'Mariam M'),
       assist_canonical = replace(assist_canonical, 'Mariam Makkar', 'Mariam M')
 where player_name ilike '%Makkar%' or player_canonical ilike '%Makkar%'
    or assist_player ilike '%Makkar%' or assist_canonical ilike '%Makkar%';

-- Myven: the source string is already bare, only the merged identity carried
-- the surname.
update public.archive_awards
   set player_canonical = 'Myven' where player_canonical = 'Myven Gaied';
update public.archive_leaderboards
   set player_canonical = 'Myven' where player_canonical = 'Myven Gaied';
update public.archive_match_events
   set player_canonical = case when player_canonical = 'Myven Gaied' then 'Myven' else player_canonical end,
       assist_canonical = case when assist_canonical = 'Myven Gaied' then 'Myven' else assist_canonical end
 where player_canonical = 'Myven Gaied' or assist_canonical = 'Myven Gaied';

-- The name inside a jsonb array, which no column-level rename would reach.
update public.archive_matches
   set notes = replace(notes::text, 'Mariam Makkar', 'Mariam M')::jsonb
 where notes::text ilike '%Makkar%';

-- And the conflict register's prose, which is public-read whatever the UI does.
update public.archive_conflicts
   set detail     = replace(replace(detail, 'Mariam Makkar', 'Mariam M'), 'Makkar', 'Mariam M'),
       resolution = replace(replace(coalesce(resolution,''), 'Mariam Makkar', 'Mariam M'), 'Makkar', 'Mariam M'),
       issue      = replace(replace(issue, 'Mariam Makkar', 'Mariam M'), 'Makkar', 'Mariam M')
 where detail ilike '%Makkar%' or resolution ilike '%Makkar%' or issue ilike '%Makkar%';

do $do$
declare n int;
begin
  -- NOT ONE ROW ANYWHERE STILL CARRIES EITHER SURNAME. This is the assertion
  -- that matters: a rename that misses a column is worse than no rename.
  select
    (select count(*) from public.archive_awards
      where player_name ilike '%Makkar%' or player_canonical ilike '%Makkar%'
         or player_canonical ilike '%Gaied%' or player_name ilike '%Gaied%')
  + (select count(*) from public.archive_leaderboards
      where player_name ilike '%Makkar%' or player_canonical ilike '%Makkar%'
         or player_canonical ilike '%Gaied%' or player_name ilike '%Gaied%')
  + (select count(*) from public.archive_match_events
      where player_name ilike '%Makkar%' or player_canonical ilike '%Makkar%'
         or assist_player ilike '%Makkar%' or assist_canonical ilike '%Makkar%'
         or player_canonical ilike '%Gaied%' or assist_canonical ilike '%Gaied%'
         or note ilike '%Makkar%' or note ilike '%Gaied%')
  + (select count(*) from public.archive_matches
      where notes::text ilike '%Makkar%' or notes::text ilike '%Gaied%'
         or gap_note ilike '%Makkar%' or gap_note ilike '%Gaied%')
  + (select count(*) from public.archive_conflicts
      where issue ilike '%Makkar%' or detail ilike '%Makkar%' or resolution ilike '%Makkar%'
         or issue ilike '%Gaied%' or detail ilike '%Gaied%' or resolution ilike '%Gaied%')
  + (select count(*) from public.archive_editions
      where final_summary ilike '%Makkar%' or notes::text ilike '%Makkar%'
         or final_summary ilike '%Gaied%' or notes::text ilike '%Gaied%')
  into n;
  if n <> 0 then raise exception '% row(s) still carry a removed surname', n; end if;

  -- The shortened names are actually there, and the records still add up.
  select count(*) into n from public.archive_match_events
   where player_canonical = 'Mariam M';
  if n < 1 then raise exception 'Mariam M has no events left; the rename went wrong'; end if;

  select count(*) into n from public.archive_awards
   where edition_id = 'cosa-2026' and player_canonical = 'Mariam M';
  if n < 3 then raise exception 'expected Mariam M to keep her awards, found %', n; end if;

  select count(*) into n from public.archive_awards
   where edition_id = 'cosa-2026' and player_canonical = 'Myven';
  if n < 1 then raise exception 'Myven lost her awards'; end if;

  -- STILL ONE PLAYER EACH. Shortening must not split a record in two: every
  -- row for either woman must share a single canonical.
  select count(distinct player_canonical) into n from public.archive_match_events
   where player_name = 'Myven';
  if n <> 1 then raise exception 'Myven resolves to % identities, expected 1', n; end if;
end
$do$;

commit;
