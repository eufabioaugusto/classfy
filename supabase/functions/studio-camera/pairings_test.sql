SELECT set_config('request.jwt.claim.role','service_role',false);
DO $test$
DECLARE
 u uuid := '10000000-0000-4000-8000-000000000001'; other_u uuid := '10000000-0000-4000-8000-000000000002';
 controller uuid := '20000000-0000-4000-8000-000000000090'; device uuid := '30000000-0000-4000-8000-000000000090';
 command uuid := '40000000-0000-4000-8000-000000000090'; take uuid := '50000000-0000-4000-8000-000000000090';
 response jsonb; first_session uuid; next_session uuid; preserved bigint; closed_rooms jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM studio_camera_pairings) THEN RAISE EXCEPTION 'Existing paired sessions were not adopted'; END IF;
 UPDATE profiles SET plan='premium',plan_expires_at=now()+interval '1 day',subscription_status='active',creator_status='approved' WHERE id=u;
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('9',64)));
 first_session:=(response#>>'{session,id}')::uuid;
 IF response#>>'{session,status}'<>'pairing' THEN RAISE EXCEPTION 'Fresh browser bypassed QR'; END IF;
 PERFORM studio_camera_action(u,'join',jsonb_build_object('deviceId',device,'pairingHash',repeat('9',64)));
 response:=studio_camera_action(other_u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response->>'paired'<>'false' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Cross-owner discovery revealed a pairing'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',take,'controllerId',controller));
 IF response->>'paired'<>'false' THEN RAISE EXCEPTION 'Wrong device resumed pairing'; END IF;
 PERFORM studio_camera_action(u,'close',jsonb_build_object('sessionId',first_session));
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response->>'paired'<>'true' OR response->'session'<>'null'::jsonb THEN RAISE EXCEPTION 'Closing capture revoked the durable pairing'; END IF;
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','short','controllerId',controller,'pairingHash',repeat('8',64)));
 next_session:=(response#>>'{session,id}')::uuid;
 IF response#>>'{session,status}'<>'ready' OR response#>>'{session,deviceId}'<>device::text OR
   (SELECT pairing_hash FROM studio_camera_sessions WHERE id=next_session) IS NOT NULL THEN RAISE EXCEPTION 'Paired browser required another QR'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response#>>'{session,id}'<>next_session::text THEN RAISE EXCEPTION 'Resume returned an ended session'; END IF;
 -- Routine captures with a known pairing do not consume QR-allocation limits.
 FOR n IN 1..11 LOOP
  PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('7',64)));
 END LOOP;
 PERFORM studio_camera_action(u,'heartbeat',jsonb_build_object('sessionId',next_session,'role','device','clientId',device,'state','{}'::jsonb));
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',next_session,'commandId',command,'type','start','payload',jsonb_build_object('takeId',take)));
 BEGIN PERFORM studio_camera_action(u,'unpair',jsonb_build_object('controllerId',controller)); RAISE EXCEPTION 'Unpair interrupted an in-flight capture';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_stop_required' THEN RAISE; END IF; END;
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',next_session,'commandId',command,'deviceId',device,'result','{"ok":false}'::jsonb));
 SELECT count(*) INTO preserved FROM studio_camera_takes WHERE owner_id=u;
 BEGIN PERFORM studio_camera_action(other_u,'unpair',jsonb_build_object('controllerId',controller)); RAISE EXCEPTION 'Other account unpaired a browser';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_not_found' THEN RAISE; END IF; END;
 response:=studio_camera_action(u,'unpair',jsonb_build_object('controllerId',controller));
 closed_rooms:=response->'_roomsToClose';
 IF response->>'unpaired'<>'true' OR response#>>'{session,status}'<>'closed' OR
   (SELECT count(*) FROM studio_camera_takes WHERE owner_id=u)<>preserved THEN RAISE EXCEPTION 'Unpair deleted originals or left capture open'; END IF;
 response:=studio_camera_action(u,'unpair',jsonb_build_object('controllerId',controller));
 IF response->'_roomsToClose' IS DISTINCT FROM closed_rooms OR jsonb_array_length(closed_rooms)=0 THEN RAISE EXCEPTION 'Repeated unpair lost provider teardown after a transient failure'; END IF;
 response:=studio_camera_action(u,'discover',jsonb_build_object('deviceId',device,'controllerId',controller));
 IF response->>'paired'<>'false' THEN RAISE EXCEPTION 'Revoked device retained automatic access'; END IF;
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('6',64)));
 IF response#>>'{session,status}'<>'pairing' THEN RAISE EXCEPTION 'Revocation skipped new QR'; END IF;
 -- Discovering a known pair never grants a new Premium preview token or REC.
 UPDATE profiles SET plan='free',plan_expires_at=NULL,subscription_status='expired' WHERE id=u;
 BEGIN PERFORM studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',controller,'pairingHash',repeat('5',64)));
  RAISE EXCEPTION 'Persistent pairing bypassed Premium'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'studio_camera_premium_required' THEN RAISE; END IF; END;
 UPDATE profiles SET plan='premium',plan_expires_at=now()+interval '1 day',subscription_status='active' WHERE id=u;
END $test$;
