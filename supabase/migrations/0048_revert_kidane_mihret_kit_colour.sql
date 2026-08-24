-- 0048 — reverts 0047. Kidane Mihret are still in white; the kit change was a
--        false alarm, organiser-corrected 24 August 2026, hours after 0047.
--
-- Straight back to `#FFFFFF` with near-black ink. Kept as its own numbered
-- migration rather than deleting 0047, because 0047 has been applied to the
-- live database — a migration that has run is a fact about the world, and
-- unrunning it by deleting the file would leave every other environment
-- disagreeing about what happened.
--
-- WHICH RESTORES THE TWO-WHITE-KITS SITUATION IN GROUP A, and that is fine.
-- Kidane Mihret and Pope Kyrillos VI both play in white, both are in Group A,
-- so they meet — and their goal-notification circles are both ⚪. The
-- notification is still unambiguous because THE CIRCLE SITS AT THE SCORING
-- END of the scoreline rather than merely appearing somewhere in it:
--
--     ⚪ Kidane Mihret 1–0 Pope Kyrillos VI     Kidane Mihret scored
--     Kidane Mihret 1–0 Pope Kyrillos VI ⚪     Pope Kyrillos VI scored
--
-- Position carries the meaning and colour is the flavour, in that order. This
-- is the same reasoning that keeps Croydon's light blue and Rotherham's navy
-- both on 🔵 rather than distorting one of them to tell them apart.
--
-- 0047's assertion that Group A holds no duplicated kit colour is therefore
-- deliberately NOT restated here — it was true of a world that lasted an
-- afternoon, and asserting it now would fail on the correct data.

begin;

update public.teams
   set colour = '#FFFFFF', text_colour = '#14161A'
 where id = 'km';

do $$
declare c text; t text; n int;
begin
  select colour, text_colour into c, t from public.teams where id = 'km';
  if c is distinct from '#FFFFFF' then
    raise exception 'Kidane Mihret colour is %, expected #FFFFFF', c;
  end if;
  if t is distinct from '#14161A' then
    raise exception 'Kidane Mihret text_colour is %, expected #14161A', t;
  end if;

  -- Every other club untouched, exactly as in 0047. A revert is the easiest
  -- place in the world to catch a neighbouring row by accident.
  select count(*) into n from public.teams
   where id <> 'km' and (colour is null or text_colour is null);
  if n <> 0 then raise exception '% club(s) lost a colour', n; end if;

  -- And the six clubs that were never in question still hold their own values.
  if (select colour from public.teams where id = 'rot') is distinct from '#1E2E63'
  or (select colour from public.teams where id = 'cro') is distinct from '#4FA3DC'
  or (select colour from public.teams where id = 'smpk') is distinct from '#FFFFFF' then
    raise exception 'a club other than Kidane Mihret moved';
  end if;
end $$;

commit;
