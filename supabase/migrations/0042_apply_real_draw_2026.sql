-- 0042 — THE REAL DRAW. Seven teams, uneven groups, 12 September 2026.
--
-- This replaces the rehearsal fixture list entirely and is the migration the
-- weekend actually runs on. LIVE tables only: nothing here touches archive_*.
--
-- NOTE ON THE TEMPLATE. CLAUDE.md has referred to
-- `supabase/migrations/DRAFT_apply_real_draw.sql` since the archive work
-- began. THAT FILE HAS NEVER EXISTED — not in the tree, not in any commit,
-- not in any deleted path in history. It was documented and never written.
-- This file is built fresh against the schema as it stands today, and the
-- CLAUDE.md line that promised the template is corrected in the same commit.
--
-- ── THE FORMAT IS NOT THE USUAL ONE ──────────────────────────────────
-- Seven teams, not eight, and the groups are uneven:
--
--   Group A — gg, ste, km, smpk   four teams, SINGLE round-robin, 3 games each
--   Group B — bri, cro, rot       three teams, DOUBLE round-robin, 4 games each
--
-- Both groups therefore play exactly 6 matches, 12 in all, and the top two of
-- each go through. Group B's clubs meet each other twice: bri-cro, cro-rot and
-- bri-rot all appear at 10:30/11:30/12:30 and again at 14:00/15:00/16:00.
-- THIS IS CONFIRMED CORRECT BY THE ORGANISER and is not a transcription slip.
--
-- The standings code needs no change for this and that was verified rather
-- than assumed:
--   * `tallyInto` counts whatever matches exist per club. Nothing anywhere
--     divides by a fixed number of games or assumes equal group sizes.
--   * `groupComplete` is "every match with this stage is finished", not a
--     count, so a 6-match three-club group completes correctly.
--   * `headToHead` filters to matches BETWEEN the tied clubs, so in a double
--     round-robin it naturally weighs both meetings.
--   * `unresolvedPairs` walks rows 1-2 and 2-3, which is right for a group of
--     three as well as one of four.
--   * The one degenerate case is all three of Group B level on points: the
--     head-to-head mini-league is then the whole group, so it can separate
--     nobody, and the code falls through to overall GD, then goals, then
--     flags `unresolved` for a shoot-out. Correct, and no crash.
--
-- ST MARK ARE NOT ENTERED THIS YEAR. `stm` keeps its row, its crest and its
-- colours for future tournaments, and gets `group_letter = null` and no
-- fixtures. Two UI fixes ship alongside this migration, because a club with no
-- group read as "Eliminated - group stage" on its own page and as a blank
-- letter above the word "Group" in the clubs list. Neither is true of a club
-- that simply did not enter.
--
-- ── WHAT THIS DELETES ────────────────────────────────────────────────
-- All rehearsal data: 15 fixtures, 5 of them played, 7 goal events, and the
-- 116 dummy squad players. The placeholder managers go too - "Nabil Attia" is
-- not Brighton's manager and a spectator has no way to know that. Real squads
-- and real managers are pasted in afterwards through Organiser -> Squads.
--
-- `where true` on every bulk statement: Supabase preloads `safeupdate` on API
-- connections and refuses an unqualified DELETE or UPDATE.
--
-- ── WHAT THIS CANNOT STORE ───────────────────────────────────────────
-- Vespers (Sat 17:30) and Liturgy (Sun 09:30), both at St George Cathedral,
-- are non-match events and there is NO table for them. They are deliberately
-- NOT inserted as matches - a fixture row for Vespers would appear on the
-- Fixtures tab with two empty team slots and a kick-off time. Putting them in
-- front of players needs a small schema and UI addition; raised, not faked.

begin;

-- ── 1. clear the rehearsal tournament ────────────────────────────────
delete from public.match_events where true;      -- explicit, though matches cascade
delete from public.matches      where true;
delete from public.tie_shootouts where true;
delete from public.slot_overrides where true;
delete from public.trophy_awards where true;

-- The dummy squads stop being visible. The rows stay so nothing referencing a
-- player breaks; `active = false` is how this app retires a squad.
update public.players set active = false where true;

-- Placeholder managers, cleared rather than left to look authoritative.
update public.teams set manager = null where true;

-- ── 2. the groups ────────────────────────────────────────────────────
update public.teams set group_letter = 'A' where id in ('gg','ste','km','smpk');
update public.teams set group_letter = 'B' where id in ('bri','cro','rot');
update public.teams set group_letter = null where id = 'stm';

-- ── 3. Saturday 12 September, group stage ────────────────────────────
-- Group A on Pitch One, Group B on Pitch Two, which is the convention the
-- rehearsal list already used. Two pitches, as confirmed.
-- Lunch 13:15-14:00 is the gap between the 12:30 and 14:00 kick-offs; it needs
-- no row because nothing is played in it.
insert into public.matches (stage, day, kickoff, pitch, home_team, away_team) values
  -- Group A: four clubs, each pair once
  ('A', 1, '10:30', 'Pitch One', 'gg',  'ste'),
  ('A', 1, '11:30', 'Pitch One', 'km',  'smpk'),
  ('A', 1, '12:30', 'Pitch One', 'gg',  'km'),
  ('A', 1, '14:00', 'Pitch One', 'ste', 'smpk'),
  ('A', 1, '15:00', 'Pitch One', 'gg',  'smpk'),
  ('A', 1, '16:00', 'Pitch One', 'ste', 'km'),
  -- Group B: three clubs, each pair TWICE
  ('B', 1, '10:30', 'Pitch Two', 'bri', 'cro'),
  ('B', 1, '11:30', 'Pitch Two', 'cro', 'rot'),
  ('B', 1, '12:30', 'Pitch Two', 'bri', 'rot'),
  ('B', 1, '14:00', 'Pitch Two', 'bri', 'cro'),
  ('B', 1, '15:00', 'Pitch Two', 'cro', 'rot'),
  ('B', 1, '16:00', 'Pitch Two', 'bri', 'rot');

-- ── 4. Sunday 13 September, knockouts ────────────────────────────────
-- Seeded with NULL teams on purpose. The clubs are resolved from the tables by
-- `resolveSlots` for display, and PINNED into the row at kick-off by
-- set_clock('start', …, p_home, p_away). Writing names in now would freeze a
-- guess about a group that has not been played.
--
-- The pairing `resolveSlots` already implements matches the draw exactly:
--   SF1 = winner A v runner-up B      SF2 = winner B v runner-up A
insert into public.matches (stage, day, kickoff, pitch, home_team, away_team) values
  ('SF1',   2, '14:00', 'Pitch One', null, null),
  ('SF2',   2, '15:00', 'Pitch One', null, null),
  ('FINAL', 2, '16:00', 'Pitch One', null, null);

-- ── 5. assertions ────────────────────────────────────────────────────
do $$
declare n int; r record;
begin
  -- shape
  select count(*) into n from public.matches;
  if n <> 15 then raise exception 'expected 15 matches, found %', n; end if;
  select count(*) into n from public.matches where stage in ('A','B');
  if n <> 12 then raise exception 'expected 12 group matches, found %', n; end if;
  select count(*) into n from public.matches where stage = 'A';
  if n <> 6 then raise exception 'Group A must have 6 matches, found %', n; end if;
  select count(*) into n from public.matches where stage = 'B';
  if n <> 6 then raise exception 'Group B must have 6 matches, found %', n; end if;

  -- seven teams in groups, St Mark in neither
  select count(*) into n from public.teams where group_letter = 'A';
  if n <> 4 then raise exception 'Group A must hold 4 clubs, found %', n; end if;
  select count(*) into n from public.teams where group_letter = 'B';
  if n <> 3 then raise exception 'Group B must hold 3 clubs, found %', n; end if;
  select count(*) into n from public.teams where group_letter is not null;
  if n <> 7 then raise exception 'expected 7 entered clubs, found %', n; end if;
  if exists (select 1 from public.teams where id = 'stm' and group_letter is not null) then
    raise exception 'St Mark are not entered and must have no group';
  end if;
  if exists (select 1 from public.matches where 'stm' in (home_team, away_team)) then
    raise exception 'St Mark must have no fixtures this year';
  end if;
  -- and they are still on the books for future years
  if not exists (select 1 from public.teams where id = 'stm') then
    raise exception 'St Mark must remain in the teams table';
  end if;

  -- GROUP A IS A TRUE SINGLE ROUND-ROBIN: every pair exactly once, 3 each
  for r in select t.id, count(*) c from public.teams t
             join public.matches m on t.id in (m.home_team, m.away_team) and m.stage = 'A'
            where t.group_letter = 'A' group by t.id
  loop
    if r.c <> 3 then raise exception 'Group A: % plays % games, expected 3', r.id, r.c; end if;
  end loop;
  select count(*) into n from (
    select least(home_team, away_team) a, greatest(home_team, away_team) b
      from public.matches where stage = 'A' group by 1,2 having count(*) <> 1) x;
  if n <> 0 then raise exception 'Group A has % pairing(s) not played exactly once', n; end if;

  -- GROUP B IS A TRUE DOUBLE ROUND-ROBIN: every pair exactly twice, 4 each
  for r in select t.id, count(*) c from public.teams t
             join public.matches m on t.id in (m.home_team, m.away_team) and m.stage = 'B'
            where t.group_letter = 'B' group by t.id
  loop
    if r.c <> 4 then raise exception 'Group B: % plays % games, expected 4', r.id, r.c; end if;
  end loop;
  select count(*) into n from (
    select least(home_team, away_team) a, greatest(home_team, away_team) b
      from public.matches where stage = 'B' group by 1,2 having count(*) <> 2) x;
  if n <> 0 then raise exception 'Group B has % pairing(s) not played exactly twice', n; end if;

  -- nobody plays outside their own group, and nobody plays themselves
  if exists (select 1 from public.matches m
               join public.teams h on h.id = m.home_team
               join public.teams a on a.id = m.away_team
              where m.stage in ('A','B')
                and (h.group_letter <> m.stage or a.group_letter <> m.stage)) then
    raise exception 'a group match crosses groups';
  end if;
  if exists (select 1 from public.matches where home_team = away_team) then
    raise exception 'a club is playing itself';
  end if;

  -- knockouts seeded empty
  select count(*) into n from public.matches
   where stage in ('SF1','SF2','FINAL') and home_team is null and away_team is null;
  if n <> 3 then raise exception 'expected 3 empty knockout rows, found %', n; end if;

  -- two pitches, and no pitch double-booked at any kick-off
  select count(*) into n from (
    select day, kickoff, pitch from public.matches
     where home_team is not null group by 1,2,3 having count(*) > 1) x;
  if n <> 0 then raise exception '% pitch clash(es)', n; end if;
  select count(distinct pitch) into n from public.matches where stage in ('A','B');
  if n <> 2 then raise exception 'expected exactly 2 pitches in the group stage, found %', n; end if;

  -- NO CLUB IS IN TWO PLACES AT ONCE
  select count(*) into n from (
    select m.day, m.kickoff, t.id from public.matches m
      join public.teams t on t.id in (m.home_team, m.away_team)
     group by 1,2,3 having count(*) > 1) x;
  if n <> 0 then raise exception '% club(s) double-booked at a kick-off', n; end if;

  -- the rehearsal is gone
  select count(*) into n from public.matches where status <> 'scheduled';
  if n <> 0 then raise exception '% match(es) are not scheduled - rehearsal data survived', n; end if;
  select count(*) into n from public.match_events;
  if n <> 0 then raise exception '% rehearsal event(s) survived', n; end if;
  select count(*) into n from public.players where active;
  if n <> 0 then raise exception '% dummy player(s) still active', n; end if;
  select count(*) into n from public.teams where manager is not null;
  if n <> 0 then raise exception '% placeholder manager(s) survived', n; end if;
  select count(*) into n from public.trophy_awards;
  if n <> 0 then raise exception '% trophy award(s) survived', n; end if;

  -- all eight clubs still exist; this draw removes nobody from the app
  select count(*) into n from public.teams;
  if n <> 8 then raise exception 'expected 8 clubs on the books, found %', n; end if;
end $$;

commit;
