\set ON_ERROR_STOP on

set role qa_user;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from public.prospects) <> 0 then raise exception 'non-admin can read prospects'; end if;
  begin
    insert into public.prospects(channel_id, channel_name) values ('forbidden', 'Forbidden');
    raise exception 'non-admin insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_manual_prospect_event(gen_random_uuid(), 'email', 'note', null);
    raise exception 'non-admin RPC unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'admin role required' then raise; end if;
  end;
end $$;
reset role;

set role qa_admin;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

insert into public.prospects(
  id, channel_id, channel_name, channel_url, contact_email, source_url,
  source_label, researched_at, fit_reason, qualification_score,
  email_subject_draft, email_body_draft, ready_for_outreach
) values (
  '10000000-0000-0000-0000-000000000001', 'creator-one', 'Creator One',
  'https://youtube.com/@creator-one', 'agency@example.com',
  'https://youtube.com/watch?v=evidence-one', 'Vídeo público', now(),
  'Ensina programação com profundidade', 88, 'Assunto manual',
  'Corpo manual', true
);

do $$ begin
  if not exists (
    select 1 from public.prospects where id = '10000000-0000-0000-0000-000000000001'
      and source_label = 'Vídeo público' and ready_for_outreach
  ) then raise exception 'saved prospect did not reopen with persisted fields'; end if;
end $$;

select public.record_manual_prospect_event(
  '10000000-0000-0000-0000-000000000001', 'email', 'copied', null
);
select public.record_manual_prospect_event(
  '10000000-0000-0000-0000-000000000001', 'email', 'sent', 'Operador confirmou'
);

do $$ begin
  if (select status from public.prospects where id = '10000000-0000-0000-0000-000000000001') <> 'contacted'
    then raise exception 'sent RPC did not update status'; end if;
  if (select count(*) from public.prospect_outreach_events where prospect_id = '10000000-0000-0000-0000-000000000001') <> 2
    then raise exception 'event history is incomplete'; end if;
end $$;

insert into public.prospects(
  id, channel_id, channel_name, channel_url, instagram_handle, do_not_contact
) values (
  '10000000-0000-0000-0000-000000000002', 'creator-blocked', 'Creator Blocked',
  'https://instagram.com/creator-blocked', 'creator-blocked', true
);

do $$ begin
  begin
    perform public.record_manual_prospect_event(
      '10000000-0000-0000-0000-000000000002', 'instagram', 'sent', null
    );
    raise exception 'do-not-contact send unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'prospect is missing or marked do not contact' then raise; end if;
  end;
  if exists (
    select 1 from public.prospect_outreach_events
    where prospect_id = '10000000-0000-0000-0000-000000000002'
  ) then raise exception 'failed RPC left an event behind'; end if;
end $$;

-- Same agency e-mail is valid for two distinct public profiles.
insert into public.prospects(channel_id, channel_name, channel_url, contact_email)
values ('creator-two', 'Creator Two', 'https://youtube.com/@creator-two', 'agency@example.com');

do $$ begin
  if (select count(*) from public.prospects where lower(channel_id) = 'legacy-duplicate') <> 2
    then raise exception 'legacy duplicate rows were altered'; end if;
end $$;

reset role;
