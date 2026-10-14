-- Native rollback fixture only: never run this file against production.
SELECT set_config('request.jwt.claim.role','service_role',false);
INSERT INTO studio_camera_monitor_sessions(id,owner_id,device_id,kind,title,state,status,closed_at)
 VALUES('60000000-0000-4000-8000-00000000fc01','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-00000000fc01','aula','Private first account',
  '{"recording":false,"elapsedSeconds":0,"width":3840,"height":2160,"fps":30,"cameraFacing":"back"}','closed',now()),
 ('60000000-0000-4000-8000-00000000fc02','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-00000000fc02','short','Private second account',
  '{"recording":true,"elapsedSeconds":7,"width":2160,"height":3840,"fps":30,"cameraFacing":"front"}','closed',now());
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='studio_camera_monitor_sessions')<>1
  THEN RAISE EXCEPTION 'Realtime monitor publication duplicated or absent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='profiles')
  THEN RAISE EXCEPTION 'Existing publication tables were changed'; END IF;
 IF (SELECT attnames FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='studio_camera_monitor_sessions')
   <>ARRAY['id','owner_id','status','created_at','expires_at','device_seen_at','closed_at']::name[]
  THEN RAISE EXCEPTION 'Realtime publication exposed additional camera columns'; END IF;
 IF has_table_privilege('authenticated','public.studio_camera_monitor_sessions','INSERT,UPDATE,DELETE') OR
    has_table_privilege('authenticated','public.studio_camera_monitor_sessions','SELECT') OR
    has_column_privilege('authenticated','public.studio_camera_monitor_sessions','device_id','SELECT') OR
    has_column_privilege('authenticated','public.studio_camera_monitor_sessions','state','SELECT') OR
    has_column_privilege('authenticated','public.studio_camera_monitor_sessions','title','SELECT') OR
    has_column_privilege('anon','public.studio_camera_monitor_sessions','id','SELECT') OR
    has_function_privilege('authenticated','public.studio_camera_monitor_action(uuid,text,jsonb)','EXECUTE') OR
    has_function_privilege('anon','public.studio_camera_monitor_viewer_allowed()','EXECUTE')
  THEN RAISE EXCEPTION 'Realtime added writes, private columns, public entitlement or RPC access'; END IF;
 IF NOT has_column_privilege('authenticated','public.studio_camera_monitor_sessions','id','SELECT') OR
    NOT has_table_privilege('service_role','public.studio_camera_monitor_sessions','SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'Discovery metadata or service authority was removed'; END IF;
END $$;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF NOT public.studio_camera_monitor_viewer_allowed() THEN RAISE EXCEPTION 'Eligible creator could not discover own monitor'; END IF;
 IF (SELECT count(id) FROM public.studio_camera_monitor_sessions WHERE id='60000000-0000-4000-8000-00000000fc01')<>1 OR
    (SELECT count(id) FROM public.studio_camera_monitor_sessions WHERE owner_id<>auth.uid())<>0 OR
    (SELECT count(id) FROM public.studio_camera_monitor_sessions WHERE id='60000000-0000-4000-8000-00000000fc02')<>0
  THEN RAISE EXCEPTION 'Monitor owner RLS did not isolate accounts'; END IF;
 BEGIN PERFORM state FROM public.studio_camera_monitor_sessions; RAISE EXCEPTION 'Private state read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.studio_camera_monitor_sessions SET status='active'; RAISE EXCEPTION 'Direct monitor write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(id) FROM public.studio_camera_monitor_sessions WHERE id='60000000-0000-4000-8000-00000000fc02')<>1 OR
    (SELECT count(id) FROM public.studio_camera_monitor_sessions WHERE owner_id<>auth.uid())<>0
  THEN RAISE EXCEPTION 'Second eligible account crossed owner RLS'; END IF;
END $$;
RESET ROLE;

UPDATE profiles SET plan_expires_at=now()-interval '1 second' WHERE id='10000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.studio_camera_monitor_viewer_allowed() OR (SELECT count(id) FROM public.studio_camera_monitor_sessions)<>0
  THEN RAISE EXCEPTION 'Expired Premium remained eligible for discovery'; END IF;
END $$;
RESET ROLE;
UPDATE profiles SET plan='free',plan_expires_at=now()+interval '1 day' WHERE id='10000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
 IF public.studio_camera_monitor_viewer_allowed() OR (SELECT count(id) FROM public.studio_camera_monitor_sessions)<>0
  THEN RAISE EXCEPTION 'Free creator remained eligible for discovery'; END IF;
END $$;
RESET ROLE;
UPDATE profiles SET plan='premium',creator_status='pending' WHERE id='10000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
 IF public.studio_camera_monitor_viewer_allowed() OR (SELECT count(id) FROM public.studio_camera_monitor_sessions)<>0
  THEN RAISE EXCEPTION 'Unapproved creator remained eligible for discovery'; END IF;
END $$;
RESET ROLE;
UPDATE profiles SET plan_expires_at=now()+interval '1 day',creator_status='approved' WHERE id='10000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF public.studio_camera_monitor_viewer_allowed() OR (SELECT count(id) FROM public.studio_camera_monitor_sessions)<>0
  THEN RAISE EXCEPTION 'Missing authenticated subject could discover monitors'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',false);
