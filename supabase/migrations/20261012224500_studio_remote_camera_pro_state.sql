-- Preserve independent Pro groups across acknowledged partial configuration.
-- Historical migration remains unchanged: this trigger also normalizes Auto
-- intent before a reconnect replays the confirmed camera configuration.
CREATE OR REPLACE FUNCTION public.studio_camera_merge_configuration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public,pg_temp AS $$
DECLARE
 v_previous jsonb := CASE WHEN jsonb_typeof(OLD.configuration->'pro')='object' THEN OLD.configuration->'pro' ELSE '{}'::jsonb END;
 v_patch jsonb := CASE WHEN jsonb_typeof(NEW.configuration->'pro')='object' THEN NEW.configuration->'pro' ELSE '{}'::jsonb END;
 v_pro jsonb;
BEGIN
 NEW.configuration := COALESCE(OLD.configuration,'{}'::jsonb) || COALESCE(NEW.configuration,'{}'::jsonb);
 v_pro := v_previous || v_patch;
 IF v_pro->'autoExposure'='true'::jsonb THEN
  v_pro := v_pro - ARRAY['iso','shutterSeconds'];
 END IF;
 IF v_pro->'autoWhiteBalance'='true'::jsonb THEN
  v_pro := v_pro - ARRAY['redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint'];
 ELSIF v_patch IS DISTINCT FROM v_previous THEN
  -- Mirror the native Kelvin/tint versus RGB representation switch. A quality
  -- change retaining the same Pro object does not rewrite either representation.
  IF v_patch ? 'temperatureKelvin' OR v_patch ? 'whiteBalanceTint' THEN
   v_pro := v_pro - ARRAY['redGain','greenGain','blueGain'];
  ELSIF v_patch ? 'redGain' OR v_patch ? 'greenGain' OR v_patch ? 'blueGain' THEN
   v_pro := v_pro - ARRAY['temperatureKelvin','whiteBalanceTint'];
  END IF;
 END IF;
 IF v_pro->'autoFocus'='true'::jsonb THEN v_pro := v_pro - 'lensPosition'; END IF;
 IF OLD.configuration ? 'pro' OR NEW.configuration ? 'pro' THEN
  NEW.configuration := jsonb_set(NEW.configuration,'{pro}',v_pro,true);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.studio_camera_merge_configuration() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS studio_camera_configuration_merge ON public.studio_camera_sessions;
CREATE TRIGGER studio_camera_configuration_merge BEFORE UPDATE OF configuration ON public.studio_camera_sessions
 FOR EACH ROW EXECUTE FUNCTION public.studio_camera_merge_configuration();
