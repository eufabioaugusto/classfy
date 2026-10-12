-- Câmera remota privada: pareamento de uso único, comandos ordenados e originais.
-- O app preserva o master local; esta fila nunca autoriza apagá-lo.
CREATE TABLE IF NOT EXISTS public.studio_camera_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid,
  kind text NOT NULL CHECK (kind IN ('aula','short')),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 150),
  controller_id uuid NOT NULL,
  device_id uuid,
  pairing_hash text UNIQUE CHECK (pairing_hash ~ '^[0-9a-f]{64}$'),
  pairing_expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  paired_at timestamptz,
  status text NOT NULL DEFAULT 'pairing' CHECK (status IN ('pairing','ready','starting','recording','stopping','closed')),
  sequence bigint NOT NULL DEFAULT 0,
  active_take_id uuid,
  configuration jsonb NOT NULL DEFAULT '{"resolution":"4k","fps":30,"cameraFacing":"back"}',
  device_state jsonb NOT NULL DEFAULT '{}',
  controller_seen_at timestamptz,
  device_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS studio_camera_sessions_owner_idx ON public.studio_camera_sessions(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.studio_camera_commands (
  id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.studio_camera_sessions(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  type text NOT NULL CHECK (type IN ('configure','start','stop')),
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  PRIMARY KEY(session_id,id),
  UNIQUE(session_id,sequence)
);
CREATE TABLE IF NOT EXISTS public.studio_camera_takes (
  id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.studio_camera_sessions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','recording','local_ready','uploading','uploaded','failed')),
  metadata jsonb,
  object_path text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  PRIMARY KEY(session_id,id)
);

ALTER TABLE public.studio_camera_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_camera_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_camera_takes ENABLE ROW LEVEL SECURITY;
-- Dados operacionais passam pela Edge Function. Sem acesso SQL direto do cliente,
-- inclusive ao hash de pareamento ou a estados que permitiriam forjar um master.
REVOKE ALL ON public.studio_camera_sessions, public.studio_camera_commands, public.studio_camera_takes FROM anon,authenticated;
GRANT ALL ON public.studio_camera_sessions, public.studio_camera_commands, public.studio_camera_takes TO service_role;

CREATE OR REPLACE FUNCTION public.studio_camera_require_premium(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_creator boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id=p_user;
  IF NOT FOUND OR v_profile.plan::text IS DISTINCT FROM 'premium'
    OR (CASE WHEN v_profile.entitlement_source<>'admin' AND v_profile.subscription_status='past_due'
      THEN v_profile.subscription_grace_until ELSE v_profile.plan_expires_at END) IS NULL
    OR (CASE WHEN v_profile.entitlement_source<>'admin' AND v_profile.subscription_status='past_due'
      THEN v_profile.subscription_grace_until ELSE v_profile.plan_expires_at END) <= now()
    OR COALESCE(v_profile.entitlement_source,'') NOT IN ('stripe','admin','legacy','apple','google')
    OR (v_profile.entitlement_source<>'admin' AND
       (COALESCE(v_profile.subscription_status,'') NOT IN ('active','trialing','canceled','past_due') OR
        (v_profile.subscription_status='past_due' AND
         (v_profile.subscription_grace_until IS NULL OR v_profile.subscription_grace_until<=now()))))
    THEN RAISE EXCEPTION 'studio_camera_premium_required'; END IF;
  SELECT public.has_role(p_user,'admin'::public.app_role) OR
    (public.has_role(p_user,'creator'::public.app_role) AND v_profile.creator_status::text='approved') INTO v_creator;
  IF v_creator IS DISTINCT FROM true THEN RAISE EXCEPTION 'studio_camera_creator_required'; END IF;
END $$;

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
  'takes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'metadata',t.metadata,
   'createdAt',t.created_at,'uploadedAt',t.uploaded_at) ORDER BY t.created_at)
   FROM public.studio_camera_takes t WHERE t.session_id=s.id),'[]'::jsonb))
 FROM public.studio_camera_sessions s WHERE s.id=p_session
$$;

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
  IF v_id IS NULL OR v_type NOT IN ('configure','start','stop') OR jsonb_typeof(v_payload)<>'object'
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
  IF v_session.status='closed' OR v_session.device_id IS NULL THEN RAISE EXCEPTION 'studio_camera_not_ready'; END IF;
  IF v_type IN ('start','configure') AND
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
  IF v_command.type IN ('start','stop') AND v_result ? 'takeId' AND
    (v_result->>'takeId')::uuid IS DISTINCT FROM (v_command.payload->>'takeId')::uuid
    THEN RAISE EXCEPTION 'studio_camera_take_conflict'; END IF;
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
  UPDATE public.studio_camera_sessions SET device_state=COALESCE(v_result->'state',device_state),device_seen_at=now(),updated_at=now() WHERE id=v_session.id;
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

REVOKE ALL ON FUNCTION public.studio_camera_require_premium(uuid),public.studio_camera_snapshot(uuid,bigint),public.studio_camera_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_action(uuid,text,jsonb) TO service_role;

-- NULL inherits the project's real file limit. This migration changes no plan
-- or global quota; clients keep the local master if the provider refuses upload.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('studio-camera-originals','studio-camera-originals',false,NULL,ARRAY['video/mp4','video/quicktime','application/octet-stream'])
 ON CONFLICT(id) DO UPDATE SET public=false,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS studio_camera_originals_guard ON storage.objects;
CREATE POLICY studio_camera_originals_guard ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'studio-camera-originals')
 WITH CHECK(bucket_id<>'studio-camera-originals');
-- Direct client INSERT/UPDATE/DELETE is intentionally denied for this bucket.
-- Scoped signed upload tokens are issued by the authenticated server only.
