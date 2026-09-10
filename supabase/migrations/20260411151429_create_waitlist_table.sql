
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  type text not null check (type in ('creator', 'consumer')),
  niche text,
  social_url text,
  followers_range text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Qualquer pessoa pode inserir (LP pública)
create policy "waitlist_insert_public"
  on public.waitlist for insert
  to anon
  with check (true);

-- Apenas admins leem
create policy "waitlist_select_admin"
  on public.waitlist for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'admin'
    )
  );
;
