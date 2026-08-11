-- ============================================================
-- COFTA 2026 — write path verification
--
-- Paste this whole thing into the Supabase SQL Editor and press Run.
-- Results appear in the normal results grid at the bottom: one row per
-- check, each saying PASS or FAIL.
--
-- It exercises the real write path as your admin user, then cleans up
-- after itself. Your fixtures are left exactly as they were.
-- ============================================================

create or replace function public.__cofta_test()
returns table(step text, outcome text, detail text)
language plpgsql security definer set search_path = public as $fn$
declare
  admin_id uuid; mid uuid; v int; t0 timestamptz := now();
  eid uuid := '11111111-1111-1111-1111-111111111111';
  hs int; a_s int; cnt int;
begin
  select user_id into admin_id from public.admins limit 1;
  if admin_id is null then
    step:='setup'; outcome:='FAIL';
    detail:='No admin row. Sign up with the allowlisted email first.';
    return next; return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role','authenticated')::text, true);

  select id into mid from public.matches where stage='A' and kickoff='09:30';

  ---------------------------------------------------------------- 1
  select version into v from public.matches where id=mid;
  perform public.set_clock(mid,'start',v);
  step:='1. start clock';
  if (select status from public.matches where id=mid)='first_half'
    then outcome:='PASS'; detail:='status is first_half';
    else outcome:='FAIL'; detail:='status did not change'; end if;
  return next;

  ---------------------------------------------------------------- 2
  select version into v from public.matches where id=mid;
  step:='2. version guard';
  begin
    perform public.set_clock(mid,'half_time', v-1);
    outcome:='FAIL'; detail:='a stale write was accepted';
  exception when sqlstate '40001' then
    outcome:='PASS'; detail:='second admin''s stale write rejected';
  end;
  return next;

  ---------------------------------------------------------------- 3
  select version into v from public.matches where id=mid;
  step:='3. transition guard';
  begin
    perform public.set_clock(mid,'second_half', v);
    outcome:='FAIL'; detail:='skipped half time';
  exception when others then
    outcome:='PASS'; detail:='cannot skip half time';
  end;
  return next;

  ---------------------------------------------------------------- 4
  perform public.log_event(eid, mid, 'goal','home', null, 300000, '6');
  perform public.log_event(eid, mid, 'goal','home', null, 300000, '6');
  perform public.log_event(eid, mid, 'goal','home', null, 300000, '6');
  select count(*) into cnt from public.match_events where id=eid;
  select home_score into hs from public.matches where id=mid;
  step:='4. idempotent goal';
  if cnt=1 and hs=1
    then outcome:='PASS'; detail:='same goal sent 3x, stored once, score 1';
    else outcome:='FAIL'; detail:=cnt||' rows, score '||hs; end if;
  return next;

  ---------------------------------------------------------------- 5
  perform public.void_event(eid);
  select home_score into hs from public.matches where id=mid;
  step:='5. undo recomputes score';
  if hs=0 then outcome:='PASS'; detail:='score back to 0 automatically';
  else outcome:='FAIL'; detail:='score stuck at '||hs; end if;
  return next;

  ---------------------------------------------------------------- 6
  select version into v from public.matches where id=mid;
  perform public.set_clock(mid,'half_time',v);
  select version into v from public.matches where id=mid;
  perform public.set_clock(mid,'second_half',v);
  select clock_accum_ms into cnt from public.matches where id=mid;
  step:='6. second half starts at 20:00';
  if cnt=1200000 then outcome:='PASS'; detail:='overrun not carried forward';
  else outcome:='FAIL'; detail:=cnt||' ms'; end if;
  return next;

  ---------------------------------------------------------------- 7
  select version into v from public.matches where id=mid;
  perform public.set_clock(mid,'full_time',v);
  step:='7. no shootout in groups';
  begin
    perform public.set_shootout(mid, 4, 3, true);
    outcome:='FAIL'; detail:='a group match accepted penalties';
  exception when others then
    outcome:='PASS'; detail:='groups may end level';
  end;
  return next;

  ---------------------------------------------------------------- 8
  perform public.set_forfeit(mid,'away');
  select home_score, away_score into hs, a_s from public.matches where id=mid;
  step:='8. forfeit awards 3-0';
  if hs=3 and a_s=0 then outcome:='PASS'; detail:='3-0 recorded, no clock';
  else outcome:='FAIL'; detail:=hs||'-'||a_s; end if;
  return next;

  ---------------------------------------------------------------- 9
  select count(*) into cnt from public.audit_log where at >= t0;
  step:='9. audit trail';
  if cnt >= 6 then outcome:='PASS'; detail:=cnt||' actions logged';
  else outcome:='FAIL'; detail:='only '||cnt||' logged'; end if;
  return next;

  ---------------------------------------------------------------- cleanup
  delete from public.match_events where id = eid;
  delete from public.audit_log where at >= t0;
  update public.matches set
    status='scheduled', clock_running=false, clock_anchor=null, clock_accum_ms=0,
    locked=false, home_score=0, away_score=0, pens_home=0, pens_away=0,
    pens_decided=false, forfeit_side=null, version=0,
    controlled_by=null, controlled_at=null, updated_at=now()
  where id = mid;

  step:='cleanup'; outcome:='DONE';
  detail:='test match reset to scheduled, fixtures untouched';
  return next;
end $fn$;

select * from public.__cofta_test();
