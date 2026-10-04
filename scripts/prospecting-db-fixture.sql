create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create type public.app_role as enum ('admin', 'creator', 'user');
create table public.user_roles (
  user_id uuid not null references auth.users(id),
  role public.app_role not null,
  primary key (user_id, role)
);
create function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  channel_id text,
  channel_name text not null,
  channel_url text,
  contact_email text,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  instagram_handle text,
  niche text,
  notes text,
  outreach_channel text,
  score integer,
  size_tier text,
  status text not null default 'pending',
  subscriber_count bigint,
  template_used text,
  updated_at timestamptz not null default now(),
  video_count bigint,
  view_count bigint
);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'qa_admin') then create role qa_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'qa_user') then create role qa_user nologin; end if;
end $$;
grant authenticated to qa_admin, qa_user;
grant usage on schema public, auth to qa_admin, qa_user;
grant select, insert, update, delete on public.prospects to qa_admin, qa_user;
grant select on auth.users, public.user_roles to qa_admin, qa_user;
grant execute on function auth.uid(), public.has_role(uuid, public.app_role) to qa_admin, qa_user;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
insert into public.user_roles(user_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'admin');

-- A legacy duplicate pair proves the additive migration does not fail or merge.
insert into public.prospects(channel_id, channel_name, channel_url) values
  ('legacy-duplicate', 'Legacy A', 'https://youtube.com/@legacy'),
  ('LEGACY-DUPLICATE', 'Legacy B', 'https://youtube.com/@legacy/');
