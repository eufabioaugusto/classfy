BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
CREATE OR REPLACE FUNCTION pg_temp.expect_thumbnail_failure(query text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%'||expected||'%' THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected thumbnail rejection: %',expected;
END $$;
DO $$
DECLARE u uuid:='10000000-0000-4000-8000-000000000001'; other_u uuid:='10000000-0000-4000-8000-000000000002';
 s uuid:='70000000-0000-4000-8000-00000000aa01'; c uuid:='70000000-0000-4000-8000-00000000aa02'; d uuid:='70000000-0000-4000-8000-00000000aa03';
 t uuid:='70000000-0000-4000-8000-00000000aa04'; reserved uuid:='70000000-0000-4000-8000-00000000aa05'; missing uuid:='70000000-0000-4000-8000-00000000aa06';
 old_t uuid:='70000000-0000-4000-8000-00000000aa07'; cmd uuid:='70000000-0000-4000-8000-00000000aa08';
 descriptor jsonb:=jsonb_build_object('version',1,'bytes',1000,'mime','image/jpeg','width',160,'height',90,'hash',repeat('a',64));
 raw jsonb:='{"bytes":2747050311,"mime":"video/quicktime","width":3840,"height":2160,"fps":30,"duration":777}'::jsonb;
 input jsonb; response jsonb; before_take jsonb; before_session jsonb; item jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='studio-camera-thumbnails' AND public=false AND file_size_limit=32768 AND allowed_mime_types=ARRAY['image/jpeg']) THEN RAISE EXCEPTION 'Invalid private thumbnail bucket'; END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='studio-camera-originals' AND (public<>false OR 'image/jpeg'=ANY(allowed_mime_types))) THEN RAISE EXCEPTION 'Original bucket was broadened'; END IF;
 INSERT INTO studio_camera_sessions(id,owner_id,controller_id,device_id,kind,status,device_state)
  VALUES(s,u,c,d,'aula','closed',jsonb_build_object('capabilities',jsonb_build_object('localTakeStorage',1),'localTakes',jsonb_build_array(
   jsonb_build_object('id',t,'metadata',raw,'localSaved',true,'phase','local_ready'))));
 INSERT INTO studio_camera_takes(id,session_id,owner_id,status) VALUES(t,s,u,'local_ready'),(reserved,s,u,'recording'),(missing,s,u,'failed'),(old_t,s,u,'local_ready');
 input:=jsonb_build_object('sessionId',s,'takeId',t,'role','device','clientId',d,'thumbnail',descriptor,'confirmed',false);
 SELECT to_jsonb(v)-'thumbnail' INTO before_take FROM studio_camera_takes v WHERE session_id=s AND id=t;
 SELECT to_jsonb(v) INTO before_session FROM studio_camera_sessions v WHERE id=s;
 response:=studio_camera_thumbnail_action(u,'thumbnail_put',input);
 IF response->'thumbnail'<>descriptor OR response->>'_objectPath'<>u::text||'/'||s::text||'/'||t::text||'/v1.jpg' OR EXISTS(SELECT 1 FROM studio_camera_takes WHERE session_id=s AND id=t AND thumbnail IS NOT NULL) THEN RAISE EXCEPTION 'Prepare wrote state or trusted path'; END IF;
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_put',input||'{"confirmed":true}'::jsonb),'studio_camera_thumbnail_unavailable');
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('studio-camera-thumbnails',u::text||'/'||s::text||'/'||t::text||'/v1.jpg','{"mimetype":"image/jpeg","size":1000}');
 response:=studio_camera_thumbnail_action(u,'thumbnail_put',input||'{"confirmed":true}'::jsonb);
 response:=studio_camera_thumbnail_action(u,'thumbnail_put',input||'{"confirmed":true}'::jsonb);
 IF (SELECT to_jsonb(v)-'thumbnail' FROM studio_camera_takes v WHERE session_id=s AND id=t)<>before_take OR (SELECT to_jsonb(v) FROM studio_camera_sessions v WHERE id=s)<>before_session THEN RAISE EXCEPTION 'Thumbnail modified original/session authority'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(studio_camera_snapshot(s)->'takes') v WHERE v->>'id'=t::text AND v->'thumbnail'=descriptor AND v->'metadata'='null'::jsonb) THEN RAISE EXCEPTION 'Snapshot lost durable thumbnail or forged master'; END IF;
 response:=studio_camera_thumbnail_action(u,'thumbnail_get',jsonb_build_object('sessionId',s,'takeId',t,'role','controller','clientId',c));
 IF response->'thumbnail'<>descriptor OR response ? 'session' THEN RAISE EXCEPTION 'Historical read returned wrong shape'; END IF;
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',other_u,'thumbnail_put',input),'studio_camera_not_found');
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',other_u,'thumbnail_get',input||jsonb_build_object('role','controller','clientId',c)),'studio_camera_not_found');
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_put',input||jsonb_build_object('clientId',c)),'studio_camera_client_mismatch');
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_get',input||jsonb_build_object('role','controller','clientId',d)),'studio_camera_client_mismatch');
 FOR item IN SELECT value FROM jsonb_array_elements(jsonb_build_array(descriptor||'{"bytes":16385}',descriptor||'{"width":321}',descriptor||'{"mime":null}',descriptor||'{"hash":"bad"}',descriptor||'{"url":"https://public"}')) LOOP
  PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_put',input||jsonb_build_object('thumbnail',item)),'studio_camera_invalid_thumbnail');
 END LOOP;
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_put',input||jsonb_build_object('thumbnail',descriptor||jsonb_build_object('hash',repeat('b',64)))),'studio_camera_thumbnail_conflict');
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_put',input||jsonb_build_object('takeId',reserved)),'studio_camera_original_not_ready');
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_put',input||jsonb_build_object('takeId',missing)),'studio_camera_original_not_ready');
 -- A trimmed latest catalog still retains the immutable applied STOP proof.
 INSERT INTO studio_camera_commands(id,session_id,sequence,type,payload,status,acknowledged_at,result) VALUES(cmd,s,1,'stop',jsonb_build_object('takeId',old_t),'applied',now(),
  jsonb_build_object('ok',true,'takeId',old_t,'state',jsonb_build_object('capabilities',jsonb_build_object('localTakeStorage',1),'localTakes',jsonb_build_array(jsonb_build_object('id',old_t,'metadata',raw,'localSaved',true,'phase','local_ready')))));
 response:=studio_camera_thumbnail_action(u,'thumbnail_put',input||jsonb_build_object('takeId',old_t));
 IF response->'thumbnail'<>descriptor THEN RAISE EXCEPTION 'Historical source proof unavailable'; END IF;
 -- Missing capability cannot turn a valid-looking unrelated catalog into proof.
 UPDATE studio_camera_sessions SET device_state=jsonb_build_object('localTakes',jsonb_build_array(jsonb_build_object('id',missing,'metadata',raw,'localSaved',true,'phase','local_ready'))) WHERE id=s;
 PERFORM pg_temp.expect_thumbnail_failure(format('SELECT studio_camera_thumbnail_action(%L,%L,%L)',u,'thumbnail_put',input||jsonb_build_object('takeId',missing)),'studio_camera_original_not_ready');
 IF has_function_privilege('anon','public.studio_camera_thumbnail_action(uuid,text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.studio_camera_thumbnail_action(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Thumbnail RPC granted directly'; END IF;
END $$;
-- Even a pre-existing permissive storage policy cannot expose private JPEGs.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='studio-camera-thumbnails') THEN RAISE EXCEPTION 'Direct thumbnail read leaked'; END IF;
 BEGIN INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('studio-camera-thumbnails','forged/v1.jpg','{}'); RAISE EXCEPTION 'Direct thumbnail insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE storage.objects SET name='changed' WHERE bucket_id='studio-camera-thumbnails'; IF FOUND THEN RAISE EXCEPTION 'Direct thumbnail update accepted'; END IF;
 DELETE FROM storage.objects WHERE bucket_id='studio-camera-thumbnails'; IF FOUND THEN RAISE EXCEPTION 'Direct thumbnail delete accepted'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
