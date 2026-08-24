-- 0047 — Kidane Mihret change kit: white to dark royal blue.
--
-- Organiser-reported, 24 August 2026. `teams.colour` is what fills that club's
-- half of the match header, tints its side of a fixture row, and decides the
-- circle on a goal notification, so this one column moves all three at once.
-- `text_colour` has to move with it: the old value was near-black ink for a
-- white shirt, and left alone it would be black on dark blue.
--
-- #1E3A8A is a deep, saturated royal — hue 224, saturation .64, lightness .33.
-- White ink on it measures 10.36:1, comfortably past AA.
--
-- TWO KNOCK-ON EFFECTS, both worth knowing before anyone reports them as bugs.
--
--   1. IT FIXES A COLLISION THAT MATTERED. Kidane Mihret and Pope Kyrillos VI
--      both played in white and are BOTH IN GROUP A, so they meet — and their
--      notification circles were identical white. Only the position of the
--      circle kept that unambiguous. Now one is blue and one is white.
--
--   2. AND CREATES ONE THAT MATTERS LESS. Rotherham's navy is #1E2E63: hue
--      226, within two degrees, and the two swatches measure 1.25:1 against
--      each other. They are in different groups, so they cannot meet before a
--      semi-final. If they do meet, the split match header will be two very
--      similar blues and this is the row to revisit — the divider there is
--      drawn as two hairlines precisely because no single colour separates
--      every pairing, but that helps the seam, not the halves.
--
-- Croydon is unaffected: light blue at lightness .59 against .33 is a plain
-- 3.75:1 apart and reads as a different colour at a glance.

begin;

update public.teams
   set colour = '#1E3A8A', text_colour = '#FFFFFF'
 where id = 'km';

do $$
declare c text; t text; n int;
begin
  select colour, text_colour into c, t from public.teams where id = 'km';
  if c is distinct from '#1E3A8A' then
    raise exception 'Kidane Mihret colour is %, expected #1E3A8A', c;
  end if;
  -- The whole point of the change: white ink, because the shirt is no longer
  -- white. A dark colour left with dark ink is unreadable rather than wrong.
  if t is distinct from '#FFFFFF' then
    raise exception 'Kidane Mihret text_colour is %, expected #FFFFFF', t;
  end if;

  -- Nothing else was touched. Six other entered clubs plus St Mark keep the
  -- colours they had; a bulk update here would be silent and catastrophic.
  select count(*) into n from public.teams
   where id <> 'km' and (colour is null or text_colour is null);
  if n <> 0 then raise exception '% club(s) lost a colour', n; end if;

  -- And Group A no longer has two clubs in the same shirt. This is the
  -- collision that actually mattered, because those two play each other.
  select count(*) into n from (
    select colour from public.teams
     where group_letter = 'A' group by colour having count(*) > 1) d;
  if n <> 0 then raise exception 'Group A still has % duplicated kit colour(s)', n; end if;
end $$;

commit;
