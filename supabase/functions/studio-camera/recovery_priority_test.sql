SELECT set_config('request.jwt.claim.role','service_role',false);
DO $test$
DECLARE
 u uuid := '10000000-0000-4000-8000-000000000001'; other_u uuid := '10000000-0000-4000-8000-000000000002';
 ca uuid := '20000000-0000-4000-8000-0000000000c0'; cb uuid := '20000000-0000-4000-8000-0000000000c1';
 unknown_controller uuid := '20000000-0000-4000-8000-0000000000c2'; d uuid := '30000000-0000-4000-8000-0000000000c0';
 ta uuid := '50000000-0000-4000-8000-0000000000c0'; tb uuid := '50000000-0000-4000-8000-0000000000c1';
 command uuid := '40000000-0000-4000-8000-0000000000c0'; a uuid; b uuid; idle_a uuid;
 response jsonb; flag jsonb; transition text; pending_type text; original_count bigint; pairing_count bigint;
BEGIN
 INSERT INTO studio_camera_pairings(owner_id,controller_id,device_id) VALUES(u,ca,d),(u,cb,d);
 INSERT INTO studio_camera_sessions(owner_id,controller_id,device_id,paired_at,kind,status,created_at,device_state)
  VALUES(u,ca,d,now()-interval '1 day','aula','ready',now()-interval '1 day','{"uploadState":"paused","uploading":false,"processing":false,"recording":false}') RETURNING id INTO a;
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status) VALUES(ta,a,u,'local_ready');
 INSERT INTO studio_camera_sessions(owner_id,controller_id,device_id,paired_at,kind,status,device_state)
  VALUES(u,cb,d,now(),'aula','ready','{}') RETURNING id INTO b;
 SELECT count(*) INTO original_count FROM studio_camera_takes WHERE owner_id=u;
 SELECT count(*) INTO pairing_count FROM studio_camera_pairings WHERE owner_id=u;
 -- Explicit B is authorized, but the older paused source on A owns recovery.
 FOREACH flag IN ARRAY ARRAY[jsonb_build_object('deviceId',d,'controllerId',ca),jsonb_build_object('deviceId',d,'controllerId',cb),jsonb_build_object('deviceId',d)] LOOP
  response:=studio_camera_action(u,'discover',flag);
  IF response#>>'{session,id}'<>a::text OR response->>'controllerId'<>ca::text THEN RAISE EXCEPTION 'New idle room hid legacy paused original'; END IF;
 END LOOP;
 -- Choosing a binding must return the exact ranked session, even when the
 -- competing newer idle room belongs to that same browser installation.
 INSERT INTO studio_camera_sessions(owner_id,controller_id,device_id,paired_at,kind,status,created_at,device_state)
  VALUES(u,ca,d,now(),'aula','ready',now()+interval '1 hour','{}') RETURNING id INTO idle_a;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',ca));
 IF response#>>'{session,id}'<>a::text THEN RAISE EXCEPTION 'Binding selection returned its newer idle room instead of original session'; END IF;
 -- Physical capture, processing, and active transfer always win over recovery.
 FOREACH transition IN ARRAY ARRAY['starting','recording','stopping'] LOOP
  UPDATE studio_camera_sessions SET status=transition WHERE id=b;
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',ca));
  IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Paused original took precedence over physical capture'; END IF;
 END LOOP;
 UPDATE studio_camera_sessions SET status='ready',active_take_id=tb WHERE id=b;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
 IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Paused original took precedence over active take reservation'; END IF;
 UPDATE studio_camera_sessions SET active_take_id=NULL WHERE id=b;
 FOR flag IN SELECT value FROM jsonb_array_elements('[{"recording":true},{"processing":true},{"uploading":true},{"uploadState":"uploading"},{"uploadState":"paused","uploading":true}]'::jsonb) LOOP
  UPDATE studio_camera_sessions SET device_state=flag WHERE id=b;
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',ca));
  IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Paused original took precedence over active device work'; END IF;
 END LOOP;
 UPDATE studio_camera_sessions SET device_state='{}' WHERE id=b;
 FOREACH pending_type IN ARRAY ARRAY['start','stop','resume_upload'] LOOP
  INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload) VALUES(command,b,1,pending_type,jsonb_build_object('takeId',tb));
  UPDATE studio_camera_sessions SET sequence=1 WHERE id=b;
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',ca));
  IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Recovery selection interrupted a pending capture/transfer command'; END IF;
  DELETE FROM studio_camera_commands WHERE session_id=b AND id=command;
 END LOOP;
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status) VALUES(tb,b,u,'recording');
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
 IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Recovery selection interrupted native take ownership'; END IF;
 UPDATE studio_camera_takes SET status='uploading' WHERE session_id=b AND id=tb;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
 IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Unknown active storage transfer lost precedence over paused recovery'; END IF;
 UPDATE studio_camera_takes SET status='uploaded' WHERE session_id=b AND id=tb;
 FOREACH transition IN ARRAY ARRAY['uploading','local_ready','failed'] LOOP
  UPDATE studio_camera_takes SET status=transition WHERE session_id=a AND id=ta;
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d));
  IF response#>>'{session,id}'<>a::text THEN RAISE EXCEPTION 'A recoverable paused state lost its retry session'; END IF;
 END LOOP;
 -- A known binding can follow authorized recovery. Invalid/revoked explicit
 -- input still returns unpaired, and another owner/device never gains it.
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',unknown_controller));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown explicit binding acquired original recovery'; END IF;
 response:=studio_camera_action(other_u,'discover',jsonb_build_object('deviceId',d,'controllerId',ca));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Recovery crossed its account'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',tb,'controllerId',ca));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Recovery crossed its physical device'; END IF;
 UPDATE studio_camera_pairings SET revoked_at=now() WHERE owner_id=u AND controller_id=cb;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',cb));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Revoked explicit binding acquired recovery fallback'; END IF;
 UPDATE studio_camera_pairings SET revoked_at=NULL WHERE owner_id=u AND controller_id=cb;
 UPDATE studio_camera_pairings SET revoked_at=now() WHERE owner_id=u AND controller_id=ca;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',d,'controllerId',cb));
 IF response#>>'{session,id}'<>b::text THEN RAISE EXCEPTION 'Revoked recovery source was selected instead of authorized idle room'; END IF;
 UPDATE studio_camera_pairings SET revoked_at=NULL WHERE owner_id=u AND controller_id=ca;
 IF (SELECT count(*) FROM studio_camera_pairings WHERE owner_id=u)<>pairing_count OR
  (SELECT count(*) FROM studio_camera_takes WHERE owner_id=u)<>original_count+1 OR
  NOT EXISTS(SELECT 1 FROM studio_camera_takes WHERE session_id=a AND id=ta AND metadata IS NULL) OR
  (SELECT count(*) FROM studio_camera_sessions WHERE id IN (a,b,idle_a) AND status='ready')<>3
  THEN RAISE EXCEPTION 'Discovery modified original/session/binding authority'; END IF;
END $test$;
