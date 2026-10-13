SELECT set_config('request.jwt.claim.role','service_role',false);
DO $test$
DECLARE
 u uuid := '10000000-0000-4000-8000-000000000001'; other_u uuid := '10000000-0000-4000-8000-000000000002';
 controller uuid := '20000000-0000-4000-8000-0000000000a0'; other_controller uuid := '20000000-0000-4000-8000-0000000000a1';
 qr_controller uuid := '20000000-0000-4000-8000-0000000000a2'; device uuid := '30000000-0000-4000-8000-0000000000a0';
 take uuid := '50000000-0000-4000-8000-0000000000a0'; command uuid := '40000000-0000-4000-8000-0000000000a0';
 stop_command uuid := '40000000-0000-4000-8000-0000000000a1';
 s uuid; next_s uuid; foreign_s uuid; qr_s uuid; response jsonb; rooms jsonb; flag jsonb; busy_status text; pending_type text;
 preserved bigint; session_count bigint; stored_metadata jsonb := '{"bytes":1024,"mime":"video/quicktime","width":3840,"height":2160,"fps":30,"duration":2}';
BEGIN
 UPDATE profiles SET plan='premium',plan_expires_at=now()+interval '1 day',subscription_status='active',creator_status='approved' WHERE id IN (u,other_u);
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('1',64)));
 s:=(response#>>'{session,id}')::uuid;
 PERFORM studio_camera_action(u,'join',jsonb_build_object('deviceId',device,'pairingHash',repeat('1',64)));
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status,metadata) VALUES(take,s,u,'uploaded',stored_metadata);
 INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload) VALUES(command,s,1,'configure','{"pro":{"zoom":2}}');
 UPDATE studio_camera_sessions SET sequence=1 WHERE id=s;
 SELECT count(*) INTO preserved FROM studio_camera_takes WHERE owner_id=u;
 -- Even identical installation identifiers in another account are unrelated.
 INSERT INTO studio_camera_sessions(owner_id,kind,controller_id,device_id,paired_at,status,active_take_id)
  VALUES(other_u,'aula',controller,device,now(),'recording',take) RETURNING id INTO foreign_s;
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','short','controllerId',controller,'pairingHash',repeat('2',64)));
 next_s:=(response#>>'{session,id}')::uuid; rooms:=response->'_roomsToClose';
 IF next_s=s OR response#>>'{session,status}'<>'ready' OR response#>>'{session,deviceId}'<>device::text
  OR (SELECT status FROM studio_camera_sessions WHERE id=s)<>'closed' OR rooms<>jsonb_build_array(s::text)
  THEN RAISE EXCEPTION 'Create left an idle competing session or required another QR'; END IF;
 IF (SELECT status FROM studio_camera_sessions WHERE id=foreign_s)<>'recording' OR
  NOT EXISTS(SELECT 1 FROM studio_camera_takes WHERE session_id=s AND id=take AND metadata=stored_metadata) OR
  (SELECT count(*) FROM studio_camera_takes WHERE owner_id=u)<>preserved OR
  NOT EXISTS(SELECT 1 FROM studio_camera_pairings WHERE owner_id=u AND controller_id=controller AND device_id=device AND revoked_at IS NULL)
  THEN RAISE EXCEPTION 'Handoff altered foreign authority, originals, or durable pairing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM studio_camera_commands WHERE session_id=s AND id=command AND status='failed')
  THEN RAISE EXCEPTION 'Abandoned reversible configuration remained pending'; END IF;
 BEGIN PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',command,'result','{"ok":true}'::jsonb));
  RAISE EXCEPTION 'Late configuration ACK reclaimed retired authority'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_not_ready' THEN RAISE; END IF; END;
 BEGIN PERFORM studio_camera_action(u,'connect',jsonb_build_object('sessionId',s,'role','device','clientId',device));
  RAISE EXCEPTION 'Retired session renewed its preview token'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_not_ready' THEN RAISE; END IF; END;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response#>>'{session,id}'<>next_s::text THEN RAISE EXCEPTION 'Phone discovery did not select replacement'; END IF;
 SELECT count(*) INTO session_count FROM studio_camera_sessions WHERE owner_id=u;
 -- Protect physical transitions, even if a stale local snapshot calls them idle.
 FOREACH busy_status IN ARRAY ARRAY['starting','recording','stopping'] LOOP
  UPDATE studio_camera_sessions SET status=busy_status WHERE id=next_s;
  BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('3',64)));
   RAISE EXCEPTION 'Create interrupted physical REC'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
 END LOOP;
 UPDATE studio_camera_sessions SET status='ready',active_take_id=take WHERE id=next_s;
 BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('3',64)));
  RAISE EXCEPTION 'Create discarded active take reservation'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
 UPDATE studio_camera_sessions SET active_take_id=NULL WHERE id=next_s;
 FOR flag IN SELECT value FROM jsonb_array_elements('[{"recording":true},{"uploading":true},{"processing":true},{"uploadState":"uploading"}]'::jsonb) LOOP
  UPDATE studio_camera_sessions SET device_state=flag WHERE id=next_s;
  BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('3',64)));
   RAISE EXCEPTION 'Create interrupted device recording/upload/processing'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
 END LOOP;
 UPDATE studio_camera_sessions SET device_state='{}' WHERE id=next_s;
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status,metadata) VALUES(take,next_s,u,'uploading',stored_metadata);
 BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('3',64)));
  RAISE EXCEPTION 'Create interrupted storage upload without a fresh heartbeat'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
 UPDATE studio_camera_takes SET status='uploaded' WHERE session_id=next_s AND id=take;
 FOREACH pending_type IN ARRAY ARRAY['start','stop','resume_upload'] LOOP
  INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload) VALUES(command,next_s,1,pending_type,jsonb_build_object('takeId',take));
  BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('3',64)));
   RAISE EXCEPTION 'Create discarded pending capture/transfer command'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
  DELETE FROM studio_camera_commands WHERE session_id=next_s AND id=command;
 END LOOP;
 IF (SELECT count(*) FROM studio_camera_sessions WHERE owner_id=u)<>session_count OR
  (SELECT status FROM studio_camera_sessions WHERE id=next_s)<>'ready' THEN RAISE EXCEPTION 'Busy create mutated session authority'; END IF;
 -- One physical iPhone cannot serve two idle browser rooms simultaneously.
 INSERT INTO studio_camera_pairings(owner_id,controller_id,device_id,last_seen_at) VALUES(u,other_controller,device,now()-interval '1 hour');
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',other_controller,'pairingHash',repeat('4',64)));
 s:=(response#>>'{session,id}')::uuid;
 IF (SELECT status FROM studio_camera_sessions WHERE id=next_s)<>'closed' OR response->'_roomsToClose'<>jsonb_build_array(next_s::text)
  OR (SELECT count(*) FROM studio_camera_pairings WHERE owner_id=u AND device_id=device AND revoked_at IS NULL)<>2
  OR (SELECT last_seen_at FROM studio_camera_pairings WHERE owner_id=u AND controller_id=other_controller)<now()
  THEN RAISE EXCEPTION 'Same-device handoff revoked bindings or retained duplicate room'; END IF;
 -- A saved lastControllerId from A must follow the active room on B, which was
 -- already paired to the same account/device. A later idle last_seen cannot win.
 UPDATE studio_camera_pairings SET last_seen_at=now()+interval '1 hour' WHERE owner_id=u AND controller_id=controller;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response#>>'{session,id}'<>s::text OR response->>'controllerId'<>other_controller::text
  THEN RAISE EXCEPTION 'Valid old binding remained waiting instead of following known active binding'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device));
 IF response#>>'{session,id}'<>s::text OR response->>'controllerId'<>other_controller::text
  THEN RAISE EXCEPTION 'Idle last_seen won over the active camera session'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',qr_controller));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown explicit binding gained a fallback'; END IF;
 response:=studio_camera_action(other_u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Active binding crossed its owner'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',take,'controllerId',controller));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Explicit binding fallback crossed its device'; END IF;
 UPDATE studio_camera_pairings SET revoked_at=now() WHERE owner_id=u AND controller_id=controller;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Revoked explicit binding gained a fallback'; END IF;
 UPDATE studio_camera_pairings SET revoked_at=NULL WHERE owner_id=u AND controller_id=controller;
 -- Paused cloud bytes stay on their original session, where the app can resume.
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status,metadata) VALUES(take,s,u,'uploading',stored_metadata);
 SELECT count(*) INTO session_count FROM studio_camera_sessions WHERE owner_id=u;
 FOR flag IN SELECT value FROM jsonb_array_elements('[{"uploadState":"paused","uploading":false},{"uploadState":"paused"}]'::jsonb) LOOP
  UPDATE studio_camera_sessions SET device_state=flag WHERE id=s;
  BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('6',64)));
   RAISE EXCEPTION 'Create hid a paused original on another session'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_pending_upload' THEN RAISE; END IF; END;
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',other_controller));
  IF response#>>'{session,id}'<>s::text OR (SELECT status FROM studio_camera_sessions WHERE id=s)<>'ready'
   OR (SELECT count(*) FROM studio_camera_sessions WHERE owner_id=u)<>session_count OR
   NOT EXISTS(SELECT 1 FROM studio_camera_takes WHERE session_id=s AND id=take AND status='uploading' AND metadata=stored_metadata)
   THEN RAISE EXCEPTION 'Paused original or resumable session changed after rejected handoff'; END IF;
 END LOOP;
 -- False/unknown is not proof of a pause, and an active operation takes priority.
 FOR flag IN SELECT value FROM jsonb_array_elements('[{"uploading":false},{"uploadState":"paused","uploading":true},{"uploadState":"paused","processing":true},{"uploadState":"paused","recording":true}]'::jsonb) LOOP
  UPDATE studio_camera_sessions SET device_state=flag WHERE id=s;
  BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('6',64)));
   RAISE EXCEPTION 'Unknown or active upload was incorrectly described as paused'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
  IF (SELECT status FROM studio_camera_sessions WHERE id=s)<>'ready' OR
   (SELECT count(*) FROM studio_camera_sessions WHERE owner_id=u)<>session_count
   THEN RAISE EXCEPTION 'Busy original session was retired'; END IF;
 END LOOP;
 UPDATE studio_camera_sessions SET device_state='{"uploadState":"paused","uploading":false}' WHERE id=s;
 FOREACH pending_type IN ARRAY ARRAY['start','stop','resume_upload'] LOOP
  INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload) VALUES(command,s,1,pending_type,jsonb_build_object('takeId',take));
  BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('6',64)));
   RAISE EXCEPTION 'Pending operation was described as paused'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
  DELETE FROM studio_camera_commands WHERE session_id=s AND id=command;
 END LOOP;
 UPDATE studio_camera_takes SET status='uploaded' WHERE session_id=s AND id=take;
 UPDATE studio_camera_sessions SET device_state='{}' WHERE id=s;
 -- A new QR does not reveal its device until JOIN; apply the same ownership guard there.
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',qr_controller,'pairingHash',repeat('5',64)));
 qr_s:=(response#>>'{session,id}')::uuid;
 UPDATE studio_camera_sessions SET device_state='{"processing":true}' WHERE id=s;
 BEGIN PERFORM studio_camera_action(u,'join',jsonb_build_object('deviceId',device,'pairingHash',repeat('5',64)));
  RAISE EXCEPTION 'JOIN stole a processing device'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
 IF (SELECT status FROM studio_camera_sessions WHERE id=qr_s)<>'pairing' THEN RAISE EXCEPTION 'Failed JOIN consumed QR'; END IF;
 UPDATE studio_camera_sessions SET device_state='{}' WHERE id=s;
 response:=studio_camera_action(u,'join',jsonb_build_object('deviceId',device,'pairingHash',repeat('5',64)));
 IF response->'_roomsToClose'<>jsonb_build_array(s::text) OR (SELECT status FROM studio_camera_sessions WHERE id=s)<>'closed'
  OR response#>>'{session,status}'<>'ready' OR (SELECT status FROM studio_camera_sessions WHERE id=foreign_s)<>'recording'
  THEN RAISE EXCEPTION 'JOIN handoff retained competing authority or touched another owner'; END IF;
 -- STOP can succeed physically while preparing the image fails. Its clean
 -- source is still recoverable on A even before final metadata/upload exists.
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',qr_s,'commandId',command,'type','start','payload',jsonb_build_object('takeId',take)));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',qr_s,'deviceId',device,'commandId',command,
  'result',jsonb_build_object('ok',true,'takeId',take,'startedAtServerMs',123456,'state',jsonb_build_object('recording',true))));
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',qr_s,'commandId',stop_command,'type','stop'));
 flag:=jsonb_build_object('recording',false,'uploadState','paused','uploading',false,'processing',false,'uploadTakeId',take,'uploadError','Preparação de imagem pausada.');
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',qr_s,'deviceId',device,'commandId',stop_command,
  'result',jsonb_build_object('ok',true,'takeId',take,'state',flag)));
 PERFORM studio_camera_action(u,'heartbeat',jsonb_build_object('sessionId',qr_s,'role','device','clientId',device,'state',flag));
 SELECT count(*) INTO session_count FROM studio_camera_sessions WHERE owner_id=u;
 IF NOT EXISTS(SELECT 1 FROM studio_camera_takes WHERE session_id=qr_s AND id=take AND status='local_ready' AND metadata IS NULL)
  THEN RAISE EXCEPTION 'STOP preparation fixture did not preserve a metadata-free recoverable take'; END IF;
 FOREACH busy_status IN ARRAY ARRAY['local_ready','failed'] LOOP
  UPDATE studio_camera_takes SET status=busy_status WHERE session_id=qr_s AND id=take;
  BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',qr_controller,'pairingHash',repeat('6',64)));
   RAISE EXCEPTION 'Create hid a clean original awaiting image preparation'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_pending_upload' THEN RAISE; END IF; END;
  response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',qr_controller));
  IF response#>>'{session,id}'<>qr_s::text OR (SELECT status FROM studio_camera_sessions WHERE id=qr_s)<>'ready'
   OR (SELECT count(*) FROM studio_camera_sessions WHERE owner_id=u)<>session_count OR
   NOT EXISTS(SELECT 1 FROM studio_camera_takes WHERE session_id=qr_s AND id=take AND status=busy_status AND metadata IS NULL) OR
   NOT EXISTS(SELECT 1 FROM studio_camera_pairings WHERE owner_id=u AND controller_id=qr_controller AND device_id=device AND revoked_at IS NULL)
   THEN RAISE EXCEPTION 'Paused clean original lost its session, journal target or binding'; END IF;
 END LOOP;
 -- Recovery remains authorized on that same session; CREATE did not hide it.
 response:=studio_camera_action(u,'command',jsonb_build_object('sessionId',qr_s,'commandId',gen_random_uuid(),'type','resume_upload','payload',jsonb_build_object('takeId',take)));
 IF response#>>'{session,id}'<>qr_s::text OR NOT EXISTS(SELECT 1 FROM studio_camera_commands WHERE session_id=qr_s AND type='resume_upload' AND status='pending')
  THEN RAISE EXCEPTION 'Paused render preparation no longer offered its original retry'; END IF;
END $test$;
