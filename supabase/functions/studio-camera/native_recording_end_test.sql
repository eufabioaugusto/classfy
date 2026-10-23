-- Actual PostgreSQL fixture: never touches a device or the production database.
SELECT set_config('request.jwt.claim.role','service_role',false);
BEGIN;
DO $test$
DECLARE
 u uuid:='10000000-0000-4000-8000-00000000fd01'; other_u uuid:='10000000-0000-4000-8000-00000000fd02';
 controller uuid:='20000000-0000-4000-8000-00000000fd01'; device uuid:='30000000-0000-4000-8000-00000000fd01';
 start_id uuid:='40000000-0000-4000-8000-00000000fd01'; stop_id uuid:='40000000-0000-4000-8000-00000000fd02';
 take uuid:='50000000-0000-4000-8000-00000000fd01'; old_take uuid:='50000000-0000-4000-8000-00000000fd02';
 next_take uuid:='50000000-0000-4000-8000-00000000fd03'; session uuid; response jsonb; heartbeat jsonb;
 raw_metadata jsonb:='{"bytes":202000000,"mime":"video/quicktime","width":3840,"height":2160,"fps":30,"duration":66}';
 ending jsonb; state jsonb; bad jsonb; flag jsonb; start_result jsonb; saved_receipt jsonb;
 started numeric:=floor(extract(epoch FROM clock_timestamp())*1000)-120000;
 pending_type text; legacy_column_exists boolean;
BEGIN
 INSERT INTO auth.users(id) VALUES(u),(other_u);
 INSERT INTO profiles(id,plan,plan_expires_at,subscription_status,creator_status)
  VALUES(u,'premium',now()+interval '1 day','active','approved'),(other_u,'premium',now()+interval '1 day','active','approved');
 INSERT INTO user_roles(user_id,role) VALUES(u,'creator'),(other_u,'creator');
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('e',64)));
 session:=(response#>>'{session,id}')::uuid;
 PERFORM studio_camera_action(u,'join',jsonb_build_object('deviceId',device,'pairingHash',repeat('e',64)));
 PERFORM studio_camera_action(u,'heartbeat',jsonb_build_object('sessionId',session,'role','device','clientId',device,'state','{"recording":false}'::jsonb));
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',session,'commandId',start_id,'type','start','payload',jsonb_build_object('takeId',take)));
 start_result:=jsonb_build_object('ok',true,'takeId',take,'startedAtServerMs',started,'state',jsonb_build_object('recording',true));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',session,'commandId',start_id,'deviceId',device,'result',start_result));
 UPDATE studio_camera_commands SET created_at=to_timestamp(started/1000),acknowledged_at=to_timestamp((started+100)/1000) WHERE session_id=session AND id=start_id;
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status,metadata) VALUES(old_take,session,u,'uploaded',raw_metadata);
 ending:=jsonb_build_object('version',1,'takeId',take,'finishedAtServerMs',started+66000,'durationSeconds',66,'reason','capture_interrupted','interrupted',true);
 state:=jsonb_build_object('recording',false,'processing',false,'uploading',false,'uploadState','idle','captureError','A captura terminou antes do solicitado.',
  'capabilities',jsonb_build_object('localTakeStorage',1),'recordingEnd',ending,
  'localTakes',jsonb_build_array(jsonb_build_object('id',take,'localSaved',true,'metadata',raw_metadata,'phase','local_ready')));
 heartbeat:=jsonb_build_object('sessionId',session,'role','device','clientId',device);
 -- A false recording snapshot, previous take or incomplete receipt cannot close REC.
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  state-'recordingEnd',state-'localTakes',state-'capabilities',
  jsonb_set(state,'{localTakes}',(state->'localTakes')||(state->'localTakes')),state||'{"capabilities":{"localTakeStorage":"1"}}',
  state||'{"recording":true}',state||'{"recording":"false"}',
  jsonb_set(state,'{recordingEnd,version}','2'),jsonb_set(state,'{recordingEnd,interrupted}','false'),
  jsonb_set(state,'{recordingEnd,takeId}',to_jsonb(old_take::text)),
  jsonb_set(state,'{localTakes,0,id}',to_jsonb(old_take::text)),jsonb_set(state,'{localTakes,0,localSaved}','false'),
  jsonb_set(state,'{localTakes,0,localSaved}','"true"'),jsonb_set(state,'{localTakes,0,phase}','"uploading"'),
  jsonb_set(state,'{localTakes,0,metadata,duration}','"bad"'),jsonb_set(state,'{localTakes,0,metadata,mime}','null'),
  jsonb_set(state,'{localTakes,0,metadata,bytes}','0'),jsonb_set(state,'{recordingEnd,durationSeconds}','65'),
  state#-'{recordingEnd,finishedAtServerMs}',jsonb_set(state,'{recordingEnd,finishedAtServerMs}','"bad"'),
  jsonb_set(state,'{recordingEnd,finishedAtServerMs}',to_jsonb(started-1)),
  jsonb_set(state,'{recordingEnd,finishedAtServerMs}',to_jsonb(started+900000)),
  jsonb_set(state,'{recordingEnd,finishedAtServerMs}',to_jsonb(started+10000)),
  jsonb_set(state,'{recordingEnd,reason}','"unknown"'),jsonb_set(state,'{recordingEnd,reason}','"user_stop"'),
  state||'{"uploading":true}',state||'{"processing":true}',state||'{"uploadState":"uploading"}')) LOOP
  response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',bad));
  IF response#>>'{session,status}'<>'recording' OR response#>>'{session,activeTakeId}'<>take::text OR
   EXISTS(SELECT 1 FROM studio_camera_takes t WHERE t.session_id=session AND t.id=take AND t.recording_end IS NOT NULL)
   THEN RAISE EXCEPTION 'Incomplete/stale native end proof closed active REC'; END IF;
 END LOOP;
 -- The original successful START and its authoritative timestamp are required.
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(start_result-'startedAtServerMs',
  start_result||'{"ok":false}',start_result||'{"startedAtServerMs":"bad"}',start_result||jsonb_build_object('takeId',old_take))) LOOP
  UPDATE studio_camera_commands SET result=bad WHERE session_id=session AND id=start_id;
  response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',state));
  IF response#>>'{session,status}'<>'recording' THEN RAISE EXCEPTION 'Native end bypassed missing same-take START proof'; END IF;
 END LOOP;
 UPDATE studio_camera_commands SET result=start_result WHERE session_id=session AND id=start_id;
 FOREACH pending_type IN ARRAY ARRAY['start','resume_upload'] LOOP
  INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload) VALUES(md5('native-end-pending')::uuid,session,2,pending_type,jsonb_build_object('takeId',take));
  response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',state));
  IF response#>>'{session,status}'<>'recording' THEN RAISE EXCEPTION 'Native end bypassed pending physical work'; END IF;
  DELETE FROM studio_camera_commands WHERE session_id=session AND sequence=2;
 END LOOP;
 IF studio_camera_reconcile_native_end(other_u,session,device) OR studio_camera_reconcile_native_end(u,session,old_take)
  THEN RAISE EXCEPTION 'Native receipt crossed its owner or device'; END IF;
 -- A reversible abandoned configure must not pin phantom REC after valid
 -- termination. It is failed, never acknowledged on behalf of the device.
 INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload) VALUES(md5('native-end-configure')::uuid,session,2,'configure','{"pro":{"zoom":2}}');
 UPDATE studio_camera_sessions SET sequence=2 WHERE id=session;
 -- An already-requested STOP is resolved as an interrupted capture, not an invented ACK.
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',session,'commandId',stop_id,'type','stop'));
 response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',state));
 IF response#>>'{session,status}'<>'ready' OR response#>>'{session,activeTakeId}' IS NOT NULL OR
  NOT EXISTS(SELECT 1 FROM studio_camera_takes t WHERE t.session_id=session AND t.id=take AND t.status='local_ready'
   AND t.metadata IS NULL AND t.uploaded_at IS NULL AND t.recording_end->>'reason'='capture_interrupted'
   AND t.recording_end->'sourceMetadata'=raw_metadata) OR
  NOT EXISTS(SELECT 1 FROM studio_camera_commands c WHERE c.session_id=session AND c.id=stop_id AND c.status='failed'
   AND c.result->>'error'='studio_camera_native_recording_ended' AND c.result->'ok'='false'::jsonb) OR
  NOT EXISTS(SELECT 1 FROM studio_camera_commands c WHERE c.session_id=session AND c.id=start_id AND c.status='applied' AND c.result=start_result) OR
  NOT EXISTS(SELECT 1 FROM studio_camera_commands c WHERE c.session_id=session AND c.type='configure' AND c.status='failed' AND c.result->>'error'='studio_camera_native_recording_ended') OR
  response#>>'{session,deviceState,captureError}' IS DISTINCT FROM state->>'captureError' OR
  response#>'{session,deviceState,localTakes}' IS DISTINCT FROM state->'localTakes'
  THEN RAISE EXCEPTION 'Valid native termination lost source, error, catalog or authority'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(response->'takes') item WHERE item->>'id'=take::text
  AND item#>>'{recordingEnd,reason}'='capture_interrupted' AND item#>'{recordingEnd,sourceMetadata}'=raw_metadata)
  THEN RAISE EXCEPTION 'Durable native receipt missing from snapshot'; END IF;
 SELECT t.recording_end INTO saved_receipt FROM studio_camera_takes t WHERE t.session_id=session AND t.id=take;
 response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',state));
 IF (SELECT t.recording_end FROM studio_camera_takes t WHERE t.session_id=session AND t.id=take) IS DISTINCT FROM saved_receipt
  THEN RAISE EXCEPTION 'Native end replay overwrote immutable receipt'; END IF;
 -- The durable receipt survives removal of the bounded live catalog.
 UPDATE studio_camera_sessions SET device_state=state-'localTakes' WHERE id=session;
 IF NOT studio_camera_local_handoff_allowed(session) THEN RAISE EXCEPTION 'Recorded native end lost local handoff proof after catalog trim'; END IF;
 -- A late native completion for this file must not close a subsequent recording.
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',session,'commandId',md5('native-end-next-start')::uuid,'type','start','payload',jsonb_build_object('takeId',next_take)));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',session,'commandId',md5('native-end-next-start')::uuid,'deviceId',device,
  'result',jsonb_build_object('ok',true,'takeId',next_take,'startedAtServerMs',started+80000,'state',jsonb_build_object('recording',true))));
 response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',state));
 IF response#>>'{session,status}'<>'recording' OR response#>>'{session,activeTakeId}'<>next_take::text
  THEN RAISE EXCEPTION 'Late end receipt closed a newer take'; END IF;
 -- A partial file may contain less media than wall time: do not reject omitted gaps.
 ending:=ending||jsonb_build_object('takeId',next_take,'finishedAtServerMs',started+170000,'durationSeconds',66);
 state:=jsonb_set(jsonb_set(state,'{recordingEnd}',ending),'{localTakes,0,id}',to_jsonb(next_take::text));
 response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',state));
 IF response#>>'{session,status}'<>'ready' THEN RAISE EXCEPTION 'Gapped partial source was mistaken for an invalid wallclock duration'; END IF;
 -- No pending STOP is required, and an already-applied ACK is never modified.
 IF EXISTS(SELECT 1 FROM studio_camera_commands c WHERE c.session_id=session AND c.type='stop' AND c.status='applied')
  THEN RAISE EXCEPTION 'Reconciliation fabricated an applied STOP ACK'; END IF;
 PERFORM studio_camera_action(u,'close',jsonb_build_object('sessionId',session));
 response:=studio_camera_action(u,'heartbeat',heartbeat||jsonb_build_object('state',state));
 IF response#>>'{session,status}'<>'closed' THEN RAISE EXCEPTION 'Native receipt reopened closed session'; END IF;
 IF has_function_privilege('authenticated','public.studio_camera_reconcile_native_end(uuid,uuid,uuid)','EXECUTE') OR
  has_function_privilege('anon','public.studio_camera_snapshot(uuid,bigint)','EXECUTE')
  THEN RAISE EXCEPTION 'Native reconciliation widened service-only privileges'; END IF;
END $test$;
ROLLBACK;
