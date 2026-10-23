-- Primary PostgreSQL regression: optional local originals never erase recovery.
-- Run after the camera, monitor and local-take handoff migrations in an isolated DB.
SELECT set_config('request.jwt.claim.role','service_role',false);
BEGIN;
CREATE FUNCTION pg_temp.expect_local_handoff_error(p_sql text,p_error text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE p_sql; RAISE EXCEPTION 'Expected local handoff failure: %',p_error;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>p_error THEN RAISE; END IF; END;
END $$;
DO $test$
DECLARE
 u uuid:='10000000-0000-4000-8000-00000000fc01'; other_u uuid:='10000000-0000-4000-8000-00000000fc02';
 ca uuid:='20000000-0000-4000-8000-00000000fc01'; cb uuid:='20000000-0000-4000-8000-00000000fc02';
 d uuid:='30000000-0000-4000-8000-00000000fc01';
 a uuid; b uuid; fresh uuid; foreign_session uuid; take uuid; first_take uuid; extra uuid; command uuid;
 metadata jsonb:='{"bytes":2747000000,"mime":"video/quicktime","width":3840,"height":2160,"fps":30,"duration":777}';
 state jsonb; catalog jsonb:='[]'; original_state jsonb; receipt jsonb; response jsonb; rooms jsonb;
 flag jsonb; bad jsonb; transition text; pending_type text; i integer; before_parts bigint;
BEGIN
 INSERT INTO auth.users(id) VALUES(u),(other_u);
 INSERT INTO profiles(id,plan,plan_expires_at,subscription_status,creator_status)
  VALUES(u,'premium',now()+interval '1 day','active','approved'),(other_u,'premium',now()+interval '1 day','active','approved');
 INSERT INTO user_roles(user_id,role) VALUES(u,'creator'),(other_u,'creator');
 INSERT INTO studio_camera_pairings(owner_id,controller_id,device_id) VALUES(u,ca,d),(u,cb,d);
 INSERT INTO studio_camera_sessions(owner_id,controller_id,device_id,paired_at,kind,status,created_at)
  VALUES(u,ca,d,now(),'aula','ready',now()-interval '1 day') RETURNING id INTO a;
 INSERT INTO studio_camera_sessions(owner_id,controller_id,device_id,paired_at,kind,status,created_at)
  VALUES(u,cb,d,now(),'short','ready',now()) RETURNING id INTO b;
 -- A bounded heartbeat lists only the 12 most recent files. Older STOP ACKs
 -- remain valid local-save receipts, even with no final graded upload metadata.
 FOR i IN 1..30 LOOP
  take:=md5('local-first-take-'||i)::uuid;
  INSERT INTO studio_camera_takes(id,session_id,owner_id,status) VALUES(take,a,u,'local_ready');
  IF i=1 THEN first_take:=take; END IF;
  IF i<=18 THEN
   INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload,status,result,acknowledged_at)
    VALUES(md5('local-first-stop-'||i)::uuid,a,i,'stop',jsonb_build_object('takeId',take),'applied',
     jsonb_build_object('ok',true,'takeId',take,'state',jsonb_build_object('capabilities',jsonb_build_object('localTakeStorage',1),
      'localTakes',jsonb_build_array(jsonb_build_object('id',take,'metadata',metadata,'localSaved',true,'phase','local_ready')))),now());
  ELSE
   catalog:=catalog||jsonb_build_array(jsonb_build_object('id',take,'metadata',metadata,'localSaved',true,'phase','local_ready'));
  END IF;
 END LOOP;
 state:=jsonb_build_object('capabilities',jsonb_build_object('localTakeStorage',1),'recording',false,'processing',false,
  'uploading',false,'uploadState','paused','localTakes',catalog);
 UPDATE studio_camera_sessions SET sequence=18,device_state=state,device_seen_at=now() WHERE id=a;
 IF NOT studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION '30 durable originals were pinned by bounded catalog'; END IF;
 FOREACH flag IN ARRAY ARRAY[jsonb_build_object('deviceId',d,'controllerId',ca),jsonb_build_object('deviceId',d,'controllerId',cb),jsonb_build_object('deviceId',d)] LOOP
  response:=studio_camera_action(u,'discover',flag);
  IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Optional paused originals hid the newer room'; END IF;
 END LOOP;
 -- Each pending take needs its own valid proof: never borrow another take,
 -- session or owner's receipt, and never coerce booleans/versions from strings.
 SELECT c.result INTO receipt FROM studio_camera_commands c WHERE c.session_id=a AND c.payload->>'takeId'=first_take::text;
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  receipt#-'{state,localTakes,0,localSaved}',jsonb_set(receipt,'{state,localTakes,0,localSaved}','"true"'),
  receipt||'{"ok":false}',receipt||'{"takeId":"unrelated"}',
  jsonb_set(receipt,'{state,localTakes,0,id}','"unrelated"'),
  receipt#-'{state,localTakes,0,metadata,duration}',
  jsonb_set(receipt,'{state,localTakes,0,metadata,bytes}','"2747000000"'),
  jsonb_set(receipt,'{state,localTakes,0,metadata,mime}','null'),
  jsonb_set(receipt,'{state,localTakes,0,metadata,width}','0'),
  jsonb_set(receipt,'{state,localTakes,0,metadata,fps}','121'),
  jsonb_set(receipt,'{state,capabilities,localTakeStorage}','"1"'))) LOOP
  UPDATE studio_camera_commands SET result=bad WHERE session_id=a AND payload->>'takeId'=first_take::text;
  IF studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Missing or malformed old receipt bypassed recovery'; END IF;
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',cb));
  IF response#>>'{session,id}'<>a::text THEN RAISE EXCEPTION 'Incomplete local proof lost recovery priority'; END IF;
  PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
   jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_pending_upload');
 END LOOP;
 UPDATE studio_camera_commands SET status='failed' WHERE session_id=a AND payload->>'takeId'=first_take::text;
 IF studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Failed receipt counted as saved'; END IF;
 UPDATE studio_camera_commands c SET result=receipt,status='applied' WHERE c.session_id=a AND c.payload->>'takeId'=first_take::text;
 SELECT c.id INTO command FROM studio_camera_commands c WHERE c.session_id=a AND c.payload->>'takeId'=first_take::text;
 UPDATE studio_camera_commands SET session_id=b WHERE id=command AND session_id=a;
 IF studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Another session receipt counted as saved'; END IF;
 UPDATE studio_camera_commands SET session_id=a WHERE id=command AND session_id=b;
 UPDATE studio_camera_takes SET owner_id=other_u WHERE session_id=a AND id=first_take;
 IF studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Another owner original counted as saved'; END IF;
 UPDATE studio_camera_takes SET owner_id=u WHERE session_id=a AND id=first_take;
 -- No capability means legacy semantics, regardless of a well-shaped catalog.
 FOR flag IN SELECT value FROM jsonb_array_elements('[{}, {"localTakeStorage":true}, {"localTakeStorage":"1"}, {"localTakeStorage":2}]') LOOP
  UPDATE studio_camera_sessions SET device_state=jsonb_set(state,'{capabilities}',flag) WHERE id=a;
  IF studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Legacy or unknown capability bypassed recovery'; END IF;
  PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
   jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_pending_upload');
 END LOOP;
 UPDATE studio_camera_sessions SET device_state=state WHERE id=a;
 -- Preserve every existing physical/transfer transition even with valid proof.
 FOREACH transition IN ARRAY ARRAY['starting','recording','stopping'] LOOP
  UPDATE studio_camera_sessions SET status=transition WHERE id=a;
  PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
   jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_busy');
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
  IF response#>>'{session,id}'<>a::text THEN RAISE EXCEPTION 'Local proof hid active REC'; END IF;
 END LOOP;
 UPDATE studio_camera_sessions SET status='ready',active_take_id=first_take WHERE id=a;
 PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
  jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_busy');
 UPDATE studio_camera_sessions SET active_take_id=NULL WHERE id=a;
 FOR flag IN SELECT value FROM jsonb_array_elements('[{"recording":true},{"processing":true},{"uploading":true},{"uploadState":"uploading"}]') LOOP
  UPDATE studio_camera_sessions SET device_state=state||flag WHERE id=a;
  PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
   jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_busy');
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
  IF response#>>'{session,id}'<>a::text THEN RAISE EXCEPTION 'Local proof hid active processing/transfer'; END IF;
 END LOOP;
 UPDATE studio_camera_sessions SET device_state=state WHERE id=a;
 FOREACH pending_type IN ARRAY ARRAY['start','stop','resume_upload'] LOOP
  INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload) VALUES(md5('local-first-pending')::uuid,a,19,pending_type,jsonb_build_object('takeId',first_take));
  PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
   jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_busy');
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
  IF response#>>'{session,id}'<>a::text THEN RAISE EXCEPTION 'Local proof hid pending physical command'; END IF;
  DELETE FROM studio_camera_commands WHERE session_id=a AND sequence=19;
 END LOOP;
 UPDATE studio_camera_takes SET status='recording' WHERE session_id=a AND id=first_take;
 PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
  jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_busy');
 UPDATE studio_camera_takes SET status='local_ready' WHERE session_id=a AND id=first_take;
 -- A server upload row can be left behind by an optional paused upload. Current
 -- device activity still wins; a durable paused row alone no longer pins it.
 UPDATE studio_camera_takes SET status='uploading' WHERE session_id=a AND id=first_take;
 IF NOT studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Paused optional legacy upload row pinned durable original'; END IF;
 UPDATE studio_camera_sessions SET device_state=state||'{"uploading":true}' WHERE id=a;
 PERFORM pg_temp.expect_local_handoff_error(format('SELECT studio_camera_action(%L,%L,%L)',u,'create',
  jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('c',64))), 'studio_camera_busy');
 UPDATE studio_camera_sessions SET device_state=state WHERE id=a;
 -- Latest catalog cannot lie about one unsaved file, or active preparation.
 UPDATE studio_camera_sessions SET device_state=jsonb_set(state,'{localTakes,11,localSaved}','false') WHERE id=a;
 IF studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Unsaved recent original bypassed recovery'; END IF;
 UPDATE studio_camera_sessions SET device_state=jsonb_set(state,'{localTakes,11,phase}','"preparing"') WHERE id=a;
 IF studio_camera_local_handoff_allowed(a) THEN RAISE EXCEPTION 'Active preparation bypassed recovery'; END IF;
 UPDATE studio_camera_sessions SET device_state=state WHERE id=a;
 -- Retiring closes authority only: bytes, receipts and pairings remain intact.
 INSERT INTO studio_camera_sessions(owner_id,controller_id,device_id,paired_at,kind,status,device_state)
  VALUES(other_u,ca,d,now(),'aula','recording','{"recording":true}') RETURNING id INTO foreign_session;
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('studio-camera-originals','local-first-fixture-part','{"size":6291456}');
 SELECT count(*) INTO before_parts FROM storage.objects WHERE name='local-first-fixture-part';
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','short','controllerId',ca,'pairingHash',repeat('d',64)));
 fresh:=(response#>>'{session,id}')::uuid; rooms:=response->'_roomsToClose';
 IF response#>>'{session,status}'<>'ready' OR response#>>'{session,kind}'<>'short' OR fresh IN (a,b)
  OR (SELECT count(*) FROM studio_camera_sessions WHERE id IN (a,b) AND status='closed')<>2
  OR jsonb_array_length(rooms)<>2 OR NOT rooms ? a::text OR NOT rooms ? b::text
  THEN RAISE EXCEPTION 'Local-first handoff failed to move idle authority'; END IF;
 IF (SELECT count(*) FROM studio_camera_takes WHERE session_id=a)<>30 OR
  (SELECT count(*) FROM studio_camera_commands WHERE session_id=a AND type='stop' AND status='applied')<>18 OR
  (SELECT count(*) FROM storage.objects WHERE name='local-first-fixture-part')<>before_parts OR
  NOT EXISTS(SELECT 1 FROM studio_camera_takes saved_take WHERE saved_take.session_id=a AND saved_take.id=first_take AND saved_take.status='uploading' AND saved_take.metadata IS NULL) OR
  NOT EXISTS(SELECT 1 FROM studio_camera_pairings WHERE owner_id=u AND controller_id=ca AND device_id=d AND revoked_at IS NULL) OR
  NOT EXISTS(SELECT 1 FROM studio_camera_sessions WHERE id=foreign_session AND status='recording')
  THEN RAISE EXCEPTION 'Handoff altered original, partial bytes, receipts, pairing or another owner'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
 IF response#>>'{session,id}'<>fresh::text THEN RAISE EXCEPTION 'Discovery did not follow the replacement'; END IF;
 response:=studio_camera_action(other_u,'discover',jsonb_build_object('deviceId',d,'controllerId',ca));
 IF response->>'paired'<>'false' THEN RAISE EXCEPTION 'New discovery crossed owner binding'; END IF;
 -- Every newly added entry point keeps the same service-only ACL.
 IF has_function_privilege('authenticated','public.studio_camera_local_handoff_allowed(uuid)','EXECUTE') OR
  has_function_privilege('anon','public.studio_camera_local_metadata_valid(jsonb)','EXECUTE') OR
  has_function_privilege('authenticated','public.studio_camera_local_legacy_action(uuid,text,jsonb)','EXECUTE') OR
  has_function_privilege('anon','public.studio_camera_control_action(uuid,text,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'Local-first SQL widened client privileges'; END IF;
END $test$;
ROLLBACK;
