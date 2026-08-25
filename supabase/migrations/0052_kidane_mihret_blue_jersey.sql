-- 0052 — Kidane Mihret's jersey is dark royal blue. Organiser, 25 August.
--
-- This reinstates `0047`, which set exactly these values on 24 August and was
-- reverted the same afternoon by `0048` as a false alarm. The trail 0047 →
-- 0048 → 0052 looks like indecision and is not: the first report was withdrawn,
-- and the change is now confirmed alongside the club's real crest arriving.
-- Kept as a third migration rather than reverting the revert, for the same
-- reason 0048 kept 0047: applied migrations are facts about the world.
--
-- `teams.colour` IS THE JERSEY, and it drives three surfaces at once: the
-- club's half of the match header, its stripe on a fixture row, and the circle
-- on its goal notifications. `text_colour` has to move with it — the old value
-- was near-black ink chosen for a white shirt.
--
-- #1E3A8A: hue 224, saturation .64, lightness .33. White ink measures 10.36:1.
--
-- ── WHAT THIS DOES TO THE CREST, MEASURED ────────────────────────────
-- The crest sits DIRECTLY on the club colour — no plate, by design — and the
-- badge that landed on 25 August is itself a blue roundel. Its ring blue is
-- #123496, which measures **1.04:1 against #1E3A8A**: the same colour to any
-- eye. So the outer ring merges into the header and the crest's readable area
-- drops from 62.9% of its frame on white to 42% on this blue.
--
-- THAT IS ACCEPTABLE AND THE ARTWORK IS WHY. The badge carries its own gold
-- outer rim, which is what still separates it from the ground — the same trick
-- `smpk.webp` uses, and the reason the whole badge is served rather than a
-- crop of it. What reads is a gold-rimmed cream disc with the cross, which is
-- the identifying part. **If it ever needs more separation, that is fixed in
-- the asset — a heavier rim — never in CSS.**
--
-- ── AND IT UN-COLLIDES GROUP A ───────────────────────────────────────
-- Kidane Mihret and Pope Kyrillos VI both played in white and are both in
-- Group A, so they meet, and their goal-notification circles were identical.
-- Only the circle's position kept that unambiguous. One is now blue.
--
-- Rotherham's navy #1E2E63 is hue 226 against 224, so those two circles are
-- both 🔵. They are in different groups and cannot meet before a semi-final;
-- revisit only if they do. Position carries the meaning, colour is the
-- flavour.

begin;

update public.teams
   set colour = '#1E3A8A', text_colour = '#FFFFFF'
 where id = 'km';

do $do$
declare c text; t text; n int;
begin
  select colour, text_colour into c, t from public.teams where id = 'km';
  if c is distinct from '#1E3A8A' then
    raise exception 'Kidane Mihret colour is %, expected #1E3A8A', c;
  end if;
  if t is distinct from '#FFFFFF' then
    raise exception 'Kidane Mihret text_colour is %, expected #FFFFFF', t;
  end if;

  -- Only this club moved. A bulk update here would be silent and disastrous.
  select count(*) into n from public.teams
   where id <> 'km' and (colour is null or text_colour is null);
  if n <> 0 then raise exception '% club(s) lost a colour', n; end if;
  if (select colour from public.teams where id = 'smpk') is distinct from '#FFFFFF'
  or (select colour from public.teams where id = 'rot')  is distinct from '#1E2E63'
  or (select colour from public.teams where id = 'cro')  is distinct from '#4FA3DC' then
    raise exception 'a club other than Kidane Mihret moved';
  end if;

  -- Group A no longer fields two clubs in the same shirt. This is the
  -- collision that mattered, because those two actually play each other.
  select count(*) into n from (
    select colour from public.teams
     where group_letter = 'A' group by colour having count(*) > 1) d;
  if n <> 0 then raise exception 'Group A still has % duplicated kit colour(s)', n; end if;
end
$do$;

commit;
