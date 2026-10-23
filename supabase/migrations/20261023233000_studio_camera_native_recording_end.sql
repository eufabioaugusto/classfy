-- A native writer may finish while the browser still believes REC is active.
-- A versioned local-file receipt can finalize only that exact active take.
ALTER TABLE public.studio_camera_takes ADD COLUMN IF NOT EXISTS recording_end jsonb;
COMMENT ON COLUMN public.studio_camera_takes.recording_end IS
 'Validated native capture end and raw local-file proof, independent of optional upload metadata.';

CREATE OR REPLACE FUNCTION public.studio_camera_reconcile_native_end(p_user uuid,p_session uuid,p_device uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.studio_camera_sessions%ROWTYPE; t public.studio_camera_takes%ROWTYPE;
 start_command public.studio_camera_commands%ROWTYPE; ending jsonb; source jsonb;
 finished numeric; started numeric; duration_seconds numeric; current_ms numeric;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'studio_camera_service_required'; END IF;
 IF p_user IS NULL OR p_session IS NULL OR p_device IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('studio-camera:'||p_user::text,0));
 SELECT * INTO s FROM public.studio_camera_sessions WHERE id=p_session AND owner_id=p_user FOR UPDATE;
 IF NOT FOUND OR s.device_id IS DISTINCT FROM p_device OR s.status NOT IN ('recording','stopping') OR s.active_take_id IS NULL
  OR s.device_state->'recording' IS DISTINCT FROM 'false'::jsonb
  OR s.device_state#>'{capabilities,localTakeStorage}' IS DISTINCT FROM '1'::jsonb
  OR s.device_state->>'uploading'='true' OR s.device_state->>'processing'='true'
  OR s.device_state->>'uploadState'='uploading' THEN RETURN false; END IF;
 ending:=s.device_state->'recordingEnd';
 IF jsonb_typeof(ending) IS DISTINCT FROM 'object' OR ending->'version' IS DISTINCT FROM '1'::jsonb
  OR ending->'interrupted' IS DISTINCT FROM 'true'::jsonb
  OR ending->>'takeId' IS DISTINCT FROM s.active_take_id::text
  OR COALESCE(ending->>'reason','') NOT IN ('app_background','view_inactive','disposed','capture_interrupted','runtime_error','startup_timeout','native_finished')
  OR jsonb_typeof(ending->'finishedAtServerMs') IS DISTINCT FROM 'number'
  OR jsonb_typeof(ending->'durationSeconds') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 finished:=(ending->>'finishedAtServerMs')::numeric; duration_seconds:=(ending->>'durationSeconds')::numeric;
 current_ms:=extract(epoch FROM clock_timestamp())*1000;
 IF finished NOT BETWEEN 1 AND 9007199254740991 OR duration_seconds NOT BETWEEN 0.001 AND 86400
  OR finished>current_ms+120000 THEN RETURN false; END IF;
 SELECT * INTO t FROM public.studio_camera_takes WHERE session_id=s.id AND id=s.active_take_id AND owner_id=p_user FOR UPDATE;
 IF NOT FOUND OR t.status NOT IN ('reserved','recording') OR t.recording_end IS NOT NULL THEN RETURN false; END IF;
 -- START/resume and an unrelated STOP can never be bypassed by this receipt.
 -- A reversible configure from the interrupted take can be resolved below.
 IF EXISTS(SELECT 1 FROM public.studio_camera_commands c WHERE c.session_id=s.id AND c.status='pending'
  AND (c.type IN ('start','resume_upload') OR c.type='stop' AND c.payload->>'takeId' IS DISTINCT FROM t.id::text)) THEN RETURN false; END IF;
 SELECT * INTO start_command FROM public.studio_camera_commands c WHERE c.session_id=s.id AND c.type='start'
  AND c.payload->>'takeId'=t.id::text AND c.result->>'takeId'=t.id::text
  AND c.status='applied' AND c.result->'ok'='true'::jsonb AND c.acknowledged_at IS NOT NULL
  AND jsonb_typeof(c.result->'startedAtServerMs')='number' ORDER BY c.sequence DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 started:=(start_command.result->>'startedAtServerMs')::numeric;
 IF started NOT BETWEEN 1 AND 9007199254740991 OR finished<started
  OR finished-started>86520000 OR duration_seconds*1000>finished-started+3000 THEN RETURN false; END IF;
 -- One unambiguous catalog entry must own this local file, not a favorable
 -- duplicate picked from contradictory local-save or transfer states.
 IF (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.device_state->'localTakes')='array'
  THEN s.device_state->'localTakes' ELSE '[]'::jsonb END) item WHERE item->>'id'=t.id::text)<>1 THEN RETURN false; END IF;
 -- Media duration may be shorter than wall time if the native writer omitted
 -- gaps. Do not turn a genuine partial source into a rejection or claim fullness.
 SELECT item->'metadata' INTO source FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.device_state->'localTakes')='array'
  THEN s.device_state->'localTakes' ELSE '[]'::jsonb END) item
  WHERE item->>'id'=t.id::text AND item->'localSaved'='true'::jsonb
   AND item->>'phase' IN ('local_ready','error')
   AND CASE WHEN public.studio_camera_local_metadata_valid(item->'metadata')
    THEN abs((item#>>'{metadata,duration}')::numeric-duration_seconds)<=0.1 ELSE false END LIMIT 1;
 IF source IS NULL THEN RETURN false; END IF;
 UPDATE public.studio_camera_takes SET status='local_ready',recording_end=ending||jsonb_build_object(
  'startedAtServerMs',started,'sourceMetadata',source,'localTakeStorage',1,'reconciledAtServerMs',current_ms)
  WHERE session_id=s.id AND id=t.id AND owner_id=p_user;
 -- No synthetic successful ACK: resolve this take's pending STOP and abandoned
 -- reversible configure. The active-take proof above excludes a newer REC.
 -- Applied ACKs are immutable and a late callback cannot close another REC.
 UPDATE public.studio_camera_commands SET status='failed',acknowledged_at=now(),result=jsonb_build_object(
  'ok',false,'takeId',t.id,'error','studio_camera_native_recording_ended','recordingEnd',ending)
  WHERE session_id=s.id AND status='pending' AND (type='configure' OR type='stop' AND payload->>'takeId'=t.id::text);
 UPDATE public.studio_camera_sessions SET status='ready',active_take_id=NULL,updated_at=now()
  WHERE id=s.id AND owner_id=p_user AND active_take_id=t.id AND status IN ('recording','stopping');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_reconcile_native_end(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_reconcile_native_end(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.studio_camera_snapshot(p_session uuid,p_after bigint DEFAULT 0)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public,pg_temp AS $$
 SELECT jsonb_build_object(
  'serverAt',now(),
  'session', jsonb_build_object('id',s.id,'ownerId',s.owner_id,'projectId',s.project_id,'kind',s.kind,'title',s.title,
   'controllerId',s.controller_id,'deviceId',s.device_id,'status',s.status,'sequence',s.sequence,'activeTakeId',s.active_take_id,
   'configuration',s.configuration,'deviceState',s.device_state,'createdAt',s.created_at,'expiresAt',s.pairing_expires_at,
   'pairedAt',s.paired_at,'controllerSeenAt',s.controller_seen_at,'deviceSeenAt',s.device_seen_at,'closedAt',s.closed_at),
  'commands',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'type',c.type,'payload',c.payload,
   'status',c.status,'result',c.result,'createdAt',c.created_at,'acknowledgedAt',c.acknowledged_at) ORDER BY c.sequence)
   FROM public.studio_camera_commands c WHERE c.session_id=s.id AND
    (c.sequence>p_after OR c.status<>'pending')),'[]'::jsonb),
  'takes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'metadata',t.metadata,'recordingEnd',t.recording_end,
   'createdAt',t.created_at,'uploadedAt',t.uploaded_at) ORDER BY t.created_at)
   FROM public.studio_camera_takes t WHERE t.session_id=s.id),'[]'::jsonb))
 FROM public.studio_camera_sessions s WHERE s.id=p_session
$$;


CREATE OR REPLACE FUNCTION public.studio_camera_local_handoff_allowed(p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.studio_camera_sessions s WHERE s.id=p_session
  AND s.status NOT IN ('starting','recording','stopping') AND s.active_take_id IS NULL
  AND s.device_state#>'{capabilities,localTakeStorage}'='1'::jsonb
  AND s.device_state->>'recording' IS DISTINCT FROM 'true'
  AND s.device_state->>'processing' IS DISTINCT FROM 'true'
  AND s.device_state->>'uploading' IS DISTINCT FROM 'true'
  AND COALESCE(s.device_state->>'uploadState','idle') IN ('idle','paused','complete')
  AND NOT EXISTS(SELECT 1 FROM public.studio_camera_commands c WHERE c.session_id=s.id
   AND c.status='pending' AND c.type IN ('start','stop','resume_upload'))
  AND NOT EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id AND t.status IN ('reserved','recording'))
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.device_state->'localTakes')='array'
   THEN s.device_state->'localTakes' ELSE '[]'::jsonb END) item WHERE item->>'phase' IN ('preparing','uploading'))
  AND EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id AND t.status IN ('local_ready','uploading','failed'))
  AND NOT EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id
   AND t.status IN ('local_ready','uploading','failed') AND (t.owner_id<>s.owner_id OR NOT (
    EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.device_state->'localTakes')='array'
     THEN s.device_state->'localTakes' ELSE '[]'::jsonb END) item
     WHERE item->>'id'=t.id::text AND item->'localSaved'='true'::jsonb
      AND item->>'phase' IN ('local_ready','uploaded','error')
      AND public.studio_camera_local_metadata_valid(item->'metadata'))
    OR (t.recording_end->'version'='1'::jsonb AND t.recording_end->'interrupted'='true'::jsonb
     AND t.recording_end->'localTakeStorage'='1'::jsonb AND t.recording_end->>'takeId'=t.id::text
     AND public.studio_camera_local_metadata_valid(t.recording_end->'sourceMetadata'))
    OR EXISTS(SELECT 1 FROM public.studio_camera_commands c WHERE c.session_id=s.id
     AND c.type='stop' AND c.status='applied' AND c.acknowledged_at IS NOT NULL
     AND c.payload->>'takeId'=t.id::text AND c.result->>'takeId'=t.id::text
     AND c.result->'ok'='true'::jsonb
     AND c.result#>'{state,capabilities,localTakeStorage}'='1'::jsonb
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.result#>'{state,localTakes}')='array'
      THEN c.result#>'{state,localTakes}' ELSE '[]'::jsonb END) saved
      WHERE saved->>'id'=t.id::text AND saved->'localSaved'='true'::jsonb
       AND saved->>'phase' IN ('local_ready','uploaded','error')
       AND public.studio_camera_local_metadata_valid(saved->'metadata')))
   )))
 )
$$;
REVOKE ALL ON FUNCTION public.studio_camera_local_handoff_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_local_handoff_allowed(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.studio_camera_control_action(p_user uuid,p_action text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE v_session public.studio_camera_sessions%ROWTYPE; v_pairing public.studio_camera_pairings%ROWTYPE;
 v_id uuid; v_client uuid; v_response jsonb;
BEGIN
 -- First retain all original role/owner/device validation and the heartbeat.
 -- A false/old snapshot alone never changes REC authority.
 IF p_action='heartbeat' AND p_params->>'role'='device' THEN
  v_response:=public.studio_camera_local_legacy_action(p_user,p_action,p_params);
  IF public.studio_camera_reconcile_native_end(p_user,(p_params->>'sessionId')::uuid,(p_params->>'clientId')::uuid) THEN
   RETURN public.studio_camera_snapshot((p_params->>'sessionId')::uuid,COALESCE((p_params->>'afterSequence')::bigint,0));
  END IF;
  RETURN v_response;
 END IF;
 IF p_action IS DISTINCT FROM 'discover' THEN
  RETURN public.studio_camera_local_legacy_action(p_user,p_action,p_params);
 END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'studio_camera_service_required'; END IF;
 IF p_user IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' OR octet_length(p_params::text)>32768
  THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  v_client := (p_params->>'deviceId')::uuid;
  IF v_client IS NULL THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('studio-camera:'||p_user::text,0));
  v_id := (p_params->>'controllerId')::uuid;
  -- An explicit invalid/revoked installation never gains access by fallback.
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_pairing FROM public.studio_camera_pairings
    WHERE owner_id=p_user AND device_id=v_client AND controller_id=v_id AND revoked_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN
    RETURN jsonb_build_object('ownerId',p_user,'paired',false,'controllerId',NULL,'session',NULL,'commands','[]'::jsonb,'takes','[]'::jsonb,'serverAt',now());
   END IF;
  END IF;
  -- Legacy versions could leave several rooms open for one physical iPhone.
  -- A real capture/transfer wins over a paused recoverable original; a paused
  -- original wins over a newer idle room that would hide its session-scoped retry.
  SELECT s.* INTO v_session FROM public.studio_camera_sessions s
   JOIN public.studio_camera_pairings p ON p.owner_id=s.owner_id AND p.controller_id=s.controller_id AND p.device_id=s.device_id
   WHERE s.owner_id=p_user AND s.device_id=v_client AND s.status<>'closed' AND p.revoked_at IS NULL
   ORDER BY CASE
    WHEN s.status IN ('starting','recording','stopping') OR s.active_take_id IS NOT NULL
     OR s.device_state->>'recording'='true' OR s.device_state->>'processing'='true'
     OR s.device_state->>'uploading'='true' OR s.device_state->>'uploadState'='uploading'
     OR EXISTS(SELECT 1 FROM public.studio_camera_commands c WHERE c.session_id=s.id AND c.status='pending' AND c.type IN ('start','stop','resume_upload'))
     OR EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id AND (t.status='recording' OR t.status='uploading' AND s.device_state->>'uploadState' IS DISTINCT FROM 'paused' AND NOT public.studio_camera_local_handoff_allowed(s.id)))
     THEN 2
    WHEN s.device_state->>'uploadState'='paused' AND s.device_state->>'uploading' IS DISTINCT FROM 'true'
     AND NOT public.studio_camera_local_handoff_allowed(s.id)
     AND EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id AND t.status IN ('uploading','local_ready','failed'))
     THEN 1
    ELSE 0 END DESC,s.created_at DESC,s.id DESC LIMIT 1 FOR UPDATE OF p;
  IF FOUND THEN
   UPDATE public.studio_camera_pairings SET last_seen_at=now() WHERE owner_id=p_user AND controller_id=v_session.controller_id;
   RETURN public.studio_camera_snapshot(v_session.id) || jsonb_build_object('ownerId',p_user,'paired',true,'controllerId',v_session.controller_id);
  END IF;
  SELECT * INTO v_pairing FROM public.studio_camera_pairings
   WHERE owner_id=p_user AND device_id=v_client AND revoked_at IS NULL AND (v_id IS NULL OR controller_id=v_id)
   ORDER BY last_seen_at DESC,created_at DESC,controller_id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
   RETURN jsonb_build_object('ownerId',p_user,'paired',false,'controllerId',NULL,'session',NULL,'commands','[]'::jsonb,'takes','[]'::jsonb,'serverAt',now());
  END IF;
  UPDATE public.studio_camera_pairings SET last_seen_at=now() WHERE owner_id=p_user AND controller_id=v_pairing.controller_id;
  RETURN jsonb_build_object('ownerId',p_user,'paired',true,'controllerId',v_pairing.controller_id,'session',NULL,'commands','[]'::jsonb,'takes','[]'::jsonb,'serverAt',now());
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_control_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_control_action(uuid,text,jsonb) TO service_role;
