-- 0030_golders_green_b_crest.sql
--
-- Golders Green's B team fielded its own badge in the Ark Cup, so it stops
-- inheriting the parent's crest. Its archive short_name is "St Mary's", which
-- is what the badge itself reads.
--
-- FILENAME: the crest arrived named `stm-ggb.webp` and is stored as
-- `gg-b.webp`. `stm` is St Mark's live_team_id throughout this codebase
-- (crests.js, archive_teams.live_team_id), so a file named for St Mary's with
-- an `stm` prefix is one careless glance away from being wired to the wrong
-- club. `<live_team_id>-b` follows the same shape as the `-w` women's crests.

begin;

update public.archive_teams
   set display = coalesce(display, '{}'::jsonb)
               || jsonb_build_object('crest', './crests/archive/gg-b.webp')
 where canonical_name = 'St Mary & Archangel Michael B'
   and city = 'Golders Green'
   and parent_club is not null;

do $$
declare n int;
begin
  select count(*) into n from public.archive_teams
   where display->>'crest' = './crests/archive/gg-b.webp';
  if n <> 1 then
    raise exception 'expected exactly 1 club on the Golders Green B crest, found %', n;
  end if;

  if exists (select 1 from public.archive_teams
              where canonical_name = 'St Mary & Archangel Michael'
                and city = 'Golders Green' and parent_club is null
                and display->>'crest' = './crests/archive/gg-b.webp') then
    raise exception 'the B team crest must not attach to the parent club';
  end if;

  if exists (select 1 from public.archive_teams
              where live_team_id = 'stm'
                and display->>'crest' = './crests/archive/gg-b.webp') then
    raise exception 'the B team crest must not attach to St Mark';
  end if;
end $$;

commit;
