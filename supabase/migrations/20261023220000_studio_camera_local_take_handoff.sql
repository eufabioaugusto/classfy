-- A new app may retain optional originals locally without pinning its old room.
-- No take, part, receipt or durable pairing is deleted or marked uploaded here.
CREATE OR REPLACE FUNCTION public.studio_camera_local_metadata_valid(p_metadata jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_key text; v_number numeric;
BEGIN
 IF jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR
  NOT p_metadata ?& ARRAY['bytes','mime','width','height','fps','duration'] OR
  jsonb_typeof(p_metadata->'mime') IS DISTINCT FROM 'string' OR
  COALESCE(p_metadata->>'mime','') NOT IN ('video/quicktime','video/mp4') THEN RETURN false; END IF;
 FOREACH v_key IN ARRAY ARRAY['bytes','width','height','fps','duration'] LOOP
  IF jsonb_typeof(p_metadata->v_key) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  v_number:=(p_metadata->>v_key)::numeric;
  IF v_key='bytes' AND (v_number NOT BETWEEN 1 AND 9007199254740991 OR trunc(v_number)<>v_number) OR
   v_key IN ('width','height') AND (v_number NOT BETWEEN 1 AND 7680 OR trunc(v_number)<>v_number) OR
   v_key='fps' AND v_number NOT BETWEEN 1 AND 120 OR
   v_key='duration' AND v_number NOT BETWEEN 0.001 AND 86400 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_local_metadata_valid(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_local_metadata_valid(jsonb) TO service_role;

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

CREATE OR REPLACE FUNCTION public.studio_camera_retire_idle_sessions(
 p_user uuid,p_controller uuid,p_device uuid DEFAULT NULL,p_except uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ids uuid[];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_user IS NULL OR p_controller IS NULL
  THEN RAISE EXCEPTION 'studio_camera_service_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('studio-camera:'||p_user::text,0));
 -- Stable lock order also serializes START/heartbeat against this handoff.
 PERFORM 1 FROM public.studio_camera_sessions
  WHERE owner_id=p_user AND status<>'closed' AND id IS DISTINCT FROM p_except
   AND (controller_id=p_controller OR p_device IS NOT NULL AND device_id=p_device)
  ORDER BY id FOR UPDATE;
 -- Preserve the old session that owns resumable bytes. The app's retry is
 -- currently session-scoped, so moving to another session would hide its action.
 IF EXISTS(SELECT 1 FROM public.studio_camera_sessions s
  WHERE s.owner_id=p_user AND s.status<>'closed' AND s.id IS DISTINCT FROM p_except
   AND (s.controller_id=p_controller OR p_device IS NOT NULL AND s.device_id=p_device)
   AND s.status NOT IN ('starting','recording','stopping') AND s.active_take_id IS NULL
   AND s.device_state->>'recording' IS DISTINCT FROM 'true' AND s.device_state->>'processing' IS DISTINCT FROM 'true'
   AND s.device_state->>'uploadState'='paused' AND s.device_state->>'uploading' IS DISTINCT FROM 'true'
   AND NOT public.studio_camera_local_handoff_allowed(s.id)
   AND NOT EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id AND t.status='recording')
   AND NOT EXISTS(SELECT 1 FROM public.studio_camera_commands c WHERE c.session_id=s.id AND c.status='pending' AND c.type IN ('start','stop','resume_upload'))
   AND EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id AND t.status IN ('uploading','local_ready','failed')))
  THEN RAISE EXCEPTION 'studio_camera_pending_upload'; END IF;
 IF EXISTS(SELECT 1 FROM public.studio_camera_sessions s
  WHERE s.owner_id=p_user AND s.status<>'closed' AND s.id IS DISTINCT FROM p_except
   AND (s.controller_id=p_controller OR p_device IS NOT NULL AND s.device_id=p_device)
   AND (s.status IN ('starting','recording','stopping') OR s.active_take_id IS NOT NULL
    OR s.device_state->>'recording'='true' OR s.device_state->>'uploading'='true'
    OR s.device_state->>'processing'='true' OR s.device_state->>'uploadState'='uploading'
    OR EXISTS(SELECT 1 FROM public.studio_camera_takes t WHERE t.session_id=s.id AND (t.status='recording' OR t.status='uploading' AND NOT public.studio_camera_local_handoff_allowed(s.id)))
    OR EXISTS(SELECT 1 FROM public.studio_camera_commands c WHERE c.session_id=s.id AND c.status='pending' AND c.type IN ('start','stop','resume_upload'))))
  THEN RAISE EXCEPTION 'studio_camera_busy'; END IF;
 SELECT array_agg(id ORDER BY created_at,id) INTO v_ids FROM public.studio_camera_sessions
  WHERE owner_id=p_user AND status<>'closed' AND id IS DISTINCT FROM p_except
   AND (controller_id=p_controller OR p_device IS NOT NULL AND device_id=p_device);
 IF v_ids IS NULL THEN RETURN '[]'::jsonb; END IF;
 -- An abandoned reversible configuration must not block reconnection forever.
 UPDATE public.studio_camera_commands SET status='failed',acknowledged_at=now(),
  result=jsonb_build_object('ok',false,'error','Esta conexão foi substituída por uma nova sessão do Studio.')
  WHERE session_id=ANY(v_ids) AND type='configure' AND status='pending';
 UPDATE public.studio_camera_sessions SET status='closed',pairing_hash=NULL,
  closed_at=COALESCE(closed_at,now()),updated_at=now() WHERE id=ANY(v_ids);
 RETURN to_jsonb(v_ids);
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_retire_idle_sessions(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_retire_idle_sessions(uuid,uuid,uuid,uuid) TO service_role;

-- Keep the complete REC/ACK/upload implementation and the existing monitor
-- authority wrapper. Only discovery ranking changes; its ownership checks stay.
DO $$ BEGIN
 IF to_regprocedure('public.studio_camera_local_legacy_action(uuid,text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.studio_camera_control_action(uuid,text,jsonb) RENAME TO studio_camera_local_legacy_action;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_local_legacy_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_local_legacy_action(uuid,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.studio_camera_control_action(p_user uuid,p_action text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE v_session public.studio_camera_sessions%ROWTYPE; v_pairing public.studio_camera_pairings%ROWTYPE;
 v_id uuid; v_client uuid;
BEGIN
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
