-- Retomada explícita do mesmo original, com ACK e estado fresco de transferência.
ALTER TABLE public.studio_camera_commands DROP CONSTRAINT IF EXISTS studio_camera_commands_type_check;
ALTER TABLE public.studio_camera_commands ADD CONSTRAINT studio_camera_commands_type_check CHECK(type IN ('configure','start','stop','resume_upload'));

CREATE OR REPLACE FUNCTION public.studio_camera_action(p_user uuid,p_action text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,storage,pg_temp AS $$
DECLARE
 v_session public.studio_camera_sessions%ROWTYPE; v_command public.studio_camera_commands%ROWTYPE;
 v_take public.studio_camera_takes%ROWTYPE; v_payload jsonb; v_result jsonb; v_metadata jsonb;
 v_id uuid; v_client uuid; v_type text; v_ok boolean; v_after bigint; v_path text; v_size bigint; v_mime text;
 v_part bigint; v_parts bigint; v_offset bigint; v_part_size bigint; v_complete_count bigint; v_total_size bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'studio_camera_service_required'; END IF;
 IF p_user IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' OR octet_length(p_params::text)>32768
   THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
 IF p_action='create' THEN
  PERFORM public.studio_camera_require_premium(p_user);
  -- Serialize owner allocation and cap abandoned pairing churn, without quotas on masters.
  PERFORM pg_advisory_xact_lock(hashtextextended('studio-camera:'||p_user::text,0));
  IF (SELECT count(*) FROM public.studio_camera_sessions WHERE owner_id=p_user AND created_at>now()-interval '10 minutes')>=10
   THEN RAISE EXCEPTION 'studio_camera_rate_limited'; END IF;
  IF (p_params->>'kind') NOT IN ('aula','short') OR (p_params->>'pairingHash') !~ '^[0-9a-f]{64}$'
   THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  v_client := (p_params->>'controllerId')::uuid;
  IF v_client IS NULL THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  INSERT INTO public.studio_camera_sessions(owner_id,project_id,kind,title,controller_id,pairing_hash)
   VALUES(p_user,NULLIF(p_params->>'projectId','')::uuid,p_params->>'kind',left(COALESCE(p_params->>'title',''),150),v_client,p_params->>'pairingHash')
   RETURNING * INTO v_session;
  RETURN public.studio_camera_snapshot(v_session.id);
 END IF;
 IF p_action='join' THEN
  PERFORM public.studio_camera_require_premium(p_user);
  -- Hash lookup is owner-scoped: a leaked QR never pairs another Classfy account.
  SELECT * INTO v_session FROM public.studio_camera_sessions
    WHERE owner_id=p_user AND pairing_hash=p_params->>'pairingHash' FOR UPDATE;
  v_client := (p_params->>'deviceId')::uuid;
  IF v_client IS NULL THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  IF NOT FOUND OR v_session.status='closed' THEN RAISE EXCEPTION 'studio_camera_pairing_unavailable'; END IF;
  -- The same request may be retried after a lost response. The consumed hash
  -- never authorizes another device; no raw code is retained.
  IF v_session.paired_at IS NOT NULL THEN
   IF v_session.device_id IS DISTINCT FROM v_client THEN RAISE EXCEPTION 'studio_camera_pairing_unavailable'; END IF;
   RETURN public.studio_camera_snapshot(v_session.id);
  END IF;
  IF v_session.status<>'pairing' OR v_session.pairing_expires_at<=now()
   THEN RAISE EXCEPTION 'studio_camera_pairing_unavailable'; END IF;
  UPDATE public.studio_camera_sessions SET device_id=v_client,paired_at=now(),status='ready',device_seen_at=now(),updated_at=now()
   WHERE id=v_session.id;
  RETURN public.studio_camera_snapshot(v_session.id);
 END IF;
 SELECT * INTO v_session FROM public.studio_camera_sessions
   WHERE id=(p_params->>'sessionId')::uuid AND owner_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'studio_camera_not_found'; END IF;
 IF p_action='status' THEN
  v_after := COALESCE((p_params->>'afterSequence')::bigint,0);
  IF v_after<0 OR v_after>v_session.sequence THEN RAISE EXCEPTION 'studio_camera_invalid_cursor'; END IF;
  RETURN public.studio_camera_snapshot(v_session.id,v_after);
 ELSIF p_action='connect' THEN
  PERFORM public.studio_camera_require_premium(p_user);
  IF v_session.status='closed' OR v_session.device_id IS NULL THEN RAISE EXCEPTION 'studio_camera_not_ready'; END IF;
  v_client := (p_params->>'clientId')::uuid;
  IF ((p_params->>'role')='controller' AND v_client=v_session.controller_id)
    OR ((p_params->>'role')='device' AND v_client=v_session.device_id) THEN
    RETURN public.studio_camera_snapshot(v_session.id);
  END IF;
  RAISE EXCEPTION 'studio_camera_client_mismatch';
 ELSIF p_action='heartbeat' THEN
  v_client := (p_params->>'clientId')::uuid;
  IF (p_params->>'role')='controller' AND v_client=v_session.controller_id THEN
   UPDATE public.studio_camera_sessions SET controller_seen_at=now(),updated_at=now() WHERE id=v_session.id;
  ELSIF (p_params->>'role')='device' AND v_client=v_session.device_id THEN
   UPDATE public.studio_camera_sessions SET device_seen_at=now(),device_state=COALESCE(p_params->'state','{}'),updated_at=now() WHERE id=v_session.id;
  ELSE RAISE EXCEPTION 'studio_camera_client_mismatch'; END IF;
  RETURN public.studio_camera_snapshot(v_session.id,COALESCE((p_params->>'afterSequence')::bigint,0));
 ELSIF p_action='command' THEN
  v_id := (p_params->>'commandId')::uuid; v_type := p_params->>'type'; v_payload := COALESCE(p_params->'payload','{}');
  IF v_id IS NULL OR v_type NOT IN ('configure','start','stop','resume_upload') OR jsonb_typeof(v_payload)<>'object'
    THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  IF v_type='stop' THEN v_payload := v_payload || jsonb_build_object('takeId',v_session.active_take_id); END IF;
  SELECT * INTO v_command FROM public.studio_camera_commands WHERE session_id=v_session.id AND id=v_id;
  IF FOUND THEN
   IF v_command.type<>v_type OR (v_type<>'stop' AND v_command.payload<>v_payload)
    THEN RAISE EXCEPTION 'studio_camera_command_conflict'; END IF;
   RETURN public.studio_camera_snapshot(v_session.id) || jsonb_build_object('command',jsonb_build_object('id',v_command.id,
    'sequence',v_command.sequence,'type',v_command.type,'payload',v_command.payload,'status',v_command.status,
    'createdAt',v_command.created_at,'acknowledgedAt',v_command.acknowledged_at,'result',v_command.result));
  END IF;
  IF v_type IN ('start','configure') THEN PERFORM public.studio_camera_require_premium(p_user); END IF;
  IF (v_session.status='closed' AND v_type<>'resume_upload') OR v_session.device_id IS NULL THEN RAISE EXCEPTION 'studio_camera_not_ready'; END IF;
  IF v_type IN ('start','configure','resume_upload') AND
    (v_session.device_seen_at IS NULL OR v_session.device_seen_at<now()-interval '30 seconds')
    THEN RAISE EXCEPTION 'studio_camera_device_offline'; END IF;
  IF v_type='configure' THEN
   IF v_session.status<>'ready' OR EXISTS(SELECT 1 FROM public.studio_camera_commands WHERE session_id=v_session.id AND status='pending')
    THEN RAISE EXCEPTION 'studio_camera_busy'; END IF;
  ELSIF v_type='start' THEN
   IF v_session.status<>'ready' OR EXISTS(SELECT 1 FROM public.studio_camera_commands WHERE session_id=v_session.id AND status='pending')
    THEN RAISE EXCEPTION 'studio_camera_busy'; END IF;
   v_client := (v_payload->>'takeId')::uuid;
   IF v_client IS NULL THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
   IF EXISTS(SELECT 1 FROM public.studio_camera_takes WHERE session_id=v_session.id AND id=v_client)
    THEN RAISE EXCEPTION 'studio_camera_take_conflict'; END IF;
   INSERT INTO public.studio_camera_takes(id,session_id,owner_id) VALUES(v_client,v_session.id,p_user);
   UPDATE public.studio_camera_sessions SET status='starting',active_take_id=v_client WHERE id=v_session.id;
  ELSIF v_type='resume_upload' THEN
   -- Receiving an already-owned original remains available after Premium expires,
   -- including a closed preview session. A new REC must never overlap recovery.
   IF v_session.status IN ('starting','recording','stopping') OR v_session.active_take_id IS NOT NULL
     OR v_session.device_state->>'recording'='true'
     OR EXISTS(SELECT 1 FROM public.studio_camera_commands WHERE session_id=v_session.id AND status='pending')
     THEN RAISE EXCEPTION 'studio_camera_busy'; END IF;
   v_client := (v_payload->>'takeId')::uuid;
   IF v_client IS NULL THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
   SELECT * INTO v_take FROM public.studio_camera_takes WHERE session_id=v_session.id AND id=v_client AND owner_id=p_user FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'studio_camera_take_not_found'; END IF;
   IF v_take.status NOT IN ('local_ready','uploading','uploaded','failed') THEN RAISE EXCEPTION 'studio_camera_original_not_ready'; END IF;
  ELSE
   IF v_session.status NOT IN ('starting','recording','stopping') THEN RAISE EXCEPTION 'studio_camera_not_recording'; END IF;
   IF EXISTS(SELECT 1 FROM public.studio_camera_commands WHERE session_id=v_session.id AND type='stop' AND status='pending')
     THEN RAISE EXCEPTION 'studio_camera_busy'; END IF;
   UPDATE public.studio_camera_sessions SET status='stopping' WHERE id=v_session.id;
  END IF;
  UPDATE public.studio_camera_sessions SET sequence=sequence+1,updated_at=now() WHERE id=v_session.id RETURNING sequence INTO v_after;
  INSERT INTO public.studio_camera_commands(id,session_id,sequence,type,payload) VALUES(v_id,v_session.id,v_after,v_type,v_payload)
   RETURNING * INTO v_command;
  RETURN public.studio_camera_snapshot(v_session.id) || jsonb_build_object('command',jsonb_build_object('id',v_command.id,
    'sequence',v_command.sequence,'type',v_command.type,'payload',v_command.payload,'status',v_command.status,
    'createdAt',v_command.created_at,'acknowledgedAt',NULL,'result',NULL));
 ELSIF p_action='ack' THEN
  IF (p_params->>'deviceId')::uuid IS DISTINCT FROM v_session.device_id THEN RAISE EXCEPTION 'studio_camera_client_mismatch'; END IF;
  SELECT * INTO v_command FROM public.studio_camera_commands WHERE session_id=v_session.id AND id=(p_params->>'commandId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_camera_command_not_found'; END IF;
  v_result := p_params->'result'; v_ok := COALESCE((v_result->>'ok')::boolean,false);
  IF jsonb_typeof(v_result) IS DISTINCT FROM 'object' OR jsonb_typeof(v_result->'ok') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  IF v_command.type IN ('start','stop','resume_upload') AND v_result ? 'takeId' AND
    (v_result->>'takeId')::uuid IS DISTINCT FROM (v_command.payload->>'takeId')::uuid
    THEN RAISE EXCEPTION 'studio_camera_take_conflict'; END IF;
  IF v_command.type='resume_upload' AND v_ok THEN
   IF NOT (v_result ?& ARRAY['takeId','uploadState','uploadResumedAtServerMs'])
     OR (v_result->>'takeId')::uuid IS DISTINCT FROM (v_command.payload->>'takeId')::uuid
     OR (v_result->>'uploadState') NOT IN ('uploading','complete')
     OR jsonb_typeof(v_result->'uploadResumedAtServerMs') IS DISTINCT FROM 'number'
     OR (v_result->>'uploadResumedAtServerMs')::numeric NOT BETWEEN 1 AND 9007199254740991
     THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  END IF;
  IF v_command.status<>'pending' THEN
   IF v_command.result IS DISTINCT FROM v_result THEN RAISE EXCEPTION 'studio_camera_ack_conflict'; END IF;
   RETURN public.studio_camera_snapshot(v_session.id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.studio_camera_commands WHERE session_id=v_session.id AND sequence<v_command.sequence AND status='pending')
    THEN RAISE EXCEPTION 'studio_camera_ack_out_of_order'; END IF;
  UPDATE public.studio_camera_commands SET status=CASE WHEN v_ok THEN 'applied' ELSE 'failed' END,result=v_result,acknowledged_at=now()
   WHERE session_id=v_session.id AND id=v_command.id;
  IF v_command.type='configure' AND v_ok THEN
   UPDATE public.studio_camera_sessions SET configuration=v_session.configuration||v_command.payload WHERE id=v_session.id;
  ELSIF v_command.type='start' THEN
   UPDATE public.studio_camera_takes SET status=CASE WHEN v_ok THEN 'recording' ELSE 'failed' END
    WHERE session_id=v_session.id AND id=(v_command.payload->>'takeId')::uuid;
   UPDATE public.studio_camera_sessions SET status=CASE WHEN status='stopping' THEN 'stopping' WHEN v_ok THEN 'recording' ELSE 'ready' END,
     active_take_id=CASE WHEN v_ok OR status='stopping' THEN active_take_id ELSE NULL END WHERE id=v_session.id;
  ELSIF v_command.type='stop' THEN
   IF v_ok THEN
    UPDATE public.studio_camera_takes SET status='local_ready',metadata=v_result->'metadata'
      WHERE session_id=v_session.id AND id=(v_command.payload->>'takeId')::uuid AND status IN ('reserved','recording');
    UPDATE public.studio_camera_sessions SET status='ready',active_take_id=NULL WHERE id=v_session.id;
   ELSE
    UPDATE public.studio_camera_sessions SET status='recording' WHERE id=v_session.id;
   END IF;
  END IF;
  -- Resume ACK contains transfer fields only: merge them with the last camera
  -- snapshot so dimensions, configuration and Pro capabilities remain confirmed.
  -- An ACK never marks an original uploaded: storage byte verification owns that.
  UPDATE public.studio_camera_sessions SET device_state=CASE WHEN v_command.type='resume_upload' AND v_ok THEN
    device_state || COALESCE(v_result->'state','{}') || jsonb_build_object('uploadTakeId',v_command.payload->>'takeId',
      'uploadState',v_result->>'uploadState','uploadError',NULL,'uploadResumedAtServerMs',v_result->'uploadResumedAtServerMs') ||
      CASE WHEN v_result ? 'uploadProgressBytes' THEN jsonb_build_object('uploadProgressBytes',v_result->'uploadProgressBytes') ELSE '{}'::jsonb END ||
      CASE WHEN v_result ? 'uploadTotalBytes' THEN jsonb_build_object('uploadTotalBytes',v_result->'uploadTotalBytes') ELSE '{}'::jsonb END
    ELSE COALESCE(v_result->'state',device_state) END,device_seen_at=now(),updated_at=now() WHERE id=v_session.id;
  RETURN public.studio_camera_snapshot(v_session.id);
 ELSIF p_action IN ('upload-start','upload-complete','download') THEN
  SELECT * INTO v_take FROM public.studio_camera_takes WHERE session_id=v_session.id AND id=(p_params->>'takeId')::uuid AND owner_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_camera_take_not_found'; END IF;
  IF p_action='upload-start' THEN
   IF v_take.status NOT IN ('local_ready','uploading','uploaded') THEN
    IF COALESCE((p_params->>'recovered')::boolean,false) IS DISTINCT FROM true OR
      (p_params->>'deviceId')::uuid IS DISTINCT FROM v_session.device_id OR v_session.device_id IS NULL OR
      v_take.status NOT IN ('reserved','recording','failed') THEN RAISE EXCEPTION 'studio_camera_original_not_ready'; END IF;
   END IF;
   v_metadata := p_params->'metadata';
   IF jsonb_typeof(v_metadata) IS DISTINCT FROM 'object' OR NOT (v_metadata ?& ARRAY['bytes','mime','width','height','fps','duration']) OR
     (v_metadata->>'bytes')::bigint NOT BETWEEN 1 AND 9007199254740991 OR
     (v_metadata->>'mime') NOT IN ('video/quicktime','video/mp4') OR
     (v_metadata->>'width')::int NOT BETWEEN 1 AND 7680 OR (v_metadata->>'height')::int NOT BETWEEN 1 AND 7680 OR
     (v_metadata->>'fps')::numeric NOT BETWEEN 1 AND 120 OR (v_metadata->>'duration')::numeric NOT BETWEEN 0.001 AND 86400
      THEN RAISE EXCEPTION 'studio_camera_invalid_metadata'; END IF;
   IF v_take.metadata IS NOT NULL AND v_take.metadata<>v_metadata THEN RAISE EXCEPTION 'studio_camera_metadata_conflict'; END IF;
   v_parts := ceil((v_metadata->>'bytes')::numeric/6291456)::bigint;
   v_part := COALESCE((p_params->>'partIndex')::bigint,0);
   IF v_parts>100000 OR v_part<0 OR v_part>=v_parts THEN RAISE EXCEPTION 'studio_camera_invalid_part'; END IF;
   IF COALESCE((p_params->>'recovered')::boolean,false) THEN
    IF (p_params->>'deviceId')::uuid IS DISTINCT FROM v_session.device_id OR v_session.device_id IS NULL
      THEN RAISE EXCEPTION 'studio_camera_client_mismatch'; END IF;
    UPDATE public.studio_camera_commands SET status='failed',result=jsonb_build_object('ok',false,'error','studio_camera_local_original_recovered'),
     acknowledged_at=now() WHERE session_id=v_session.id AND status='pending' AND type IN ('start','stop') AND
     (payload->>'takeId')::uuid=v_take.id;
    UPDATE public.studio_camera_sessions SET active_take_id=NULL,status=CASE WHEN status='closed' THEN status ELSE 'ready' END,updated_at=now()
     WHERE id=v_session.id AND active_take_id=v_take.id;
   END IF;
   v_path := p_user::text||'/'||v_session.id::text||'/'||v_take.id::text||
      CASE WHEN v_parts=1 THEN CASE WHEN v_metadata->>'mime'='video/quicktime' THEN '.mov' ELSE '.mp4' END ELSE '' END;
   UPDATE public.studio_camera_takes SET metadata=v_metadata,object_path=v_path,
    status=CASE WHEN status='uploaded' THEN status ELSE 'uploading' END WHERE session_id=v_session.id AND id=v_take.id;
   v_offset := v_part*6291456; v_part_size:=least(6291456,(v_metadata->>'bytes')::bigint-v_offset);
   RETURN public.studio_camera_snapshot(v_session.id) || jsonb_build_object('_objectPath',
    CASE WHEN v_parts=1 THEN v_path ELSE v_path||'/part-'||lpad(v_part::text,6,'0')||'.bin' END,
    '_partIndex',v_part,'_partOffset',v_offset,'_partBytes',v_part_size,'_totalParts',v_parts,
    '_partMime',CASE WHEN v_parts=1 THEN v_metadata->>'mime' ELSE 'application/octet-stream' END,
    '_partUploaded',EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='studio-camera-originals' AND
     o.name=CASE WHEN v_parts=1 THEN v_path ELSE v_path||'/part-'||lpad(v_part::text,6,'0')||'.bin' END AND
     (o.metadata->>'size')::bigint=v_part_size AND o.metadata->>'mimetype'=CASE WHEN v_parts=1 THEN v_metadata->>'mime' ELSE 'application/octet-stream' END));
  ELSIF p_action='upload-complete' THEN
   IF v_take.status NOT IN ('uploading','uploaded') THEN RAISE EXCEPTION 'studio_camera_original_not_ready'; END IF;
   v_parts:=ceil((v_take.metadata->>'bytes')::numeric/6291456)::bigint;
   SELECT count(*),sum((o.metadata->>'size')::bigint) INTO v_complete_count,v_total_size
    FROM generate_series(0,v_parts-1) n
    JOIN storage.objects o ON o.bucket_id='studio-camera-originals' AND o.name=
     CASE WHEN v_parts=1 THEN v_take.object_path ELSE v_take.object_path||'/part-'||lpad(n::text,6,'0')||'.bin' END
    WHERE (o.metadata->>'size')::bigint=least(6291456,(v_take.metadata->>'bytes')::bigint-n*6291456)
     AND o.metadata->>'mimetype'=CASE WHEN v_parts=1 THEN v_take.metadata->>'mime' ELSE 'application/octet-stream' END;
   IF v_complete_count IS DISTINCT FROM v_parts OR v_total_size IS DISTINCT FROM (v_take.metadata->>'bytes')::bigint
     THEN RAISE EXCEPTION 'studio_camera_original_incomplete'; END IF;
   UPDATE public.studio_camera_takes SET status='uploaded',uploaded_at=COALESCE(uploaded_at,now()) WHERE session_id=v_session.id AND id=v_take.id;
   v_path:=v_take.object_path;
  ELSE
   IF v_take.status<>'uploaded' THEN RAISE EXCEPTION 'studio_camera_original_not_ready'; END IF;
   v_path:=v_take.object_path;
  END IF;
  RETURN public.studio_camera_snapshot(v_session.id) || jsonb_build_object('_objectPath',v_path);
 ELSIF p_action='close' THEN
  IF v_session.status IN ('starting','recording','stopping') THEN RAISE EXCEPTION 'studio_camera_stop_required'; END IF;
  UPDATE public.studio_camera_sessions SET status='closed',pairing_hash=NULL,closed_at=COALESCE(closed_at,now()),updated_at=now() WHERE id=v_session.id;
  RETURN public.studio_camera_snapshot(v_session.id);
 END IF;
 RAISE EXCEPTION 'studio_camera_unknown_action';
END $$;

REVOKE ALL ON FUNCTION public.studio_camera_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_action(uuid,text,jsonb) TO service_role;
