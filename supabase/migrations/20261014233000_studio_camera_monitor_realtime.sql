-- Discover mobile-owned monitors inside the signed-in browser. Realtime grants
-- only lifecycle metadata; private room tokens, camera state and REC remain Edge-owned.
CREATE OR REPLACE FUNCTION public.studio_camera_monitor_viewer_allowed()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN RETURN false; END IF;
 -- Use the same current Premium, expiry/grace, entitlement source and creator
 -- approval rules as the authenticated Edge, without revealing another account.
 PERFORM public.studio_camera_require_premium(auth.uid());
 RETURN true;
EXCEPTION WHEN raise_exception THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_monitor_viewer_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.studio_camera_monitor_viewer_allowed() TO authenticated;

ALTER TABLE public.studio_camera_monitor_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_camera_monitor_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,owner_id,status,created_at,expires_at,device_seen_at,closed_at)
 ON public.studio_camera_monitor_sessions TO authenticated;
DROP POLICY IF EXISTS studio_camera_monitor_owner_select ON public.studio_camera_monitor_sessions;
CREATE POLICY studio_camera_monitor_owner_select ON public.studio_camera_monitor_sessions
 FOR SELECT TO authenticated USING(
  owner_id=(SELECT auth.uid()) AND (SELECT public.studio_camera_monitor_viewer_allowed())
 );
-- No client INSERT/UPDATE/DELETE, RPC or signed-media permission is added.
-- Clients subscribe only to INSERT/UPDATE. DELETE has no RLS in Realtime; keep
-- replica identity DEFAULT and never transmit previous private camera state.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  CREATE PUBLICATION supabase_realtime;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
   AND schemaname='public' AND tablename='studio_camera_monitor_sessions') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_camera_monitor_sessions
   (id,owner_id,status,created_at,expires_at,device_seen_at,closed_at);
 END IF;
END $$;
