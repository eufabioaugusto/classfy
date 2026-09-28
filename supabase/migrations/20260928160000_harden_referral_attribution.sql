-- Additive hardening: existing links/conversions remain valid.
BEGIN;
DROP POLICY IF EXISTS "Users can insert own referral link" ON public.referral_links;
DROP POLICY IF EXISTS "System can update referral links" ON public.referral_links;
REVOKE INSERT, UPDATE, DELETE ON public.referral_links FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_or_create_referral_link(p_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT referral_code INTO v_code FROM public.referral_links WHERE user_id = p_user_id;
  IF v_code IS NULL THEN
    INSERT INTO public.referral_links(user_id, referral_code)
    VALUES (p_user_id, upper(replace(gen_random_uuid()::text, '-', '')))
    ON CONFLICT (user_id) DO NOTHING;
    SELECT referral_code INTO v_code FROM public.referral_links WHERE user_id = p_user_id;
  END IF;
  RETURN v_code;
END; $$;
REVOKE ALL ON FUNCTION public.get_or_create_referral_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_link(uuid) TO authenticated;

CREATE TABLE public.referral_click_windows (
  referral_code text NOT NULL REFERENCES public.referral_links(referral_code) ON DELETE CASCADE,
  visitor_hash text NOT NULL CHECK (length(visitor_hash) = 64),
  window_start timestamptz NOT NULL,
  clicks integer NOT NULL DEFAULT 1,
  PRIMARY KEY(referral_code, visitor_hash, window_start)
);
CREATE INDEX referral_click_windows_expiry ON public.referral_click_windows(window_start);
ALTER TABLE public.referral_click_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_click_windows FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.track_referral_click_v1(p_code text, p_visitor_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_code !~ '^[A-Za-z0-9_-]{3,50}$' OR p_visitor_hash !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.system_config WHERE config_key='referral_enabled' AND config_value='false') THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.referral_links WHERE referral_code=p_code) THEN RETURN; END IF;
  -- Persistent limit, shared across function instances. Expired windows have no attribution value.
  DELETE FROM public.referral_click_windows WHERE window_start < now() - interval '2 hours';
  INSERT INTO public.referral_click_windows(referral_code,visitor_hash,window_start)
  VALUES(p_code,p_visitor_hash,date_trunc('hour',now()))
  ON CONFLICT(referral_code,visitor_hash,window_start) DO UPDATE
    SET clicks=public.referral_click_windows.clicks+1 WHERE public.referral_click_windows.clicks < 5
  RETURNING clicks INTO v_count;
  IF v_count IS NOT NULL THEN
    UPDATE public.referral_links SET total_clicks=COALESCE(total_clicks,0)+1 WHERE referral_code=p_code;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.track_referral_click_v1(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.track_referral_click_v1(text,text) TO service_role;

CREATE TABLE public.referral_signup_claims (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code text NOT NULL REFERENCES public.referral_links(referral_code),
  captured_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);
ALTER TABLE public.referral_signup_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_signup_claims FROM anon,authenticated;
-- Private core is called only by the auth trigger and the service-role wrapper.
CREATE OR REPLACE FUNCTION public.finalize_referral_claim_internal(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim public.referral_signup_claims%ROWTYPE; v_referrer uuid; v_id uuid;
BEGIN
  SELECT * INTO v_claim FROM public.referral_signup_claims WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','no_claim'); END IF;
  IF v_claim.finalized_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_tracked'); END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND (email_confirmed_at IS NOT NULL OR phone_confirmed_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('status','awaiting_confirmation');
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_config WHERE config_key='referral_enabled' AND config_value='false') THEN
    RETURN jsonb_build_object('status','disabled');
  END IF;
  SELECT user_id INTO v_referrer FROM public.referral_links WHERE referral_code=v_claim.referral_code;
  IF v_referrer IS NULL OR v_referrer=p_user_id THEN RETURN jsonb_build_object('status','ineligible'); END IF;
  INSERT INTO public.referral_conversions(referrer_id,referred_user_id,referral_code)
  VALUES(v_referrer,p_user_id,v_claim.referral_code)
  ON CONFLICT(referred_user_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    UPDATE public.referral_links SET total_conversions=COALESCE(total_conversions,0)+1 WHERE referral_code=v_claim.referral_code;
    INSERT INTO public.notifications(user_id,type,title,message)
    VALUES(v_referrer,'system','Nova indicação','Uma pessoa confirmou o cadastro pelo seu link.');
  END IF;
  UPDATE public.referral_signup_claims SET finalized_at=now() WHERE user_id=p_user_id;
  RETURN jsonb_build_object('status',CASE WHEN v_id IS NULL THEN 'already_tracked' ELSE 'tracked' END);
END; $$;
REVOKE ALL ON FUNCTION public.finalize_referral_claim_internal(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.finalize_referral_signup_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  RETURN public.finalize_referral_claim_internal(p_user_id);
END; $$;
REVOKE ALL ON FUNCTION public.finalize_referral_signup_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_referral_signup_v1(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.capture_referral_signup_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_expires numeric;
BEGIN
  IF TG_OP='INSERT' THEN
    v_code := NEW.raw_user_meta_data->>'referral_code';
    IF v_code IS NOT NULL AND v_code ~ '^[A-Za-z0-9_-]{3,50}$'
       AND (NEW.raw_user_meta_data->>'referral_expires') ~ '^[0-9]{13}$' THEN
      v_expires := (NEW.raw_user_meta_data->>'referral_expires')::numeric;
      IF v_expires > extract(epoch FROM now())*1000
         AND v_expires <= extract(epoch FROM now()+interval '30 days')*1000
         AND EXISTS(SELECT 1 FROM public.referral_links WHERE referral_code=v_code AND user_id<>NEW.id)
         AND NOT EXISTS(SELECT 1 FROM public.system_config WHERE config_key='referral_enabled' AND config_value='false') THEN
        INSERT INTO public.referral_signup_claims(user_id,referral_code) VALUES(NEW.id,v_code);
      END IF;
    END IF;
  END IF;
  IF NEW.email_confirmed_at IS NOT NULL OR NEW.phone_confirmed_at IS NOT NULL THEN
    PERFORM public.finalize_referral_claim_internal(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.capture_referral_signup_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_referral_signup AFTER INSERT OR UPDATE OF email_confirmed_at,phone_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.capture_referral_signup_v1();

CREATE OR REPLACE FUNCTION public.get_referral_program_terms_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('commission_percent',
   LEAST(50,GREATEST(0,COALESCE((SELECT (value->>'referral_commission_percent')::numeric FROM public.platform_settings WHERE key='economic_v1'),10))),
   'enabled',NOT EXISTS(SELECT 1 FROM public.system_config WHERE config_key='referral_enabled' AND config_value='false'));
$$;
REVOKE ALL ON FUNCTION public.get_referral_program_terms_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_referral_program_terms_v1() TO authenticated;
COMMIT;
