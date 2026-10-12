-- Perfil editorial confirmado: não preenche nenhum creator automaticamente.
insert into public.categories(name, slug, description)
values ('Espiritualidade', 'espiritualidade', 'Reflexões e práticas sobre espiritualidade e desenvolvimento interior.')
on conflict(slug) do nothing;

alter table public.profiles
  add column creator_category_id uuid references public.categories(id) on delete restrict,
  add column creator_teaching_focus text;
alter table public.profiles add constraint creator_editorial_pair_valid check (
  (creator_category_id is null and creator_teaching_focus is null)
  or (creator_category_id is not null and creator_teaching_focus is not null and char_length(btrim(creator_teaching_focus)) between 12 and 280)
);
create index profiles_creator_category on public.profiles(creator_category_id) where creator_category_id is not null;

-- The same per-owner lock protects saves, budget reservations and commits.
create function public.studio_ideas_lock_editorial_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.creator_category_id is distinct from old.creator_category_id
    or new.creator_teaching_focus is distinct from old.creator_teaching_focus
    or new.bio is distinct from old.bio or new.creator_bio is distinct from old.creator_bio then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 913771));
  end if;
  return new;
end;
$$;
revoke all on function public.studio_ideas_lock_editorial_change() from public, anon, authenticated;
create trigger studio_ideas_lock_editorial_change
before update of creator_category_id, creator_teaching_focus, bio, creator_bio on public.profiles
for each row execute function public.studio_ideas_lock_editorial_change();

create function public.studio_ideas_editorial_revision(p_owner_id uuid) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('categoryId', p.creator_category_id, 'categoryName', c.name,
    'teachingFocus', coalesce(p.creator_teaching_focus, ''), 'bio', coalesce(p.bio, ''), 'creatorBio', coalesce(p.creator_bio, ''))
    from public.profiles p left join public.categories c on c.id = p.creator_category_id where p.id = p_owner_id;
$$;
revoke all on function public.studio_ideas_editorial_revision(uuid) from public, anon, authenticated;
grant execute on function public.studio_ideas_editorial_revision(uuid) to service_role;

create function public.studio_ideas_save_editorial(p_owner_id uuid, p_category_id uuid, p_teaching_focus text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.user_roles r left join public.profiles p on p.id = r.user_id
    where r.user_id = p_owner_id and (r.role::text = 'admin' or (r.role::text = 'creator' and p.creator_status::text = 'approved')))
    then raise exception 'creator_required'; end if;
  if p_category_id is null or p_teaching_focus is null or char_length(btrim(p_teaching_focus)) not between 12 and 280
    then raise exception 'invalid_editorial'; end if;
  if not exists(select 1 from public.categories where id = p_category_id) then raise exception 'category_not_found'; end if;
  perform 1 from public.profiles where id = p_owner_id for update;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 913771));
  update public.profiles set creator_category_id = p_category_id, creator_teaching_focus = btrim(p_teaching_focus), updated_at = clock_timestamp()
    where id = p_owner_id;
end;
$$;
revoke all on function public.studio_ideas_save_editorial(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.studio_ideas_save_editorial(uuid,uuid,text) to service_role;

create function public.studio_ideas_reserve_editorial(
  p_owner_id uuid, p_request_id uuid, p_action text, p_cache_key text, p_context jsonb, p_refresh boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_revision jsonb;
begin
  perform 1 from public.profiles where id = p_owner_id for update;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 913771));
  v_revision := public.studio_ideas_editorial_revision(p_owner_id);
  if v_revision->>'categoryId' is null or char_length(btrim(v_revision->>'teachingFocus')) not between 12 and 280
    then raise exception 'editorial_required'; end if;
  if p_context->'editorialRevision' is distinct from v_revision or p_context->'editorial'->>'ready' is distinct from 'true'
    then raise exception 'editorial_context_changed'; end if;
  return public.studio_ideas_reserve(p_owner_id,p_request_id,p_action,p_cache_key,p_context,p_refresh);
end;
$$;
revoke all on function public.studio_ideas_reserve_editorial(uuid,uuid,text,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.studio_ideas_reserve_editorial(uuid,uuid,text,text,jsonb,boolean) to service_role;

-- Replaces only the final commit guard; completed legacy cache stays private but
-- cannot be used by the v2 API and a legacy pending job cannot be committed.
create or replace function public.studio_ideas_complete(p_owner_id uuid, p_job_id uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_changed integer; v_revision jsonb;
begin
  if jsonb_typeof(p_result) <> 'object' then raise exception 'invalid_result'; end if;
  perform 1 from public.profiles where id = p_owner_id for update;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 913771));
  v_revision := public.studio_ideas_editorial_revision(p_owner_id);
  update public.studio_idea_jobs set status = 'ready', result = p_result, updated_at = clock_timestamp()
    where id = p_job_id and owner_id = p_owner_id and status = 'pending' and lease_until > clock_timestamp()
      and context_snapshot->'editorial'->>'ready' = 'true'
      and v_revision->>'categoryId' is not null
      and char_length(btrim(v_revision->>'teachingFocus')) between 12 and 280
      and context_snapshot->'editorialRevision' = v_revision;
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;
