SELECT set_config('request.jwt.claim.role','service_role',false);
CREATE OR REPLACE FUNCTION pg_temp.expect_monitor_failure(p_query text,p_code text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE p_query; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>p_code THEN RAISE EXCEPTION 'Expected %, received %',p_code,SQLERRM; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'Expected rejection %',p_code;
END $$;
DO $test$
DECLARE u uuid:='10000000-0000-4000-8000-000000000001'; free_user uuid:='10000000-0000-4000-8000-000000000002';
 other_user uuid:='10000000-0000-4000-8000-000000000003';
 d uuid:='30000000-0000-4000-8000-00000000fa01'; c uuid:='20000000-0000-4000-8000-00000000fa01';
 viewer uuid:='20000000-0000-4000-8000-00000000fa02'; m uuid:='60000000-0000-4000-8000-00000000fa01';
 m2 uuid:='60000000-0000-4000-8000-00000000fa02'; remote_id uuid; response jsonb; before_expiry timestamptz;
 action text; state jsonb;
BEGIN
 INSERT INTO auth.users VALUES(other_user);
 INSERT INTO profiles(id,plan,plan_expires_at,subscription_status,creator_status) VALUES(other_user,'premium',now()+interval '1 day','active','approved');
 INSERT INTO user_roles VALUES(other_user,'creator');
 UPDATE profiles SET plan='free',plan_expires_at=NULL,subscription_status='expired' WHERE id=free_user;
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',free_user,'monitor-discover','{}'),'studio_camera_premium_required');
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-create',jsonb_build_object('sessionId',m,'deviceId',d,'title','Teste')),'studio_camera_invalid_request');
 INSERT INTO studio_camera_pairings(owner_id,controller_id,device_id) VALUES(u,c,d);
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',c,'pairingHash',repeat('b',64)));
 remote_id:=(response#>>'{session,id}')::uuid;
 UPDATE studio_camera_sessions SET status='recording',active_take_id=gen_random_uuid(),device_state='{"recording":true}' WHERE id=remote_id;
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-create',jsonb_build_object('sessionId',m,'deviceId',d,'kind','aula','title','Teste')),'studio_camera_busy');
 UPDATE studio_camera_sessions SET status='ready',active_take_id=NULL,device_state='{"uploadState":"paused"}' WHERE id=remote_id;
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status) VALUES(gen_random_uuid(),remote_id,u,'local_ready');
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-create',jsonb_build_object('sessionId',m,'deviceId',d,'kind','aula','title','Teste')),'studio_camera_pending_upload');
 UPDATE studio_camera_sessions SET device_state='{}' WHERE id=remote_id;
 response:=studio_camera_monitor_action(u,'monitor-create',jsonb_build_object('sessionId',m,'deviceId',d,'kind','aula','title','Teste'));
 IF response#>>'{monitor,id}'<>m::text OR response#>>'{monitor,status}'<>'active' OR response#>'{monitor,state}'<>'null'::jsonb OR response ? 'session' OR response ? 'takes' OR response ? 'commands'
  THEN RAISE EXCEPTION 'Monitor leaked remote controller envelope'; END IF;
 IF response->'_roomsToClose'<>jsonb_build_array(remote_id::text) OR (SELECT status FROM studio_camera_sessions WHERE id=remote_id)<>'closed'
  THEN RAISE EXCEPTION 'Idle remote room did not retire before monitor acquired device'; END IF;
 IF (SELECT count(*) FROM studio_camera_takes WHERE session_id=remote_id)<>1 THEN RAISE EXCEPTION 'Monitor deleted existing original'; END IF;
 response:=studio_camera_monitor_action(u,'monitor-create',jsonb_build_object('sessionId',m,'deviceId',d,'kind','aula','title','Teste'));
 IF (SELECT count(*) FROM studio_camera_monitor_sessions WHERE owner_id=u AND status='active')<>1 THEN RAISE EXCEPTION 'Create was not idempotent'; END IF;
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-create',jsonb_build_object('sessionId',m2,'deviceId',d,'kind','short','title','Outro')),'studio_camera_monitor_busy');
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',other_user,'monitor-connect',jsonb_build_object('sessionId',m,'role','viewer','clientId',viewer)),'studio_camera_not_found');
 IF studio_camera_monitor_action(other_user,'monitor-discover','{}')->'monitor'<>'null'::jsonb THEN RAISE EXCEPTION 'Discovery leaked account'; END IF;
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-connect',jsonb_build_object('sessionId',m,'role','device','clientId',viewer)),'studio_camera_client_mismatch');
 PERFORM studio_camera_monitor_action(u,'monitor-connect',jsonb_build_object('sessionId',m,'role','viewer','clientId',viewer));
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-connect',jsonb_build_object('sessionId',m,'clientId',viewer)),'studio_camera_client_mismatch');
 FOR action IN SELECT unnest(ARRAY['command','ack','upload-start','upload-complete','download','close']) LOOP
  PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_action(%L,%L,%L)',u,action,jsonb_build_object('sessionId',m)),'studio_camera_not_found');
 END LOOP;
 FOR action IN SELECT unnest(ARRAY['create','discover','connect','command']) LOOP
  PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_action(%L,%L,%L)',u,action,
   jsonb_build_object('kind','aula','controllerId',c,'pairingHash',repeat('c',64),'deviceId',d,'sessionId',remote_id,'role','device','clientId',d,
    'commandId',gen_random_uuid(),'type','resume_upload','payload',jsonb_build_object('takeId',gen_random_uuid()))),'studio_camera_monitor_conflict');
 END LOOP;
 state:='{"recording":true,"elapsedSeconds":4,"width":3840,"height":2160,"fps":30,"cameraFacing":"back"}';
 PERFORM studio_camera_monitor_action(u,'monitor-heartbeat',jsonb_build_object('sessionId',m,'role','device','clientId',d,'state',state));
 SELECT expires_at INTO before_expiry FROM studio_camera_monitor_sessions WHERE id=m;
 PERFORM studio_camera_monitor_action(u,'monitor-heartbeat',jsonb_build_object('sessionId',m,'role','device','clientId',d));
 IF (SELECT s.state FROM studio_camera_monitor_sessions s WHERE s.id=m)<>state THEN RAISE EXCEPTION 'Empty heartbeat reset REC state'; END IF;
 PERFORM studio_camera_monitor_action(u,'monitor-heartbeat',jsonb_build_object('sessionId',m,'role','viewer','clientId',viewer));
 IF (SELECT expires_at FROM studio_camera_monitor_sessions WHERE id=m)<>before_expiry THEN RAISE EXCEPTION 'Viewer prolonged publisher lease'; END IF;
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-heartbeat',jsonb_build_object('sessionId',m,'role','viewer','clientId',viewer,'state','{}'::jsonb)),'studio_camera_invalid_request');
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-heartbeat',jsonb_build_object('sessionId',m,'role','device','clientId',d,'state','{"token":"secret"}'::jsonb)),'studio_camera_invalid_request');
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-heartbeat',jsonb_build_object('sessionId',m,'role','device','clientId',d,'state','{"elapsedSeconds":-1}'::jsonb)),'studio_camera_invalid_request');
 -- Expiring preview never stops or mutates the phone's latest local REC state.
 UPDATE studio_camera_monitor_sessions SET expires_at=now()-interval '1 second' WHERE id=m;
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-heartbeat',jsonb_build_object('sessionId',m,'role','device','clientId',d)),'studio_camera_monitor_expired');
 response:=studio_camera_monitor_action(u,'monitor-discover','{}');
 IF response->'monitor'<>'null'::jsonb OR response->'_monitorRoomsToClose'<>jsonb_build_array(m::text) OR
    (SELECT s.state->>'recording' FROM studio_camera_monitor_sessions s WHERE s.id=m)<>'true'
  THEN RAISE EXCEPTION 'Expired monitor did not release preview-only authority'; END IF;
 PERFORM studio_camera_monitor_action(u,'monitor-create',jsonb_build_object('sessionId',m2,'deviceId',d,'kind','short','title','Outro'));
 PERFORM studio_camera_monitor_action(u,'monitor-heartbeat',jsonb_build_object('sessionId',m2,'role','device','clientId',d,'state',state));
 UPDATE profiles SET plan='free',plan_expires_at=NULL WHERE id=u;
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-connect',jsonb_build_object('sessionId',m2,'role','viewer','clientId',viewer)),'studio_camera_premium_required');
 PERFORM pg_temp.expect_monitor_failure(format('SELECT studio_camera_monitor_action(%L,%L,%L)',u,'monitor-heartbeat',jsonb_build_object('sessionId',m2,'role','device','clientId',d)),'studio_camera_premium_required');
 -- Closing remains available after Premium expires, including while phone REC runs.
 response:=studio_camera_monitor_action(u,'monitor-close',jsonb_build_object('sessionId',m2,'deviceId',d));
 IF response#>>'{monitor,status}'<>'closed' OR response#>>'{monitor,state,recording}'<>'true' THEN RAISE EXCEPTION 'Close changed local REC'; END IF;
 UPDATE profiles SET plan='premium',plan_expires_at=now()+interval '1 day' WHERE id=u;
 IF has_table_privilege('authenticated','public.studio_camera_monitor_sessions','SELECT') OR
    has_function_privilege('authenticated','public.studio_camera_monitor_action(uuid,text,jsonb)','EXECUTE') OR
    has_function_privilege('authenticated','public.studio_camera_control_action(uuid,text,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'Client gained direct monitor/controller SQL access'; END IF;
END $test$;
