-- Manual-first prospecting workspace. This migration is additive and does not
-- delete or rewrite the existing test prospects.
alter table public.prospects
  add column if not exists source_url text,
  add column if not exists source_label text,
  add column if not exists researched_at timestamptz,
  add column if not exists research_summary text,
  add column if not exists fit_reason text,
  add column if not exists teaching_topics text[] not null default '{}',
  add column if not exists qualification_score integer,
  add column if not exists qualification_notes text,
  add column if not exists email_subject_draft text,
  add column if not exists email_body_draft text,
  add column if not exists dm_draft text,
  add column if not exists ready_for_outreach boolean not null default false,
  add column if not exists do_not_contact boolean not null default false;

alter table public.prospects
  drop constraint if exists prospects_qualification_score_check;
alter table public.prospects
  add constraint prospects_qualification_score_check
  check (qualification_score is null or qualification_score between 0 and 100);

-- Non-unique indexes are safe when legacy rows already contain duplicates.
-- The trigger below rejects only new duplicates, preserving legacy rows for a
-- deliberate review instead of silently merging or making this migration fail.
create index if not exists prospects_channel_id_normalized_idx
  on public.prospects (lower(btrim(channel_id))) where channel_id is not null;
create index if not exists prospects_channel_url_normalized_idx
  on public.prospects (lower(rtrim(btrim(channel_url), '/'))) where channel_url is not null;

create or replace function public.prevent_duplicate_prospect_profile()
returns trigger language plpgsql set search_path = public as $$
declare
  identity_key text;
  identity_keys text[] := array[]::text[];
begin
  -- Serialize contenders for the same normalized identities. A plain SELECT in
  -- a trigger is racy: concurrent inserts can both observe no matching row.
  -- Sorting the keys gives a stable lock order when both id and URL are present.
  if new.channel_id is not null then
    identity_keys := array_append(identity_keys, 'id:' || lower(btrim(new.channel_id)));
  end if;
  if new.channel_url is not null then
    identity_keys := array_append(identity_keys, 'url:' || lower(rtrim(btrim(new.channel_url), '/')));
  end if;
  for identity_key in select unnest(identity_keys) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(identity_key, 20261004));
  end loop;

  if new.channel_id is not null and exists (
    select 1 from public.prospects p
    where p.id <> new.id and lower(btrim(p.channel_id)) = lower(btrim(new.channel_id))
  ) then raise exception 'duplicate prospect channel_id'; end if;
  if new.channel_url is not null and exists (
    select 1 from public.prospects p
    where p.id <> new.id and lower(rtrim(btrim(p.channel_url), '/')) = lower(rtrim(btrim(new.channel_url), '/'))
  ) then raise exception 'duplicate prospect channel_url'; end if;
  return new;
end;
$$;

drop trigger if exists prospects_prevent_duplicate_profile on public.prospects;
create trigger prospects_prevent_duplicate_profile
before insert or update of channel_id, channel_url on public.prospects
for each row execute function public.prevent_duplicate_prospect_profile();

alter table public.prospects enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'prospects' and policyname = 'Admins manage prospects'
  ) then
    create policy "Admins manage prospects" on public.prospects for all
      using (public.has_role(auth.uid(), 'admin'))
      with check (public.has_role(auth.uid(), 'admin'));
  end if;
end $$;

create table if not exists public.prospect_outreach_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  channel text not null check (channel in ('email', 'instagram', 'other')),
  event_type text not null check (event_type in ('prepared', 'copied', 'opened', 'sent', 'replied', 'note')),
  note text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.prospect_outreach_events enable row level security;

create policy "Admins manage prospect outreach events"
on public.prospect_outreach_events for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));
grant select, insert on public.prospect_outreach_events to authenticated;

comment on table public.prospect_outreach_events is
  'Manual audit trail only. No row in this table triggers an external message.';

create or replace function public.record_manual_prospect_event(
  p_prospect_id uuid,
  p_channel text,
  p_event_type text,
  p_note text default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required';
  end if;
  if p_channel not in ('email', 'instagram', 'other')
    or p_event_type not in ('prepared', 'copied', 'opened', 'sent', 'replied', 'note') then
    raise exception 'invalid prospect event';
  end if;

  insert into public.prospect_outreach_events
    (prospect_id, channel, event_type, note, created_by)
  values (p_prospect_id, p_channel, p_event_type, p_note, auth.uid());

  if p_event_type = 'sent' then
    update public.prospects set
      status = case when p_channel = 'email' then 'contacted' else 'dm_sent' end,
      outreach_channel = p_channel,
      contacted_at = now(),
      updated_at = now()
    where id = p_prospect_id and do_not_contact = false;
    if not found then raise exception 'prospect is missing or marked do not contact'; end if;
  end if;
end;
$$;

revoke all on function public.record_manual_prospect_event(uuid, text, text, text) from public;
grant execute on function public.record_manual_prospect_event(uuid, text, text, text) to authenticated;
