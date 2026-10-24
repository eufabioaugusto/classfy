-- Tiny private JPEGs are independent of original upload and heartbeat state.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('studio-camera-thumbnails','studio-camera-thumbnails',false,32768,ARRAY['image/jpeg'])
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=32768,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS studio_camera_thumbnails_guard ON storage.objects;
CREATE POLICY studio_camera_thumbnails_guard ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'studio-camera-thumbnails') WITH CHECK(bucket_id<>'studio-camera-thumbnails');

ALTER TABLE public.studio_camera_takes ADD COLUMN IF NOT EXISTS thumbnail jsonb;
COMMENT ON COLUMN public.studio_camera_takes.thumbnail IS 'Immutable private JPEG descriptor only; no credentials, paths or original upload authority.';
CREATE OR REPLACE FUNCTION public.studio_camera_thumbnail_valid(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE k text; n numeric;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR p_value->'version' IS DISTINCT FROM '1'::jsonb
  OR p_value->>'mime' IS DISTINCT FROM 'image/jpeg' OR jsonb_typeof(p_value->'hash') IS DISTINCT FROM 'string'
  OR p_value->>'hash' !~ '^[0-9a-f]{64}$' OR (p_value-ARRAY['version','bytes','mime','width','height','hash'])<>'{}'::jsonb THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['bytes','width','height'] LOOP
  IF jsonb_typeof(p_value->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  n:=(p_value->>k)::numeric;
  IF trunc(n)<>n OR n<1 OR n>(CASE WHEN k='bytes' THEN 16384 ELSE 320 END) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_thumbnail_valid(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_thumbnail_valid(jsonb) TO service_role;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.studio_camera_takes'::regclass AND conname='studio_camera_thumbnail_descriptor_check') THEN
  ALTER TABLE public.studio_camera_takes ADD CONSTRAINT studio_camera_thumbnail_descriptor_check
   CHECK(thumbnail IS NULL OR public.studio_camera_thumbnail_valid(thumbnail));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.studio_camera_thumbnail_action(p_user uuid,p_action text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE s public.studio_camera_sessions%ROWTYPE; t public.studio_camera_takes%ROWTYPE; descriptor jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'studio_camera_service_required'; END IF;
 IF p_user IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' OR octet_length(p_params::text)>2048
  OR COALESCE(p_action,'') NOT IN ('thumbnail_put','thumbnail_get') THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
 SELECT * INTO s FROM public.studio_camera_sessions WHERE id=(p_params->>'sessionId')::uuid AND owner_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'studio_camera_not_found'; END IF;
 IF (p_action='thumbnail_put' AND (p_params->>'role' IS DISTINCT FROM 'device' OR s.device_id IS NULL OR (p_params->>'clientId')::uuid IS DISTINCT FROM s.device_id))
  OR (p_action='thumbnail_get' AND (p_params->>'role' IS DISTINCT FROM 'controller' OR (p_params->>'clientId')::uuid IS DISTINCT FROM s.controller_id))
  THEN RAISE EXCEPTION 'studio_camera_client_mismatch'; END IF;
 SELECT * INTO t FROM public.studio_camera_takes WHERE session_id=s.id AND id=(p_params->>'takeId')::uuid AND owner_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'studio_camera_take_not_found'; END IF;
 IF p_action='thumbnail_get' THEN
  IF NOT public.studio_camera_thumbnail_valid(t.thumbnail) THEN RAISE EXCEPTION 'studio_camera_thumbnail_unavailable'; END IF;
  descriptor:=t.thumbnail;
 ELSE
  descriptor:=p_params->'thumbnail';
  IF NOT public.studio_camera_thumbnail_valid(descriptor) OR jsonb_typeof(p_params->'confirmed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'studio_camera_invalid_thumbnail'; END IF;
  IF t.status NOT IN ('local_ready','uploading','uploaded','failed') OR NOT COALESCE((
   public.studio_camera_local_metadata_valid(t.metadata)
   OR (t.recording_end->>'takeId'=t.id::text AND t.recording_end->'localTakeStorage'='1'::jsonb
    AND public.studio_camera_local_metadata_valid(t.recording_end->'sourceMetadata'))
   OR (s.device_state#>'{capabilities,localTakeStorage}'='1'::jsonb AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.device_state->'localTakes')='array' THEN s.device_state->'localTakes' ELSE '[]'::jsonb END) item
    WHERE item->>'id'=t.id::text AND item->'localSaved'='true'::jsonb
     AND item->>'phase' IN ('local_ready','uploaded','error') AND public.studio_camera_local_metadata_valid(item->'metadata')))
   OR EXISTS(SELECT 1 FROM public.studio_camera_commands c WHERE c.session_id=s.id AND c.type='stop' AND c.status='applied'
    AND c.acknowledged_at IS NOT NULL AND c.payload->>'takeId'=t.id::text AND c.result->>'takeId'=t.id::text
    AND c.result->'ok'='true'::jsonb AND c.result#>'{state,capabilities,localTakeStorage}'='1'::jsonb AND EXISTS(
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.result#>'{state,localTakes}')='array' THEN c.result#>'{state,localTakes}' ELSE '[]'::jsonb END) item
     WHERE item->>'id'=t.id::text AND item->'localSaved'='true'::jsonb AND item->>'phase' IN ('local_ready','uploaded','error')
      AND public.studio_camera_local_metadata_valid(item->'metadata')))
  ),false) THEN RAISE EXCEPTION 'studio_camera_original_not_ready'; END IF;
  IF t.thumbnail IS NOT NULL AND t.thumbnail<>descriptor THEN RAISE EXCEPTION 'studio_camera_thumbnail_conflict'; END IF;
  IF p_params->'confirmed'='true'::jsonb THEN
   IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='studio-camera-thumbnails'
    AND o.name=p_user::text||'/'||s.id::text||'/'||t.id::text||'/v1.jpg'
    AND o.metadata->>'mimetype'='image/jpeg' AND (o.metadata->>'size')::bigint=(descriptor->>'bytes')::bigint)
    THEN RAISE EXCEPTION 'studio_camera_thumbnail_unavailable'; END IF;
   UPDATE public.studio_camera_takes SET thumbnail=descriptor WHERE session_id=s.id AND id=t.id;
  END IF;
 END IF;
 -- A closed historical session remains closed; no original status is changed.
 RETURN jsonb_build_object('thumbnail',descriptor,'_objectPath',p_user::text||'/'||s.id::text||'/'||t.id::text||'/v1.jpg');
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_thumbnail_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_thumbnail_action(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.studio_camera_snapshot(p_session uuid,p_after bigint DEFAULT 0)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'serverAt',now(),
  'session',jsonb_build_object('id',s.id,'ownerId',s.owner_id,'projectId',s.project_id,'kind',s.kind,'title',s.title,
   'controllerId',s.controller_id,'deviceId',s.device_id,'status',s.status,'sequence',s.sequence,'activeTakeId',s.active_take_id,
   'configuration',s.configuration,'deviceState',s.device_state,'createdAt',s.created_at,'expiresAt',s.pairing_expires_at,
   'pairedAt',s.paired_at,'controllerSeenAt',s.controller_seen_at,'deviceSeenAt',s.device_seen_at,'closedAt',s.closed_at),
  'commands',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'type',c.type,'payload',c.payload,
   'status',c.status,'result',c.result,'createdAt',c.created_at,'acknowledgedAt',c.acknowledged_at) ORDER BY c.sequence)
   FROM public.studio_camera_commands c WHERE c.session_id=s.id AND (c.sequence>p_after OR c.status<>'pending')),'[]'::jsonb),
  'takes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'metadata',t.metadata,'recordingEnd',t.recording_end,
   'thumbnail',t.thumbnail,'createdAt',t.created_at,'uploadedAt',t.uploaded_at) ORDER BY t.created_at)
   FROM public.studio_camera_takes t WHERE t.session_id=s.id),'[]'::jsonb))
 FROM public.studio_camera_sessions s WHERE s.id=p_session
$$;
