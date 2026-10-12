\set ON_ERROR_STOP on
-- ONLY a disposable local database: fixtures intentionally create Supabase roles.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end; $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.profiles (id uuid primary key, creator_status text not null);
create table public.user_roles (user_id uuid references public.profiles(id), role text);
insert into public.profiles values
  ('11111111-1111-4111-8111-111111111111', 'approved'),
  ('22222222-2222-4222-8222-222222222222', 'approved'),
  ('33333333-3333-4333-8333-333333333333', 'approved'),
  ('44444444-4444-4444-8444-444444444444', 'pending');
insert into public.user_roles select id, 'creator' from public.profiles;
\ir ../../../migrations/20261011195000_studio_ideas_private_cache.sql
create function public.test_assert(p_value boolean, p_message text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'assertion failed: %', p_message; end if; end;
$$;
select public.test_assert(not has_table_privilege('anon', 'public.studio_idea_jobs', 'SELECT'), 'anon cache denied');
select public.test_assert(not has_table_privilege('authenticated', 'public.studio_idea_jobs', 'INSERT'), 'authenticated writes denied');
select public.test_assert(not has_function_privilege('authenticated', 'public.studio_ideas_reserve(uuid,uuid,text,text,jsonb,boolean)', 'EXECUTE'), 'authenticated budget bypass denied');
select public.test_assert(has_function_privilege('service_role', 'public.studio_ideas_reserve(uuid,uuid,text,text,jsonb,boolean)', 'EXECUTE'), 'service RPC granted');
set local role service_role;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  c uuid := '33333333-3333-4333-8333-333333333333';
  r uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); job uuid;
  out jsonb; counter integer := 0;
begin
  out := public.studio_ideas_reserve(a, r, 'suggest', 'context-a', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'reserved', 'initial generation reserved'); job := (out->>'jobId')::uuid;
  out := public.studio_ideas_reserve(a, r, 'suggest', 'context-a', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'pending', 'same request cannot reserve twice');
  out := public.studio_ideas_reserve(a, r, 'script', 'different-key', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'conflict', 'request ID cannot change meaning');
  out := public.studio_ideas_reserve(a, r2, 'suggest', 'context-a', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'pending', 'same context concurrent request reuses pending job');
  perform public.test_assert((select count(*) = 1 from public.studio_idea_jobs where owner_id = a), 'only one charged generation');
  perform public.test_assert(not public.studio_ideas_complete(b, job, '{"generatedAt":"now"}'::jsonb), 'other owner cannot complete job');
  perform public.studio_ideas_cancel(b, r);
  perform public.test_assert((select status = 'pending' from public.studio_idea_jobs where id = job), 'other owner cannot cancel job');
  perform public.test_assert(public.studio_ideas_complete(a, job, '{"suggestions":[],"generatedAt":"now"}'::jsonb), 'own result committed');
  out := public.studio_ideas_reserve(a, r2, 'suggest', 'context-a', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'cached', 'pending alias returns completed result');
  out := public.studio_ideas_reserve(a, gen_random_uuid(), 'suggest', 'context-a', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'cached', 'fresh request uses cached generation');
  perform public.test_assert((select count(*) = 1 from public.studio_idea_jobs where owner_id = a), 'cache hit free of generation budget');
  out := public.studio_ideas_reserve(a, gen_random_uuid(), 'suggest', 'context-a', '{}'::jsonb, true);
  perform public.test_assert(out->>'state' = 'limit', 'refresh cooldown enforced');
  -- No cross-owner cache sharing, even for an identical context hash.
  r := gen_random_uuid(); out := public.studio_ideas_reserve(b, r, 'suggest', 'context-a', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'reserved', 'cache isolated by owner'); job := (out->>'jobId')::uuid;
  perform public.studio_ideas_cancel(b, r);
  perform public.test_assert(not public.studio_ideas_complete(b, job, '{"generatedAt":"now"}'::jsonb), 'cancelled generation cannot commit');
  out := public.studio_ideas_reserve(b, r, 'suggest', 'context-a', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'failed', 'cancelled request cannot burn another generation');
  -- Expired server leases do not trap a creator permanently.
  r := gen_random_uuid(); out := public.studio_ideas_reserve(b, r, 'script', 'lease', '{}'::jsonb, false); job := (out->>'jobId')::uuid;
  update public.studio_idea_jobs set lease_until = now() - interval '1 second' where id = job;
  out := public.studio_ideas_reserve(b, gen_random_uuid(), 'script', 'next', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'reserved', 'expired lease releases active generation');
  perform public.test_assert((select status = 'failed' from public.studio_idea_jobs where id = job), 'expired lease terminal');
  perform public.studio_ideas_fail(b, (out->>'jobId')::uuid, 'test_cleanup');
  -- Every terminal provider attempt counts; retries cannot bypass daily caps.
  loop
    out := public.studio_ideas_reserve(a, gen_random_uuid(), 'script', 'budget-' || counter, '{}'::jsonb, false);
    exit when out->>'state' = 'limit';
    perform public.test_assert(out->>'state' = 'reserved', 'budget fixture reserved');
    perform public.studio_ideas_fail(a, (out->>'jobId')::uuid, 'provider_failure'); counter := counter + 1;
    if counter > 25 then raise exception 'budget not enforced'; end if;
  end loop;
  perform public.test_assert(counter = 23, '24 total generations per rolling day');
  for i in 1..12 loop
    out := public.studio_ideas_reserve(c, gen_random_uuid(), 'suggest', 'ideas-' || i, '{}'::jsonb, false);
    perform public.test_assert(out->>'state' = 'reserved', 'suggestion budget reserved');
    perform public.test_assert(public.studio_ideas_complete(c, (out->>'jobId')::uuid, '{"generatedAt":"now"}'::jsonb), 'suggestion budget ready');
  end loop;
  out := public.studio_ideas_reserve(c, gen_random_uuid(), 'suggest', 'ideas-13', '{}'::jsonb, false);
  perform public.test_assert(out->>'state' = 'limit', '12 suggestion batches per rolling day');
  begin
    perform public.studio_ideas_reserve('44444444-4444-4444-8444-444444444444', gen_random_uuid(), 'suggest', 'pending-creator', '{}'::jsonb, false);
    raise exception 'pending creator allowed';
  exception when raise_exception then
    if sqlerrm <> 'creator_required' then raise; end if;
  end;
end;
$$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select public.test_assert((select bool_and(owner_id = auth.uid()) from public.studio_idea_jobs), 'RLS excludes other creators jobs');
select public.test_assert((select bool_and(owner_id = auth.uid()) from public.studio_idea_requests), 'RLS excludes other creators requests');
reset role;
rollback;
\echo 'studio-ideas SQL: cache, RLS, idempotency, owner checks, cancel, leases and limits passed'
