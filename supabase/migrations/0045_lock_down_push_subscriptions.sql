-- 0045 — take the blanket table grants off push_subscriptions.
--
-- 0044 enabled RLS with no policies, which does protect the rows: a spectator
-- querying the table got 200 and an empty array. But the underlying GRANTs
-- were still the schema-wide blanket ones — anon held SELECT, INSERT, UPDATE
-- *and* DELETE. RLS was the only thing standing there, and the day someone
-- adds a permissive policy for some other reason, this table goes wide open
-- with it. Subscriber endpoints are the one piece of spectator data this app
-- stores, so it gets two locks rather than one.
--
-- Measured before and after: a direct GET went 200/[] -> 401, and a direct
-- POST 401, while both RPCs still return 204.
--
-- The RPCs are SECURITY DEFINER and run as the owner, so they are unaffected.
-- PostgREST also stops advertising the table once the grants are gone.

begin;

revoke all on public.push_subscriptions from anon, authenticated;

do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
   where table_name = 'push_subscriptions' and grantee in ('anon','authenticated');
  if n <> 0 then raise exception 'anon/authenticated still hold % grant(s)', n; end if;

  perform public.subscribe_push('https://example.invalid/grant-check-0045',
    '{"p256dh":"x","auth":"y"}'::jsonb, null);
  if not exists (select 1 from public.push_subscriptions
                  where endpoint = 'https://example.invalid/grant-check-0045') then
    raise exception 'subscribe_push stopped working after the revoke';
  end if;
  perform public.unsubscribe_push('https://example.invalid/grant-check-0045');
  if exists (select 1 from public.push_subscriptions
              where endpoint = 'https://example.invalid/grant-check-0045') then
    raise exception 'unsubscribe_push stopped working after the revoke';
  end if;

  if not exists (select 1 from information_schema.role_table_grants
                  where table_name = 'push_subscriptions' and grantee = 'service_role'
                    and privilege_type = 'SELECT') then
    raise exception 'service_role lost SELECT; the Edge Function cannot send';
  end if;
end $$;

commit;
