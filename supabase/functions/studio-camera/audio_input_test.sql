SELECT set_config('request.jwt.claim.role','service_role',false);
DO $test$
DECLARE
 u uuid := '10000000-0000-4000-8000-000000000001';
 c uuid := '20000000-0000-4000-8000-0000000000e1'; d uuid := '30000000-0000-4000-8000-0000000000e1';
 s uuid; command uuid; response jsonb;
BEGIN
 INSERT INTO studio_camera_pairings(owner_id,controller_id,device_id) VALUES(u,c,d);
 response:=studio_camera_action(u,'create',jsonb_build_object('kind','aula','controllerId',c,'pairingHash',repeat('e',64)));
 s:=(response#>>'{session,id}')::uuid;
 PERFORM studio_camera_action(u,'heartbeat',jsonb_build_object('sessionId',s,'role','device','clientId',d,'state','{}'::jsonb));

 -- Only the confirmed configure ACK makes a manual native input durable.
 command:=gen_random_uuid();
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',command,'type','configure','payload','{"audioInputId":"USB-Audio-1"}'::jsonb));
 IF (SELECT configuration ? 'audioInputId' FROM studio_camera_sessions WHERE id=s) THEN RAISE EXCEPTION 'Pending microphone choice became durable before device ACK'; END IF;
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'commandId',command,'deviceId',d,'result','{"ok":true}'::jsonb));
 IF (SELECT configuration->>'audioInputId' FROM studio_camera_sessions WHERE id=s) IS DISTINCT FROM 'USB-Audio-1' THEN RAISE EXCEPTION 'Confirmed microphone UID was dropped'; END IF;

 -- Camera adjustments and quality changes keep the selected native microphone.
 command:=gen_random_uuid();
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',command,'type','configure','payload','{"resolution":"2k","pro":{"autoExposure":false,"iso":200}}'::jsonb));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'commandId',command,'deviceId',d,'result','{"ok":true}'::jsonb));
 IF NOT EXISTS(SELECT 1 FROM studio_camera_sessions WHERE id=s AND configuration->>'audioInputId'='USB-Audio-1' AND configuration->>'resolution'='2k' AND configuration#>>'{pro,iso}'='200') THEN RAISE EXCEPTION 'Camera configure reset audio selection'; END IF;

 -- A failed device selection never overwrites the last confirmed microphone.
 command:=gen_random_uuid();
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',command,'type','configure','payload','{"audioInputId":"Disconnected-USB"}'::jsonb));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'commandId',command,'deviceId',d,'result','{"ok":false,"error":"Input not available"}'::jsonb));
 IF (SELECT configuration->>'audioInputId' FROM studio_camera_sessions WHERE id=s) IS DISTINCT FROM 'USB-Audio-1' THEN RAISE EXCEPTION 'Failed selection replaced confirmed microphone'; END IF;

 -- Explicit null survives JSON merges and restores the system route.
 command:=gen_random_uuid();
 PERFORM studio_camera_action(u,'command',jsonb_build_object('sessionId',s,'commandId',command,'type','configure','payload','{"audioInputId":null}'::jsonb));
 PERFORM studio_camera_action(u,'ack',jsonb_build_object('sessionId',s,'commandId',command,'deviceId',d,'result','{"ok":true}'::jsonb));
 IF NOT EXISTS(SELECT 1 FROM studio_camera_sessions WHERE id=s AND configuration->'audioInputId'='null'::jsonb AND configuration#>>'{pro,iso}'='200') THEN RAISE EXCEPTION 'Automatic route was dropped or Pro configuration changed'; END IF;
 PERFORM studio_camera_action(u,'close',jsonb_build_object('sessionId',s));
END $test$;
