\set ON_ERROR_STOP on
-- Only a disposable local database. Never run these fixtures in production.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end; $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.profiles (id uuid primary key, creator_status text not null, bio text, creator_bio text, updated_at timestamptz default now());
create table public.user_roles (user_id uuid references public.profiles(id), role text);
create table public.categories (id uuid primary key default gen_random_uuid(), name text unique not null, slug text unique not null, description text, created_at timestamptz default now());
insert into public.categories(name,slug) values('Design','design');
insert into public.profiles(id,creator_status) values
  ('11111111-1111-4111-8111-111111111111', 'approved'),
  ('22222222-2222-4222-8222-222222222222', 'approved'),
  ('33333333-3333-4333-8333-333333333333', 'pending');
insert into public.user_roles select id, 'creator' from public.profiles;
\ir ../../../migrations/20261011195000_studio_ideas_private_cache.sql
\ir ../../../migrations/20261011223000_studio_ideas_editorial_anchor.sql
create function public.test_assert(p_value boolean, p_message text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'assertion failed: %', p_message; end if; end;
$$;
alter table public.profiles enable row level security;
create policy own_profile_select on public.profiles for select to authenticated using(auth.uid()=id);
create policy own_profile_update on public.profiles for update to authenticated using(auth.uid()=id) with check(auth.uid()=id);
grant select,update on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select on public.categories to authenticated,service_role;
select public.test_assert((select count(*)=2 from public.categories), 'only requested category added');
select public.test_assert((select bool_and(creator_category_id is null and creator_teaching_focus is null) from public.profiles), 'legacy profiles not assigned any editorial defaults');
select public.test_assert(not has_function_privilege('authenticated','public.studio_ideas_save_editorial(uuid,uuid,text)','EXECUTE'), 'direct service save RPC denied');
select public.test_assert(not has_function_privilege('authenticated','public.studio_ideas_reserve_editorial(uuid,uuid,text,text,jsonb,boolean)','EXECUTE'), 'direct service reserve RPC denied');
set local role service_role;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111'; b uuid := '22222222-2222-4222-8222-222222222222';
  category uuid; request_id uuid; job uuid; snapshot jsonb; current_snapshot jsonb; out jsonb;
begin
  select id into category from public.categories where slug='espiritualidade';
  begin
    perform public.studio_ideas_reserve_editorial(a,gen_random_uuid(),'suggest','missing','{}',false);
    raise exception 'missing editorial allowed';
  exception when raise_exception then if sqlerrm<>'editorial_required' then raise; end if; end;
  begin
    perform public.studio_ideas_save_editorial(a,category,'curto'); raise exception 'short focus allowed';
  exception when raise_exception then if sqlerrm<>'invalid_editorial' then raise; end if; end;
  begin
    perform public.studio_ideas_save_editorial('33333333-3333-4333-8333-333333333333',category,'Ensino espiritualidade e desenvolvimento interior.'); raise exception 'pending creator allowed';
  exception when raise_exception then if sqlerrm<>'creator_required' then raise; end if; end;
  perform public.studio_ideas_save_editorial(a,category,'Ensino espiritualidade e desenvolvimento interior.');
  perform public.test_assert((select creator_category_id=category from public.profiles where id=a), 'own category saved');
  perform public.test_assert((select creator_category_id is null from public.profiles where id=b), 'other profile unchanged');
  snapshot := jsonb_build_object('editorial',jsonb_build_object('ready',true),'editorialRevision',public.studio_ideas_editorial_revision(a));
  request_id := gen_random_uuid(); out := public.studio_ideas_reserve_editorial(a,request_id,'suggest','anchor-a',snapshot,false); job := (out->>'jobId')::uuid;
  perform public.test_assert(out->>'state'='reserved','anchored generation reserved');
  perform public.studio_ideas_save_editorial(a,category,'Ensino espiritualidade aplicada ao dia a dia.');
  perform public.test_assert(not public.studio_ideas_complete(a,job,'{"generatedAt":"now"}'), 'profile changed during AI cannot commit stale suggestions');
  begin
    perform public.studio_ideas_reserve_editorial(a,request_id,'suggest','anchor-a',snapshot,false); raise exception 'stale request reused';
  exception when raise_exception then if sqlerrm<>'editorial_context_changed' then raise; end if; end;
  perform public.studio_ideas_fail(a,job,'editorial_context_changed');
  current_snapshot := jsonb_build_object('editorial',jsonb_build_object('ready',true),'editorialRevision',public.studio_ideas_editorial_revision(a));
  request_id := gen_random_uuid(); out := public.studio_ideas_reserve_editorial(a,request_id,'script','anchor-b',current_snapshot,false); job := (out->>'jobId')::uuid;
  perform public.test_assert(public.studio_ideas_complete(a,job,'{"generatedAt":"now"}'), 'current editorial result commits');
  update public.profiles set bio='Reflexões sobre espiritualidade e escolhas cotidianas.' where id=a;
  begin
    perform public.studio_ideas_reserve_editorial(a,request_id,'script','anchor-b',current_snapshot,false); raise exception 'old ready request bypassed bio revision';
  exception when raise_exception then if sqlerrm<>'editorial_context_changed' then raise; end if; end;
  current_snapshot := jsonb_build_object('editorial',jsonb_build_object('ready',true),'editorialRevision',public.studio_ideas_editorial_revision(a));
  out := public.studio_ideas_reserve_editorial(a,gen_random_uuid(),'script','bio-c',current_snapshot,false); job := (out->>'jobId')::uuid;
  update public.profiles set creator_bio='Novo contexto editorial público.' where id=a;
  perform public.test_assert(not public.studio_ideas_complete(a,job,'{"generatedAt":"now"}'), 'creator bio change blocks stale scripts');
  perform public.studio_ideas_fail(a,job,'editorial_context_changed');
  out := public.studio_ideas_reserve(b,gen_random_uuid(),'suggest','legacy-no-anchor','{}',false); job := (out->>'jobId')::uuid;
  perform public.test_assert(not public.studio_ideas_complete(b,job,'{"generatedAt":"now"}'), 'legacy generation without confirmed anchor cannot commit');
  perform public.studio_ideas_fail(b,job,'editorial_required');
end;
$$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ declare c uuid; begin
  select id into c from public.categories where slug='espiritualidade';
  begin
    update public.profiles set creator_category_id=c where id=auth.uid(); raise exception 'partial editorial saved';
  exception when check_violation then null; end;
  update public.profiles set creator_category_id=c,creator_teaching_focus='Ensino espiritualidade com foco em práticas diárias.' where id=auth.uid();
  perform public.test_assert((select creator_category_id=c from public.profiles where id=auth.uid()), 'direct own update valid only as complete pair');
  perform public.test_assert((select count(*)=0 from public.profiles where id='11111111-1111-4111-8111-111111111111'), 'other profile hidden by RLS');
end; $$;
reset role;
rollback;
\echo 'studio-ideas editorial SQL: no defaults, category, owner, constraints, gates, stale cache and commit protection passed'
