-- The mobile-owned monitor is a private display surface, never a REC controller.
-- Its lease affects preview only. Original files and local REC remain on the phone.
CREATE TABLE IF NOT EXISTS public.studio_camera_monitor_sessions (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 device_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('aula','short')),
 title text NOT NULL DEFAULT '' CHECK(length(title)<=150),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 state jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(state)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '90 seconds',
 device_seen_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_camera_monitor_one_active_owner
 ON public.studio_camera_monitor_sessions(owner_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS studio_camera_monitor_owner_created
 ON public.studio_camera_monitor_sessions(owner_id,created_at DESC);
ALTER TABLE public.studio_camera_monitor_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_camera_monitor_sessions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.studio_camera_monitor_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.studio_camera_monitor_snapshot(p_session uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('monitor',jsonb_build_object('id',s.id,'ownerId',s.owner_id,'deviceId',s.device_id,
  'kind',s.kind,'title',s.title,'status',s.status,
  'state',CASE WHEN s.state ?& ARRAY['recording','elapsedSeconds','width','height','fps','cameraFacing'] THEN s.state ELSE NULL END,'createdAt',s.created_at,
  'expiresAt',s.expires_at,'deviceSeenAt',s.device_seen_at,'closedAt',s.closed_at),'serverAt',now())
 FROM public.studio_camera_monitor_sessions s WHERE s.id=p_session
$$;
REVOKE ALL ON FUNCTION public.studio_camera_monitor_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_monitor_snapshot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.studio_camera_monitor_action(p_user uuid,p_action text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_session public.studio_camera_monitor_sessions%ROWTYPE; v_id uuid; v_client uuid;
 v_state jsonb; v_key text; v_value jsonb; v_rooms jsonb:='[]'::jsonb; v_monitor_rooms jsonb:='[]'::jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'studio_camera_service_required'; END IF;
 IF p_user IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' OR octet_length(p_params::text)>32768 OR
    p_action IS NULL OR p_action NOT IN ('monitor-create','monitor-discover','monitor-connect','monitor-heartbeat','monitor-close')
  THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
 IF p_action<>'monitor-close' THEN PERFORM public.studio_camera_require_premium(p_user); END IF;
 -- Same lock as remote allocation: two modes cannot acquire the phone together.
 PERFORM pg_advisory_xact_lock(hashtextextended('studio-camera:'||p_user::text,0));
 -- A crashed publisher must not pin the account forever. This never stops local REC.
 WITH expired AS (UPDATE public.studio_camera_monitor_sessions SET status='closed',closed_at=COALESCE(closed_at,now())
   WHERE owner_id=p_user AND status='active' AND expires_at<=now() RETURNING id)
 SELECT COALESCE(jsonb_agg(id::text),'[]'::jsonb) INTO v_monitor_rooms FROM expired;
 IF p_action='monitor-discover' THEN
  SELECT * INTO v_session FROM public.studio_camera_monitor_sessions WHERE owner_id=p_user AND status='active' LIMIT 1;
  RETURN COALESCE(public.studio_camera_monitor_snapshot(v_session.id),jsonb_build_object('monitor',NULL,'serverAt',now()))
   ||jsonb_build_object('_monitorRoomsToClose',v_monitor_rooms);
 END IF;
 v_id:=(p_params->>'sessionId')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
 IF p_action='monitor-create' THEN
  v_client:=(p_params->>'deviceId')::uuid;
  IF v_client IS NULL OR COALESCE(p_params->>'kind','') NOT IN ('aula','short') OR
     jsonb_typeof(p_params->'title') IS DISTINCT FROM 'string' OR length(p_params->>'title')>150
   THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  SELECT * INTO v_session FROM public.studio_camera_monitor_sessions WHERE id=v_id AND owner_id=p_user FOR UPDATE;
  IF FOUND THEN
   IF v_session.device_id<>v_client OR v_session.kind<>p_params->>'kind' OR v_session.title<>p_params->>'title'
    THEN RAISE EXCEPTION 'studio_camera_client_mismatch'; END IF;
   IF v_session.status<>'active' THEN RAISE EXCEPTION 'studio_camera_monitor_expired'; END IF;
   RETURN public.studio_camera_monitor_snapshot(v_id)||jsonb_build_object('_monitorRoomsToClose',v_monitor_rooms);
  END IF;
  IF EXISTS(SELECT 1 FROM public.studio_camera_monitor_sessions WHERE id=v_id) THEN RAISE EXCEPTION 'studio_camera_not_found'; END IF;
  IF EXISTS(SELECT 1 FROM public.studio_camera_monitor_sessions WHERE owner_id=p_user AND status='active')
   THEN RAISE EXCEPTION 'studio_camera_monitor_busy'; END IF;
  IF (SELECT count(*) FROM public.studio_camera_monitor_sessions WHERE owner_id=p_user AND created_at>now()-interval '10 minutes')>=20
   THEN RAISE EXCEPTION 'studio_camera_rate_limited'; END IF;
  -- Preserves protected remote REC/upload/recovery and closes only idle rooms.
  v_rooms:=public.studio_camera_retire_idle_sessions(p_user,v_client,v_client);
  INSERT INTO public.studio_camera_monitor_sessions(id,owner_id,device_id,kind,title)
   VALUES(v_id,p_user,v_client,p_params->>'kind',p_params->>'title');
  RETURN public.studio_camera_monitor_snapshot(v_id)||jsonb_build_object('_roomsToClose',v_rooms,'_monitorRoomsToClose',v_monitor_rooms);
 END IF;
 SELECT * INTO v_session FROM public.studio_camera_monitor_sessions WHERE id=v_id AND owner_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'studio_camera_not_found'; END IF;
 IF p_action='monitor-close' THEN
  IF (p_params->>'deviceId')::uuid IS DISTINCT FROM v_session.device_id THEN RAISE EXCEPTION 'studio_camera_client_mismatch'; END IF;
  UPDATE public.studio_camera_monitor_sessions SET status='closed',closed_at=COALESCE(closed_at,now()) WHERE id=v_id;
  RETURN public.studio_camera_monitor_snapshot(v_id)||jsonb_build_object('_monitorRoomsToClose',v_monitor_rooms||jsonb_build_array(v_id::text));
 END IF;
 IF v_session.status<>'active' OR v_session.expires_at<=now() THEN RAISE EXCEPTION 'studio_camera_monitor_expired'; END IF;
 v_client:=(p_params->>'clientId')::uuid;
 IF v_client IS NULL OR COALESCE(p_params->>'role','') NOT IN ('viewer','device') OR
    ((p_params->>'role')='device' AND v_client<>v_session.device_id)
  THEN RAISE EXCEPTION 'studio_camera_client_mismatch'; END IF;
 IF p_action='monitor-heartbeat' THEN
  IF (p_params->>'role')='viewer' AND p_params ? 'state' THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
  IF (p_params->>'role')='device' THEN
   v_state:=COALESCE(p_params->'state','{}'::jsonb);
   IF jsonb_typeof(v_state) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
   FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_state) LOOP
    IF v_key NOT IN ('recording','elapsedSeconds','width','height','fps','cameraFacing') OR
       (v_key='recording' AND jsonb_typeof(v_value) IS DISTINCT FROM 'boolean') OR
       (v_key='cameraFacing' AND (jsonb_typeof(v_value) IS DISTINCT FROM 'string' OR v_value#>>'{}' NOT IN ('front','back'))) OR
       (v_key IN ('elapsedSeconds','width','height','fps') AND jsonb_typeof(v_value) IS DISTINCT FROM 'number')
     THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
    IF v_key='elapsedSeconds' AND (v_value#>>'{}')::numeric NOT BETWEEN 0 AND 86400 OR
       v_key IN ('width','height') AND ((v_value#>>'{}')::numeric NOT BETWEEN 1 AND 7680 OR trunc((v_value#>>'{}')::numeric)<>(v_value#>>'{}')::numeric) OR
       v_key='fps' AND (v_value#>>'{}')::numeric NOT BETWEEN 1 AND 120
     THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
   END LOOP;
   UPDATE public.studio_camera_monitor_sessions SET state=state||v_state,device_seen_at=now(),expires_at=now()+interval '90 seconds' WHERE id=v_id;
  END IF;
 END IF;
 RETURN public.studio_camera_monitor_snapshot(v_id)||jsonb_build_object('_monitorRoomsToClose',v_monitor_rooms);
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_monitor_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_monitor_action(uuid,text,jsonb) TO service_role;

-- Preserve the existing command/master implementation, while placing mode authority
-- in front of it. Clients cannot invoke either RPC directly: service_role only.
DO $$ BEGIN
 IF to_regprocedure('public.studio_camera_control_action(uuid,text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.studio_camera_action(uuid,text,jsonb) RENAME TO studio_camera_control_action;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_control_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_control_action(uuid,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.studio_camera_action(p_user uuid,p_action text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device uuid; v_response jsonb; v_monitor_rooms jsonb:='[]'::jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'studio_camera_service_required'; END IF;
 IF p_user IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'studio_camera_invalid_request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('studio-camera:'||p_user::text,0));
 WITH expired AS (UPDATE public.studio_camera_monitor_sessions SET status='closed',closed_at=COALESCE(closed_at,now())
   WHERE owner_id=p_user AND status='active' AND expires_at<=now() RETURNING id)
 SELECT COALESCE(jsonb_agg(id::text),'[]'::jsonb) INTO v_monitor_rooms FROM expired;
 IF p_action='create' THEN
  SELECT device_id INTO v_device FROM public.studio_camera_pairings WHERE owner_id=p_user AND controller_id=(p_params->>'controllerId')::uuid AND revoked_at IS NULL;
 ELSIF p_action IN ('join','discover') THEN v_device:=(p_params->>'deviceId')::uuid;
 ELSIF p_action IN ('connect','command') THEN
  SELECT device_id INTO v_device FROM public.studio_camera_sessions WHERE owner_id=p_user AND id=(p_params->>'sessionId')::uuid;
 END IF;
 IF v_device IS NOT NULL AND EXISTS(SELECT 1 FROM public.studio_camera_monitor_sessions
   WHERE owner_id=p_user AND device_id=v_device AND status='active') THEN RAISE EXCEPTION 'studio_camera_monitor_conflict'; END IF;
 v_response:=public.studio_camera_control_action(p_user,p_action,p_params);
 RETURN v_response||jsonb_build_object('_monitorRoomsToClose',v_monitor_rooms);
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_camera_action(uuid,text,jsonb) TO service_role;
