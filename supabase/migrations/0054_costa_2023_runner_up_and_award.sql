-- 0054 — COSTA 2023 gains a runner-up and a player of the tournament.
--        Organiser-confirmed, 26 August 2026: St Mark were runners-up, and
--        Demas Ramsis was player of the tournament.
--
-- The edition held a champion and nothing else. Two of its four recorded gaps
-- are now partly closed, so they are rewritten rather than left claiming
-- absences that no longer exist — a `known_gaps` entry that is out of date is
-- the archive lying about itself.
--
-- ── WHICH ST MARK ────────────────────────────────────────────────────
-- Three registry rows carry the name: St Mark (Kensington), St Mark B
-- (Kensington) and St Mary & St Mark (Birmingham) — see the identity guards.
-- This is **St Mark, Kensington**, and it is not a guess: they are COSTA's own
-- entrants in both other editions the archive holds (2022 and 2025). Birmingham
-- is a Midlands club that has never appeared in COSTA, and a B team is not the
-- club. Resolved by id below rather than by name so it cannot drift.
--
-- ── THE SPELLING, WHICH IS FLAGGED AND NOT SILENTLY DECIDED ──────────
-- Adam gave the name as "Demas RAMSES". Every existing record spells it
-- "Demas RAMSIS" — thirty rows across COFTA 2024 and 2025, CONAFA 2026, the
-- Ark Cup 2026 and COSTA 2025, where he was Brighton's top scorer.
--
-- Written here as **Ramsis**, deliberately. Writing "Ramses" into this one row
-- would put two spellings of one man into the archive, which is precisely the
-- failure `player_canonical` exists to prevent and precisely what a cabinet
-- listing one club down the years exposes. If Ramses is the correct spelling
-- then thirty rows are wrong, and correcting them is a rename of the whole
-- record — a decision, not a side effect of adding one award. FLAGGED for a
-- ruling rather than resolved.
--
-- ── HIS CLUB IS BRIGHTON, CONFIRMED - NOT INFERRED ───────────────────
-- Brighton was the likely answer from the data alone: he was their top scorer
-- in COSTA 2025 and they won this edition. That is exactly the reasoning this
-- archive refuses to record, because a player can move. Adam confirmed it on
-- 26 August, so it goes in as a fact rather than as a guess that happened to
-- be right. The award therefore lands on Brighton's cabinet as well as the
-- edition page.

begin;

update public.archive_editions
   set runner_up_team_id = (select id from public.archive_teams
                             where canonical_name = 'St Mark' and city = 'Kensington'),
       final_summary = 'Brighton beat St Mark in the final',
       notes = jsonb_set(
                 jsonb_set(coalesce(notes, '{}'::jsonb),
                   '{teams_note}', '"The two finalists. This is not the entrant list."'::jsonb),
                 '{known_gaps}',
                 '["No final scoreline.",
                   "No dates or venue.",
                   "No entrant list beyond the two finalists, and no group stage, standings or match data.",
                   "No goalscorers."]'::jsonb)
 where id = 'costa-2023';

-- The entrant list is the two finalists now, not the champion alone.
insert into public.archive_edition_teams (edition_id, team_id)
select 'costa-2023', id from public.archive_teams
 where canonical_name = 'St Mark' and city = 'Kensington'
on conflict do nothing;

insert into public.archive_awards
  (edition_id, award_type, player_name, player_canonical, team_id, value, is_published_summary)
select 'costa-2023', 'player_of_the_tournament', 'Demas Ramsis', 'Demas Ramsis',
       (select id from public.archive_teams
         where canonical_name = 'St Mary & St Abraam' and city = 'Brighton'),
       null, false
 where not exists (select 1 from public.archive_awards
                    where edition_id = 'costa-2023'
                      and award_type = 'player_of_the_tournament');

do $do$
declare n int; nm text;
begin
  -- the runner-up is the Kensington club, by id
  select t.canonical_name || ', ' || t.city into nm
    from public.archive_editions e join public.archive_teams t on t.id = e.runner_up_team_id
   where e.id = 'costa-2023';
  if nm is distinct from 'St Mark, Kensington' then
    raise exception 'costa-2023 runner-up resolved to %, expected St Mark, Kensington', nm;
  end if;

  -- and NOT to either club it could have been confused with
  select count(*) into n from public.archive_editions e
    join public.archive_teams t on t.id = e.runner_up_team_id
   where e.id = 'costa-2023' and (t.city = 'Birmingham' or t.canonical_name like '% B');
  if n <> 0 then raise exception 'costa-2023 runner-up resolved to the wrong St Mark'; end if;

  -- the award exists once, spelled to match the rest of the archive
  select count(*) into n from public.archive_awards
   where edition_id = 'costa-2023' and award_type = 'player_of_the_tournament'
     and player_canonical = 'Demas Ramsis';
  if n <> 1 then raise exception 'expected 1 player of the tournament for costa-2023, found %', n; end if;

  -- ONE SPELLING FOR ONE MAN, across the whole archive.
  select count(distinct player_canonical) into n from public.archive_awards
   where player_canonical ilike 'Demas%';
  if n <> 1 then raise exception 'Demas now resolves to % spellings; the archive has forked', n; end if;
  select count(*) into n from public.archive_awards
   where player_name ilike '%Ramses%' or player_canonical ilike '%Ramses%';
  if n <> 0 then raise exception '% row(s) spell it Ramses while the rest spell it Ramsis', n; end if;

  -- his club is Brighton, organiser-confirmed, so the award reaches their
  -- cabinet and not only the edition page
  if (select team_id from public.archive_awards
       where edition_id = 'costa-2023' and award_type = 'player_of_the_tournament')
     is distinct from (select id from public.archive_teams
                        where canonical_name = 'St Mary & St Abraam' and city = 'Brighton') then
    raise exception 'the player of the tournament is not recorded against Brighton';
  end if;

  -- the champion did not move, and both finalists are entrants
  select count(*) into n from public.archive_edition_teams where edition_id = 'costa-2023';
  if n <> 2 then raise exception 'costa-2023 should list 2 finalists as entrants, found %', n; end if;
  if (select champion_team_id from public.archive_editions where id = 'costa-2023')
     is distinct from (select id from public.archive_teams
                        where canonical_name = 'St Mary & St Abraam' and city = 'Brighton') then
    raise exception 'the champion changed, which this migration must not touch';
  end if;

  -- the stale gaps are gone
  if exists (select 1 from public.archive_editions
              where id = 'costa-2023' and notes::text ilike '%No runner-up%') then
    raise exception 'known_gaps still claims there is no runner-up';
  end if;
end
$do$;

commit;
