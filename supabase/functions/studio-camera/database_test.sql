SELECT set_config('request.jwt.claim.role','service_role',false);
DO $test$
DECLARE
 u uuid := '10000000-0000-4000-8000-000000000001'; other_user uuid := '10000000-0000-4000-8000-000000000002';
 controller uuid := '20000000-0000-4000-8000-000000000001'; device uuid := '30000000-0000-4000-8000-000000000001';
 take uuid := '50000000-0000-4000-8000-000000000001'; start_id uuid := '40000000-0000-4000-8000-000000000001';
 stop_id uuid := '40000000-0000-4000-8000-000000000002'; cfg_id uuid := '40000000-0000-4000-8000-000000000003';
 s uuid; result jsonb; info jsonb := '{"bytes":6291463,"mime":"video/quicktime","width":3840,"height":2160,"fps":30,"duration":3}';
 args jsonb; path text; before_time timestamptz;
BEGIN
 BEGIN PERFORM studio_camera_action(other_user,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('b',64)));
  RAISE EXCEPTION 'Free admin bypassed Premium'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_premium_required' THEN RAISE; END IF; END;
 UPDATE profiles SET plan='premium',entitlement_source='admin',plan_expires_at=now()+interval '1 day' WHERE id=other_user;
 result:=studio_camera_action(other_user,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('d',64)));
 IF result#>>'{session,status}'<>'pairing' THEN RAISE EXCEPTION 'Valid administrative Premium grant was rejected'; END IF;
 UPDATE profiles SET plan_expires_at=NULL WHERE id=other_user;
 BEGIN PERFORM studio_camera_action(other_user,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('f',64)));
  RAISE EXCEPTION 'Unconfirmed grant without expiry accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_premium_required' THEN RAISE; END IF; END;
 UPDATE profiles SET plan_expires_at=now()-interval '1 second' WHERE id=other_user;
 BEGIN PERFORM studio_camera_action(other_user,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('e',64)));
  RAISE EXCEPTION 'Expired administrative grant accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_premium_required' THEN RAISE; END IF; END;
 UPDATE profiles SET plan='free',entitlement_source='stripe',plan_expires_at=NULL WHERE id=other_user;
 UPDATE profiles SET plan_expires_at=now()-interval '1 second' WHERE id=u;
 BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('b',64)));
  RAISE EXCEPTION 'Expired Premium accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_premium_required' THEN RAISE; END IF; END;
 UPDATE profiles SET subscription_status='past_due',subscription_grace_until=now()+interval '1 day' WHERE id=u;
 PERFORM studio_camera_require_premium(u);
 UPDATE profiles SET subscription_grace_until=NULL WHERE id=u;
 BEGIN PERFORM studio_camera_require_premium(u); RAISE EXCEPTION 'Past due without grace accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_premium_required' THEN RAISE; END IF; END;
 UPDATE profiles SET subscription_status='active',subscription_grace_until=NULL WHERE id=u;
 UPDATE profiles SET plan_expires_at=now()+interval '1 day',creator_status='pending' WHERE id=u;
 BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('b',64)));
  RAISE EXCEPTION 'Unapproved creator accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_creator_required' THEN RAISE; END IF; END;
 UPDATE profiles SET creator_status='approved' WHERE id=u;
 result:=studio_camera_action(u,'create',jsonb_build_object('kind','short','controllerId',controller,'pairingHash',repeat('b',64)));
 s:=(result#>>'{session,id}')::uuid;
 IF result::text LIKE '%pairingHash%' OR result::text LIKE '%pairing_hash%' THEN RAISE EXCEPTION 'Hash leaked in DTO'; END IF;
 BEGIN PERFORM studio_camera_action(other_user,'status',jsonb_build_object('sessionId',s)); RAISE EXCEPTION 'Cross-user status accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_not_found' THEN RAISE; END IF; END;
 UPDATE profiles SET plan='premium',subscription_status='active',plan_expires_at=now()+interval '1 day' WHERE id=other_user;
 BEGIN PERFORM studio_camera_action(other_user,'join',jsonb_build_object('pairingHash',repeat('b',64),'deviceId',device)); RAISE EXCEPTION 'Leaked QR crossed owner';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_pairing_unavailable' THEN RAISE; END IF; END;
 UPDATE studio_camera_sessions SET pairing_expires_at=now()-interval '1 second' WHERE id=s;
 BEGIN PERFORM studio_camera_action(u,'join',jsonb_build_object('pairingHash',repeat('b',64),'deviceId',device)); RAISE EXCEPTION 'Expired QR accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_pairing_unavailable' THEN RAISE; END IF; END;
 UPDATE studio_camera_sessions SET pairing_expires_at=now()+interval '5 minutes' WHERE id=s;
 result:=studio_camera_action(u,'join',jsonb_build_object('pairingHash',repeat('b',64),'deviceId',device));
 result:=studio_camera_action(u,'join',jsonb_build_object('pairingHash',repeat('b',64),'deviceId',device));
 BEGIN PERFORM studio_camera_action(u,'join',jsonb_build_object('pairingHash',repeat('b',64),'deviceId',controller)); RAISE EXCEPTION 'QR paired second device';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_pairing_unavailable' THEN RAISE; END IF; END;
 BEGIN PERFORM studio_camera_action(u,'connect',jsonb_build_object('sessionId',s,'role','device','clientId',controller)); RAISE EXCEPTION 'Wrong device token accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_client_mismatch' THEN RAISE; END IF; END;
 result:=studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',cfg_id,'type','configure','payload','{"resolution":"4k"}'::jsonb));
 result:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',cfg_id,'result','{"ok":true}'::jsonb));
 args:=jsonb_build_object('sessionId',s,'commandId',start_id,'type','start','payload',jsonb_build_object('takeId',take));
 result:=studio_camera_action(u,'command',args); result:=studio_camera_action(u,'command',args);
 IF (result#>>'{session,sequence}')::int<>2 OR (SELECT count(*) FROM studio_camera_takes WHERE session_id=s)<>1 THEN RAISE EXCEPTION 'Duplicate REC allocated another take'; END IF;
 BEGIN PERFORM studio_camera_action(u,'command',args||jsonb_build_object('payload',jsonb_build_object('takeId',device))); RAISE EXCEPTION 'Command ID payload conflict accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_command_conflict' THEN RAISE; END IF; END;
 result:=studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',stop_id,'type','stop'));
 BEGIN PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',stop_id,'result','{"ok":true}'::jsonb)); RAISE EXCEPTION 'Out of order ACK accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_ack_out_of_order' THEN RAISE; END IF; END;
 BEGIN PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',controller,'commandId',start_id,'result','{"ok":true}'::jsonb)); RAISE EXCEPTION 'Wrong device ACK accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_client_mismatch' THEN RAISE; END IF; END;
 args:=jsonb_build_object('sessionId',s,'deviceId',device,'commandId',start_id,'result',jsonb_build_object('ok',true,'takeId',take,'startedAtServerMs',123456));
 result:=studio_camera_action(u,'ack',args); result:=studio_camera_action(u,'ack',args);
 result:=studio_camera_action(u,'status',jsonb_build_object('sessionId',s,'afterSequence',3));
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'commands') c WHERE c->>'id'=start_id::text AND c->>'status'='applied')
   THEN RAISE EXCEPTION 'Cursor hid a durable start receipt'; END IF;
 UPDATE profiles SET plan='free',subscription_status='expired',plan_expires_at=NULL WHERE id=u;
 BEGIN PERFORM studio_camera_action(u,'connect',jsonb_build_object('sessionId',s,'role','device','clientId',device)); RAISE EXCEPTION 'Expired account minted preview token';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_premium_required' THEN RAISE; END IF; END;
 result:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',stop_id,'result',jsonb_build_object('ok',true,'metadata',info)));
 -- STOP retries return the original receipt even after active_take_id is cleared.
 result:=studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',stop_id,'type','stop'));
 IF result#>>'{command,status}'<>'applied' OR result#>>'{command,payload,takeId}'<>take::text
   OR (SELECT count(*) FROM studio_camera_commands WHERE session_id=s AND type='stop')<>1
   THEN RAISE EXCEPTION 'STOP retry lost the original take receipt'; END IF;
 args:=jsonb_build_object('sessionId',s,'takeId',take,'metadata',info,'partIndex',0);
 result:=studio_camera_action(u,'upload-start',args); path:=result->>'_objectPath';
 IF (result->>'_totalParts')::int<>2 OR (result->>'_partBytes')::int<>6291456 THEN RAISE EXCEPTION 'Multipart plan incorrect'; END IF;
 BEGIN PERFORM studio_camera_action(u,'upload-start',args||jsonb_build_object('metadata',info||'{"bytes":99}'::jsonb)); RAISE EXCEPTION 'Original metadata overwrite accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_metadata_conflict' THEN RAISE; END IF; END;
 BEGIN PERFORM studio_camera_action(u,'upload-complete',jsonb_build_object('sessionId',s,'takeId',take)); RAISE EXCEPTION 'Unuploaded original accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_original_incomplete' THEN RAISE; END IF; END;
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('studio-camera-originals',path,'{"size":6291456,"mimetype":"application/octet-stream"}');
 result:=studio_camera_action(u,'upload-start',args);
 IF result->>'_partUploaded'<>'true' THEN RAISE EXCEPTION 'Completed part retry not recognized'; END IF;
 result:=studio_camera_action(u,'upload-start',args||'{"partIndex":1}'::jsonb); path:=result->>'_objectPath';
 IF (result->>'_partBytes')::int<>7 OR (result->>'_partOffset')::int<>6291456 THEN RAISE EXCEPTION 'Last part plan incorrect'; END IF;
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('studio-camera-originals',path,'{"size":6,"mimetype":"application/octet-stream"}');
 BEGIN PERFORM studio_camera_action(u,'upload-complete',jsonb_build_object('sessionId',s,'takeId',take)); RAISE EXCEPTION 'Incorrect part bytes accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_original_incomplete' THEN RAISE; END IF; END;
 UPDATE storage.objects SET metadata='{"size":7,"mimetype":"application/octet-stream"}' WHERE name=path;
 result:=studio_camera_action(u,'upload-complete',jsonb_build_object('sessionId',s,'takeId',take));
 SELECT uploaded_at INTO before_time FROM studio_camera_takes WHERE session_id=s AND id=take;
 result:=studio_camera_action(u,'upload-complete',jsonb_build_object('sessionId',s,'takeId',take));
 IF (SELECT uploaded_at FROM studio_camera_takes WHERE session_id=s AND id=take) IS DISTINCT FROM before_time THEN RAISE EXCEPTION 'Complete retry mutated receipt'; END IF;
 result:=studio_camera_action(u,'download',jsonb_build_object('sessionId',s,'takeId',take));
 BEGIN PERFORM studio_camera_action(other_user,'download',jsonb_build_object('sessionId',s,'takeId',take)); RAISE EXCEPTION 'Cross-user original download accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_not_found' THEN RAISE; END IF; END;
 result:=studio_camera_action(u,'close',jsonb_build_object('sessionId',s));
 result:=studio_camera_action(u,'download',jsonb_build_object('sessionId',s,'takeId',take));
 -- Recovery of a valid local file never pretends that native REC was acknowledged.
 UPDATE profiles SET plan='premium',subscription_status='active',plan_expires_at=now()+interval '1 day' WHERE id=u;
 result:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('c',64))); s:=(result#>>'{session,id}')::uuid;
 result:=studio_camera_action(u,'join',jsonb_build_object('pairingHash',repeat('c',64),'deviceId',device));
 result:=studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',start_id,'type','start','payload',jsonb_build_object('takeId',take)));
 UPDATE profiles SET plan='free',subscription_status='expired' WHERE id=u;
 args:=jsonb_build_object('sessionId',s,'takeId',take,'metadata',info,'recovered',true,'deviceId',device);
 result:=studio_camera_action(u,'upload-start',args);
 IF result#>>'{session,status}'<>'ready' OR result#>>'{session,activeTakeId}' IS NOT NULL OR
   result#>>'{commands,0,status}'<>'failed' OR result#>>'{commands,0,result,error}'<>'studio_camera_local_original_recovered'
   THEN RAISE EXCEPTION 'Recovery fabricated native start acknowledgement'; END IF;
 BEGIN PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',start_id,'result','{"ok":true}'::jsonb)); RAISE EXCEPTION 'Late ACK overwrote recovery';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_ack_conflict' THEN RAISE; END IF; END;
 UPDATE profiles SET plan='premium',subscription_status='active' WHERE id=u;
 UPDATE profiles SET plan='free',subscription_status='free' WHERE id=other_user;
END $test$;
-- Test partial configuration through the actual queue/ACK path, not only a
-- direct trigger UPDATE. Resolutions/FPS and individual Pro groups are cumulative.
DO $test$
DECLARE
 u uuid := '10000000-0000-4000-8000-000000000001'; device uuid := '30000000-0000-4000-8000-000000000001';
 s uuid; command_id uuid; patch jsonb; response jsonb; pro jsonb;
BEGIN
 SELECT id INTO s FROM studio_camera_sessions WHERE owner_id=u AND pairing_hash=repeat('c',64);
 FOREACH patch IN ARRAY ARRAY[
  '{"pro":{"autoExposure":false,"iso":320,"shutterSeconds":0.02}}',
  '{"pro":{"autoWhiteBalance":false,"temperatureKelvin":5600,"whiteBalanceTint":8}}',
  '{"pro":{"autoFocus":false,"lensPosition":0.4}}',
  '{"resolution":"2k","fps":24}'
 ]::jsonb[] LOOP
  command_id:=gen_random_uuid();
  response:=studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',command_id,'type','configure','payload',patch));
  response:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',command_id,'result','{"ok":true}'::jsonb));
 END LOOP;
 pro:=response#>'{session,configuration,pro}';
 IF pro->>'iso'<>'320' OR pro->>'shutterSeconds'<>'0.02' OR pro->>'temperatureKelvin'<>'5600' OR pro->>'whiteBalanceTint'<>'8' OR pro->>'lensPosition'<>'0.4'
   OR response#>>'{session,configuration,resolution}'<>'2k' OR response#>>'{session,configuration,fps}'<>'24'
   THEN RAISE EXCEPTION 'Partial quality/Pro ACK lost another confirmed group'; END IF;
 -- RGB replaces Kelvin/tint; the other two manual groups stay intact.
 command_id:=gen_random_uuid();
 response:=studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',command_id,'type','configure',
  'payload','{"pro":{"autoWhiteBalance":false,"redGain":1.2,"greenGain":1.1,"blueGain":1.3}}'::jsonb));
 response:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',command_id,'result','{"ok":true}'::jsonb));
 pro:=response#>'{session,configuration,pro}';
 IF pro ? 'temperatureKelvin' OR pro ? 'whiteBalanceTint' OR pro->>'iso'<>'320' OR pro->>'lensPosition'<>'0.4'
  THEN RAISE EXCEPTION 'RGB switch corrupted independent Pro groups'; END IF;
 FOREACH patch IN ARRAY ARRAY[
  '{"pro":{"autoExposure":true}}',
  '{"pro":{"autoWhiteBalance":true}}',
  '{"pro":{"autoFocus":true}}'
 ]::jsonb[] LOOP
  command_id:=gen_random_uuid();
  response:=studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',command_id,'type','configure','payload',patch));
  response:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',command_id,'result','{"ok":true}'::jsonb));
  pro:=response#>'{session,configuration,pro}';
  IF patch#>>'{pro,autoExposure}'='true' AND (pro ? 'iso' OR pro ? 'shutterSeconds' OR pro->>'redGain'<>'1.2' OR pro->>'lensPosition'<>'0.4')
   THEN RAISE EXCEPTION 'Auto exposure retained manual values or removed unrelated groups'; END IF;
  IF patch#>>'{pro,autoWhiteBalance}'='true' AND
   (pro ?| ARRAY['redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint'] OR pro->>'lensPosition'<>'0.4')
   THEN RAISE EXCEPTION 'Auto WB retained manual values or removed focus'; END IF;
 END LOOP;
 IF pro ? 'lensPosition' OR pro->>'autoExposure'<>'true' OR pro->>'autoWhiteBalance'<>'true' OR pro->>'autoFocus'<>'true'
  THEN RAISE EXCEPTION 'Auto focus retained manual lens position'; END IF;
END $test$;
-- Recovery commands are scoped to an existing original and never manufacture
-- a completed storage receipt, even after entitlement/preview expiry.
DO $test$
DECLARE
 u uuid := '10000000-0000-4000-8000-000000000001'; other_user uuid := '10000000-0000-4000-8000-000000000002';
 controller uuid := '20000000-0000-4000-8000-000000000001'; device uuid := '30000000-0000-4000-8000-000000000001';
 take uuid := gen_random_uuid(); start_id uuid := gen_random_uuid(); stop_id uuid := gen_random_uuid(); resume_id uuid := gen_random_uuid();
 s uuid; response jsonb; args jsonb; receipt jsonb; info jsonb := '{"bytes":1234,"mime":"video/mp4","width":3840,"height":2160,"fps":30,"duration":3}';
BEGIN
 UPDATE profiles SET plan='premium',subscription_status='active',plan_expires_at=now()+interval '1 day' WHERE id=u;
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('7',64))); s:=(response#>>'{session,id}')::uuid;
 PERFORM studio_camera_action(u,'join',jsonb_build_object('pairingHash',repeat('7',64),'deviceId',device));
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',start_id,'type','start','payload',jsonb_build_object('takeId',take)));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',start_id,'result',jsonb_build_object('ok',true,'takeId',take,'startedAtServerMs',123456)));
 args:=jsonb_build_object('sessionId',s,'commandId',resume_id,'type','resume_upload','payload',jsonb_build_object('takeId',take));
 BEGIN PERFORM studio_camera_action(u,'command',args); RAISE EXCEPTION 'Resume overlapped native REC';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_busy' THEN RAISE; END IF; END;
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',stop_id,'type','stop'));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',stop_id,'result',jsonb_build_object('ok',true,'takeId',take,'metadata',info)));
 UPDATE profiles SET plan='free',subscription_status='expired',plan_expires_at=NULL WHERE id=u;
 UPDATE studio_camera_sessions SET device_seen_at=now()-interval '31 seconds' WHERE id=s;
 BEGIN PERFORM studio_camera_action(u,'command',args); RAISE EXCEPTION 'Offline device accepted a new resume';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_device_offline' THEN RAISE; END IF; END;
 PERFORM studio_camera_action(u,'heartbeat',jsonb_build_object('sessionId',s,'role','device','clientId',device,
  'state',jsonb_build_object('width',3840,'height',2160,'fps',30,'configurationConfirmed',true,'uploadTakeId',take,'uploadState','paused','uploadError','Previous interruption')));
 BEGIN PERFORM studio_camera_action(other_user,'command',args); RAISE EXCEPTION 'Cross-account resume accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_not_found' THEN RAISE; END IF; END;
 BEGIN PERFORM studio_camera_action(u,'command',args||jsonb_build_object('payload',jsonb_build_object('takeId',gen_random_uuid()))); RAISE EXCEPTION 'Unowned original accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_take_not_found' THEN RAISE; END IF; END;
 response:=studio_camera_action(u,'command',args); response:=studio_camera_action(u,'command',args);
 IF (SELECT count(*) FROM studio_camera_commands WHERE session_id=s AND type='resume_upload')<>1 THEN RAISE EXCEPTION 'Duplicate resume allocated twice'; END IF;
 BEGIN PERFORM studio_camera_action(u,'command',args||jsonb_build_object('payload',jsonb_build_object('takeId',device))); RAISE EXCEPTION 'Resume command ID changed original';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_command_conflict' THEN RAISE; END IF; END;
 receipt:=jsonb_build_object('ok',true,'takeId',take,'uploadState','uploading','uploadProgressBytes',0,'uploadTotalBytes',1234,'uploadResumedAtServerMs',123457,
  'state',jsonb_build_object('uploadTakeId',take,'uploadState','uploading','uploadError',NULL,'uploadResumedAtServerMs',123457));
 BEGIN PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',controller,'commandId',resume_id,'result',receipt)); RAISE EXCEPTION 'Wrong device resumed original';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_client_mismatch' THEN RAISE; END IF; END;
 BEGIN PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',resume_id,'result',receipt||jsonb_build_object('takeId',device))); RAISE EXCEPTION 'Resume ACK changed original';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_take_conflict' THEN RAISE; END IF; END;
 response:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',resume_id,'result',receipt));
 response:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',resume_id,'result',receipt));
 IF response#>>'{session,deviceState,width}'<>'3840' OR response#>>'{session,deviceState,uploadError}' IS NOT NULL OR
   response#>>'{session,deviceState,uploadResumedAtServerMs}'<>'123457' OR (SELECT status FROM studio_camera_takes WHERE session_id=s AND id=take)<>'local_ready'
   THEN RAISE EXCEPTION 'Resume ACK lost camera state or forged uploaded receipt'; END IF;
 PERFORM studio_camera_action(u,'close',jsonb_build_object('sessionId',s));
 resume_id:=gen_random_uuid(); args:=args||jsonb_build_object('commandId',resume_id);
 response:=studio_camera_action(u,'command',args);
 receipt:=receipt||jsonb_build_object('uploadState','complete','uploadProgressBytes',1234,'uploadResumedAtServerMs',123458);
 response:=studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'deviceId',device,'commandId',resume_id,'result',receipt));
 IF response#>>'{session,status}'<>'closed' OR (SELECT status FROM studio_camera_takes WHERE session_id=s AND id=take)<>'local_ready'
   THEN RAISE EXCEPTION 'Closed-session recovery reopened preview or forged completion'; END IF;
 UPDATE profiles SET plan='premium',subscription_status='active',plan_expires_at=now()+interval '1 day' WHERE id=u;
END $test$;
-- Even a legacy permissive storage policy cannot leak the original bucket.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='studio-camera-originals') THEN RAISE EXCEPTION 'Restrictive storage policy leaked originals'; END IF;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('studio-camera-originals','forged.mov'); RAISE EXCEPTION 'Forged upload permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM studio_camera_action('10000000-0000-4000-8000-000000000001','status','{}'); RAISE EXCEPTION 'Direct RPC permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM studio_camera_sessions; RAISE EXCEPTION 'Pairing table exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
