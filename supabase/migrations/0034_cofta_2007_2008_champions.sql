-- 0034 — COFTA 2007 and 2008 champions. The roll is now complete.
--
-- Both editions have sat since 0026 with a null champion and a known_gaps line
-- reading "Champion unknown - records being sought". Organiser-confirmed
-- 2026-08-24:
--
--   2007 — St Mary & Archangel Michael, Golders Green
--   2008 — St George, Stevenage
--
-- With these two filled, the COFTA champions roll is COMPLETE from 2005 to
-- 2026, excluding only the two confirmed no-tournament years, 2013 and 2020.
--
-- CORROBORATED INDEPENDENTLY. The COFTA 2010 report (see 0038) says each
-- southern church had won COFTA once in the previous five years. Reading
-- 2006-2010 against the roll: Croydon 2006, Golders Green 2007, Stevenage 2008,
-- St Mark 2009, Brighton 2010 — five different southern clubs, one title each,
-- no repeats. A contemporaneous document agreeing exactly with Adam's roll,
-- including on the two years being filled here. Logged as C19, deliberately as
-- a corroboration and not as a conflict.
--
-- Cabinet effect: Golders Green gain their first COFTA championship in the
-- archive, and Stevenage gain their first — distinct from the runner-up lines
-- they already hold.

begin;

update public.archive_editions e
   set champion_team_id = t.id,
       notes = jsonb_set(
                 (e.notes - 'edition_note'),
                 '{known_gaps}',
                 to_jsonb(array[
                   'No runner-up, final or scoreline.',
                   'No dates, entrant list, standings or match data.',
                   'No goalscorers, awards or player data.'
                 ]::text[])
               )
  from public.archive_teams t
 where e.id = 'cofta-2007'
   and t.short_name = 'Golders Green' and t.parent_club is null;

update public.archive_editions e
   set champion_team_id = t.id,
       notes = jsonb_set(
                 (e.notes - 'edition_note'),
                 '{known_gaps}',
                 to_jsonb(array[
                   'No runner-up, final or scoreline.',
                   'No dates, entrant list, standings or match data.',
                   'No goalscorers, awards or player data.'
                 ]::text[])
               )
  from public.archive_teams t
 where e.id = 'cofta-2008'
   and t.short_name = 'Stevenage' and t.parent_club is null;

-- The champion is also the one known entrant, exactly as every other minimal
-- edition of this era records it.
insert into public.archive_edition_teams (edition_id, team_id)
select 'cofta-2007', t.id from public.archive_teams t
 where t.short_name = 'Golders Green' and t.parent_club is null
on conflict do nothing;

insert into public.archive_edition_teams (edition_id, team_id)
select 'cofta-2008', t.id from public.archive_teams t
 where t.short_name = 'Stevenage' and t.parent_club is null
on conflict do nothing;

do $$
declare n int;
begin
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams t on t.id = e.champion_team_id
                  where e.id = 'cofta-2007' and t.short_name = 'Golders Green') then
    raise exception 'cofta-2007 champion must be Golders Green';
  end if;
  if not exists (select 1 from public.archive_editions e
                   join public.archive_teams t on t.id = e.champion_team_id
                  where e.id = 'cofta-2008' and t.short_name = 'Stevenage') then
    raise exception 'cofta-2008 champion must be Stevenage';
  end if;

  -- the "records being sought" line is gone from both
  select count(*) into n from public.archive_editions
   where id in ('cofta-2007','cofta-2008')
     and notes::text ilike '%records being sought%';
  if n <> 0 then raise exception 'gap note still present on % row(s)', n; end if;

  -- and so is the "who won it is not recorded" edition note
  select count(*) into n from public.archive_editions
   where id in ('cofta-2007','cofta-2008') and notes ? 'edition_note';
  if n <> 0 then raise exception 'stale edition_note on % row(s)', n; end if;

  -- THE ROLL IS COMPLETE: every COFTA year 2005-2026 that has an edition row
  -- now has a champion. 2013 and 2020 have no row at all, by design.
  select count(*) into n from public.archive_editions
   where competition = 'COFTA' and champion_team_id is null;
  if n <> 0 then raise exception 'COFTA still has % edition(s) with no champion', n; end if;

  -- AND SO IS EVERY OTHER COMPETITION'S. These two were the only championless
  -- rows in the whole archive before this migration; afterwards there are none.
  -- Measured, not assumed: the pre-migration query returned exactly
  -- cofta-2007 and cofta-2008 and nothing else.
  select count(*) into n from public.archive_editions where champion_team_id is null;
  if n <> 0 then
    raise exception 'expected no championless editions archive-wide, found %', n;
  end if;
end $$;

commit;
