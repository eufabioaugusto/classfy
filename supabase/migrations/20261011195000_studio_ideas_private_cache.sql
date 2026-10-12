-- Classy do creator: metadados próprios, cache privado e orçamento transacional.
-- As funções abaixo são acessíveis apenas ao service_role, depois da autenticação
-- e autorização da Edge Function. Não consomem Points, planos ou carteira.
create table public.studio_idea_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('suggest', 'script')),
  cache_key text not null check (length(cache_key) between 1 and 240),
  context_snapshot jsonb not null,
  result jsonb,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'cancelled')),
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lease_until timestamptz not null default (now() + interval '150 seconds'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  check (status <> 'ready' or result is not null)
);
create index studio_idea_jobs_owner_created on public.studio_idea_jobs(owner_id, created_at desc);
create index studio_idea_jobs_cache on public.studio_idea_jobs(owner_id, action, cache_key, created_at desc) where status = 'ready';
create unique index studio_idea_jobs_one_active on public.studio_idea_jobs(owner_id) where status = 'pending';
create table public.studio_idea_requests (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  action text not null check (action in ('suggest', 'script')),
  cache_key text not null,
  job_id uuid not null references public.studio_idea_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(owner_id, request_id)
);
alter table public.studio_idea_jobs enable row level security;
alter table public.studio_idea_requests enable row level security;
create policy studio_idea_jobs_own_read on public.studio_idea_jobs for select to authenticated using (auth.uid() = owner_id);
create policy studio_idea_requests_own_read on public.studio_idea_requests for select to authenticated using (auth.uid() = owner_id);
revoke all on public.studio_idea_jobs, public.studio_idea_requests from anon, authenticated;
grant select on public.studio_idea_jobs, public.studio_idea_requests to authenticated;
grant all on public.studio_idea_jobs, public.studio_idea_requests to service_role;

create function public.studio_ideas_reserve(
  p_owner_id uuid, p_request_id uuid, p_action text, p_cache_key text,
  p_context jsonb, p_refresh boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_request public.studio_idea_requests%rowtype;
  v_job public.studio_idea_jobs%rowtype;
  v_count integer;
  v_suggest_count integer;
  v_retry integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_action not in ('suggest', 'script') or p_cache_key is null or length(p_cache_key) not between 1 and 240 or jsonb_typeof(p_context) <> 'object' then
    raise exception 'invalid_request';
  end if;
  if not exists (
    select 1 from public.user_roles r left join public.profiles p on p.id = r.user_id
    where r.user_id = p_owner_id and (r.role::text = 'admin' or (r.role::text = 'creator' and p.creator_status::text = 'approved'))
  ) then raise exception 'creator_required'; end if;
  -- Serializes budget/cache/idempotency decisions for this owner across instances.
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 913771));
  -- Bound storage without a scheduler; durable scripts live in Studio projects.
  delete from public.studio_idea_jobs where owner_id = p_owner_id and expires_at < v_now - interval '7 days' and status <> 'pending';
  update public.studio_idea_jobs set status = 'failed', failure_code = 'lease_expired', updated_at = v_now
    where owner_id = p_owner_id and status = 'pending' and lease_until <= v_now;
  select * into v_request from public.studio_idea_requests where owner_id = p_owner_id and request_id = p_request_id;
  if found then
    if v_request.action <> p_action or v_request.cache_key <> p_cache_key then return jsonb_build_object('state', 'conflict'); end if;
    select * into v_job from public.studio_idea_jobs where id = v_request.job_id and owner_id = p_owner_id;
    if v_job.status = 'ready' then return jsonb_build_object('state', 'cached', 'result', v_job.result); end if;
    if v_job.status = 'pending' then return jsonb_build_object('state', 'pending', 'retryAfterSeconds', 5); end if;
    return jsonb_build_object('state', 'failed');
  end if;
  if (select count(*) from public.studio_idea_requests where owner_id = p_owner_id and created_at >= v_now - interval '24 hours') >= 120 then
    return jsonb_build_object('state', 'limit', 'retryAfterSeconds', 3600);
  end if;
  if not p_refresh then
    select * into v_job from public.studio_idea_jobs
      where owner_id = p_owner_id and action = p_action and cache_key = p_cache_key and status = 'ready' and expires_at > v_now
      order by created_at desc limit 1;
    if found then
      insert into public.studio_idea_requests(owner_id, request_id, action, cache_key, job_id) values(p_owner_id, p_request_id, p_action, p_cache_key, v_job.id);
      return jsonb_build_object('state', 'cached', 'result', v_job.result);
    end if;
  end if;
  select * into v_job from public.studio_idea_jobs where owner_id = p_owner_id and status = 'pending' limit 1;
  if found then
    -- A retry for the same generation is associated with that job. A different
    -- request can wait without binding its key to another piece of content.
    if v_job.action = p_action and v_job.cache_key = p_cache_key then
      insert into public.studio_idea_requests(owner_id, request_id, action, cache_key, job_id) values(p_owner_id, p_request_id, p_action, p_cache_key, v_job.id);
    end if;
    return jsonb_build_object('state', 'pending', 'retryAfterSeconds', 5);
  end if;
  select count(*), count(*) filter (where action = 'suggest') into v_count, v_suggest_count
    from public.studio_idea_jobs where owner_id = p_owner_id and created_at >= v_now - interval '24 hours';
  if v_count >= 24 or (p_action = 'suggest' and v_suggest_count >= 12) then
    select greatest(1, ceil(extract(epoch from (min(created_at) + interval '24 hours' - v_now)))::integer) into v_retry
      from public.studio_idea_jobs where owner_id = p_owner_id and created_at >= v_now - interval '24 hours' and (v_count >= 24 or action = 'suggest');
    return jsonb_build_object('state', 'limit', 'retryAfterSeconds', v_retry);
  end if;
  if p_refresh and p_action = 'suggest' then
    select * into v_job from public.studio_idea_jobs where owner_id = p_owner_id and action = 'suggest' and created_at > v_now - interval '60 seconds' order by created_at desc limit 1;
    if found then return jsonb_build_object('state', 'limit', 'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_job.created_at + interval '60 seconds' - v_now)))::integer)); end if;
  end if;
  insert into public.studio_idea_jobs(owner_id, action, cache_key, context_snapshot, created_at, updated_at, lease_until, expires_at)
    values(p_owner_id, p_action, p_cache_key, p_context, v_now, v_now, v_now + interval '150 seconds', v_now + case when p_action = 'script' then interval '30 days' else interval '7 days' end)
    returning * into v_job;
  insert into public.studio_idea_requests(owner_id, request_id, action, cache_key, job_id) values(p_owner_id, p_request_id, p_action, p_cache_key, v_job.id);
  return jsonb_build_object('state', 'reserved', 'jobId', v_job.id);
end;
$$;

create function public.studio_ideas_complete(p_owner_id uuid, p_job_id uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_changed integer;
begin
  if jsonb_typeof(p_result) <> 'object' then raise exception 'invalid_result'; end if;
  update public.studio_idea_jobs set status = 'ready', result = p_result, updated_at = clock_timestamp()
    where id = p_job_id and owner_id = p_owner_id and status = 'pending' and lease_until > clock_timestamp();
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;
create function public.studio_ideas_fail(p_owner_id uuid, p_job_id uuid, p_code text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.studio_idea_jobs set status = 'failed', failure_code = left(p_code, 80), updated_at = clock_timestamp()
    where id = p_job_id and owner_id = p_owner_id and status = 'pending';
$$;
create function public.studio_ideas_cancel(p_owner_id uuid, p_request_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.studio_idea_jobs j set status = 'cancelled', failure_code = 'generation_cancelled', updated_at = clock_timestamp()
    from public.studio_idea_requests r
    where r.owner_id = p_owner_id and r.request_id = p_request_id and j.id = r.job_id and j.owner_id = p_owner_id and j.status = 'pending';
$$;
revoke all on function public.studio_ideas_reserve(uuid, uuid, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.studio_ideas_complete(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.studio_ideas_fail(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.studio_ideas_cancel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.studio_ideas_reserve(uuid, uuid, text, text, jsonb, boolean) to service_role;
grant execute on function public.studio_ideas_complete(uuid, uuid, jsonb) to service_role;
grant execute on function public.studio_ideas_fail(uuid, uuid, text) to service_role;
grant execute on function public.studio_ideas_cancel(uuid, uuid) to service_role;
