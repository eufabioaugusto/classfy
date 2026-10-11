-- Compras digitais nas lojas: titularidade permanente e acesso confirmado no servidor.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_entitlement_source_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_entitlement_source_check
  CHECK (entitlement_source IN ('free', 'stripe', 'admin', 'legacy', 'apple', 'google'));

CREATE TABLE public.mobile_store_subscriptions (
  provider text NOT NULL CHECK (provider IN ('apple', 'google')),
  original_id text NOT NULL CHECK (length(original_id) BETWEEN 1 AND 256),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id text NOT NULL CHECK (length(product_id) BETWEEN 1 AND 200),
  plan public.plan_type NOT NULL CHECK (plan IN ('pro', 'premium')),
  status text NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'expired', 'refunded', 'revoked', 'paused', 'pending', 'replaced')),
  period_end timestamptz,
  auto_renew boolean NOT NULL DEFAULT false,
  event_at timestamptz NOT NULL,
  environment text NOT NULL CHECK (environment IN ('Production', 'Sandbox')),
  transaction_id text,
  purchase_token text,
  last_event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, original_id)
);
CREATE INDEX mobile_store_subscriptions_owner_idx ON public.mobile_store_subscriptions(user_id);
CREATE TABLE public.mobile_store_events (
  provider text NOT NULL CHECK (provider IN ('apple', 'google')),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 256),
  original_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id),
  FOREIGN KEY (provider, original_id) REFERENCES public.mobile_store_subscriptions(provider, original_id)
);
ALTER TABLE public.mobile_store_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_store_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_store_subscriptions, public.mobile_store_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_store_subscriptions, public.mobile_store_events TO service_role;

CREATE FUNCTION public.sync_mobile_subscription_state_v1(
  p_user_id uuid, p_provider text, p_original_id text, p_product_id text,
  p_plan public.plan_type, p_status text, p_period_end timestamptz,
  p_auto_renew boolean, p_event_id text, p_event_at timestamptz,
  p_environment text, p_transaction_id text DEFAULT NULL,
  p_purchase_token text DEFAULT NULL, p_replaced_original_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_store public.mobile_store_subscriptions%ROWTYPE;
  v_existing_event public.mobile_store_events%ROWTYPE;
  v_effective public.mobile_store_subscriptions%ROWTYPE;
  v_access boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('apple', 'google')
     OR p_plan IS NULL OR p_plan NOT IN ('pro', 'premium')
     OR p_status IS NULL OR p_status NOT IN ('active', 'canceled', 'past_due', 'expired', 'refunded', 'revoked', 'paused', 'pending')
     OR p_environment IS NULL OR p_environment NOT IN ('Production', 'Sandbox')
     OR p_original_id IS NULL OR length(p_original_id) NOT BETWEEN 1 AND 256
     OR p_product_id IS NULL OR length(p_product_id) NOT BETWEEN 1 AND 200
     OR p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 256
     OR p_event_at IS NULL OR NOT isfinite(p_event_at)
     OR p_event_at > now() + interval '5 minutes'
     OR (p_period_end IS NOT NULL AND NOT isfinite(p_period_end)) THEN
    RAISE EXCEPTION 'invalid_mobile_subscription_state';
  END IF;
  -- Todas as fontes bloqueiam o mesmo perfil antes de alterar a assinatura.
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  SELECT * INTO v_store FROM public.mobile_store_subscriptions
    WHERE provider = p_provider AND original_id = p_original_id FOR UPDATE;
  IF FOUND AND (v_store.user_id <> p_user_id OR v_store.environment <> p_environment) THEN
    RAISE EXCEPTION 'store_subscription_owner_mismatch';
  END IF;
  SELECT * INTO v_existing_event FROM public.mobile_store_events
    WHERE provider = p_provider AND event_id = p_event_id;
  IF FOUND THEN
    IF v_existing_event.user_id <> p_user_id OR v_existing_event.original_id <> p_original_id THEN
      RAISE EXCEPTION 'store_event_owner_mismatch';
    END IF;
    RETURN jsonb_build_object('duplicate', true, 'plan', v_profile.plan,
      'status', v_profile.subscription_status, 'subscriptionEnd', v_profile.plan_expires_at,
      'entitlementSource', v_profile.entitlement_source);
  END IF;
  v_access := p_status IN ('active', 'canceled', 'past_due') AND p_period_end > now();
  IF v_access AND v_profile.plan <> 'free'
     AND (v_profile.plan_expires_at IS NULL OR v_profile.plan_expires_at > now())
     AND v_profile.entitlement_source NOT IN ('free', p_provider) THEN
    RAISE EXCEPTION 'subscription_provider_conflict';
  END IF;
  IF v_store.original_id IS NOT NULL AND p_event_at < v_store.event_at THEN
    RETURN jsonb_build_object('ignored_stale_event', true, 'plan', v_profile.plan,
      'status', v_profile.subscription_status, 'subscriptionEnd', v_profile.plan_expires_at,
      'entitlementSource', v_profile.entitlement_source);
  END IF;
  -- Uma compra substituída não volta a conceder o plano antigo após restauração.
  IF v_store.status = 'replaced' THEN
    RETURN jsonb_build_object('ignored_replaced_subscription', true, 'plan', v_profile.plan,
      'status', v_profile.subscription_status, 'subscriptionEnd', v_profile.plan_expires_at,
      'entitlementSource', v_profile.entitlement_source);
  END IF;
  IF p_replaced_original_id IS NOT NULL THEN
    IF p_provider <> 'google' OR p_replaced_original_id = p_original_id THEN
      RAISE EXCEPTION 'invalid_subscription_replacement';
    END IF;
    IF EXISTS (SELECT 1 FROM public.mobile_store_subscriptions
      WHERE provider = p_provider AND original_id = p_replaced_original_id AND user_id <> p_user_id) THEN
      RAISE EXCEPTION 'store_subscription_owner_mismatch';
    END IF;
    UPDATE public.mobile_store_subscriptions SET status = 'replaced', auto_renew = false, updated_at = now()
      WHERE provider = p_provider AND original_id = p_replaced_original_id AND user_id = p_user_id;
  END IF;
  INSERT INTO public.mobile_store_subscriptions(provider, original_id, user_id, product_id, plan,
    status, period_end, auto_renew, event_at, environment, transaction_id, purchase_token, last_event_id)
  VALUES (p_provider, p_original_id, p_user_id, p_product_id, p_plan, p_status, p_period_end,
    COALESCE(p_auto_renew, false), p_event_at, p_environment, p_transaction_id, p_purchase_token, p_event_id)
  ON CONFLICT (provider, original_id) DO UPDATE SET
    product_id = EXCLUDED.product_id, plan = EXCLUDED.plan, status = EXCLUDED.status,
    period_end = EXCLUDED.period_end, auto_renew = EXCLUDED.auto_renew, event_at = EXCLUDED.event_at,
    transaction_id = COALESCE(EXCLUDED.transaction_id, mobile_store_subscriptions.transaction_id),
    purchase_token = COALESCE(EXCLUDED.purchase_token, mobile_store_subscriptions.purchase_token),
    last_event_id = EXCLUDED.last_event_id, updated_at = now()
    -- A primeira compra pode chegar simultaneamente para dois perfis diferentes.
    -- O conflito do INSERT também deve verificar o titular, mesmo após a leitura.
    WHERE mobile_store_subscriptions.user_id = EXCLUDED.user_id
      AND mobile_store_subscriptions.environment = EXCLUDED.environment
    RETURNING * INTO v_store;
  IF NOT FOUND THEN RAISE EXCEPTION 'store_subscription_owner_mismatch'; END IF;
  INSERT INTO public.mobile_store_events(provider, event_id, original_id, user_id, event_at)
    VALUES (p_provider, p_event_id, p_original_id, p_user_id, p_event_at);

  -- Expiração/cancelamento de um token antigo não revoga outra assinatura vigente.
  SELECT * INTO v_effective FROM public.mobile_store_subscriptions
    WHERE user_id = p_user_id AND status IN ('active', 'canceled', 'past_due') AND period_end > now()
    ORDER BY CASE WHEN plan = 'premium' THEN 2 ELSE 1 END DESC,
      period_end DESC, event_at DESC, created_at DESC LIMIT 1;
  IF v_effective.original_id IS NOT NULL THEN
    UPDATE public.profiles SET plan = v_effective.plan, plan_expires_at = v_effective.period_end,
      subscription_plan = v_effective.plan, subscription_status = v_effective.status,
      entitlement_source = v_effective.provider, subscription_state_event_at = v_effective.event_at,
      subscription_grace_until = CASE WHEN v_effective.status = 'past_due' THEN v_effective.period_end ELSE NULL END,
      pending_plan = NULL, pending_plan_effective_at = NULL, updated_at = now()
      WHERE id = p_user_id AND (entitlement_source IN ('free', 'apple', 'google') OR plan_expires_at <= now());
  ELSIF v_profile.entitlement_source IN ('apple', 'google') THEN
    UPDATE public.profiles SET plan = 'free', plan_expires_at = NULL,
      subscription_plan = NULL, subscription_status = p_status, entitlement_source = 'free',
      subscription_state_event_at = p_event_at, subscription_grace_until = NULL,
      pending_plan = NULL, pending_plan_effective_at = NULL, updated_at = now() WHERE id = p_user_id;
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  RETURN jsonb_build_object('plan', v_profile.plan, 'status', v_profile.subscription_status,
    'subscriptionEnd', v_profile.plan_expires_at, 'entitlementSource', v_profile.entitlement_source);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_mobile_subscription_state_v1(uuid,text,text,text,public.plan_type,text,timestamptz,boolean,text,timestamptz,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_mobile_subscription_state_v1(uuid,text,text,text,public.plan_type,text,timestamptz,boolean,text,timestamptz,text,text,text,text) TO service_role;

-- Mantém a implementação Stripe vigente e impede que sua verificação apague uma compra de loja.
ALTER FUNCTION public.sync_subscription_state_v1(uuid,text,public.plan_type,timestamptz,text,text,public.plan_type,timestamptz,timestamptz)
  RENAME TO sync_stripe_subscription_state_v1;
CREATE FUNCTION public.sync_subscription_state_v1(
  p_user_id uuid, p_status text, p_plan public.plan_type,
  p_period_end timestamptz, p_subscription_id text, p_customer_id text,
  p_pending_plan public.plan_type DEFAULT NULL, p_pending_effective_at timestamptz DEFAULT NULL,
  p_event_created_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF v_profile.entitlement_source IN ('apple', 'google') AND v_profile.plan_expires_at > now() THEN
    RETURN jsonb_build_object('store_entitlement_preserved', true, 'plan', v_profile.plan,
      'status', v_profile.subscription_status, 'period_end', v_profile.plan_expires_at);
  END IF;
  RETURN public.sync_stripe_subscription_state_v1(p_user_id,p_status,p_plan,p_period_end,p_subscription_id,
    p_customer_id,p_pending_plan,p_pending_effective_at,p_event_created_at);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_subscription_state_v1(uuid,text,public.plan_type,timestamptz,text,text,public.plan_type,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_subscription_state_v1(uuid,text,public.plan_type,timestamptz,text,text,public.plan_type,timestamptz,timestamptz) TO service_role;

-- A loja já informa o fim pago ou a carência; nunca prolongar acesso por tempo do cliente.
CREATE OR REPLACE FUNCTION public.expire_subscription_entitlements_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer; v_restored integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin')
    THEN RAISE EXCEPTION 'service_role_required'; END IF;
  PERFORM set_config('classfy.authorized_profile_operation', 'on', true);
  -- Quando Premium termina, outro Pro já pago continua válido até seu próprio fim.
  UPDATE public.profiles p SET plan = s.plan, plan_expires_at = s.period_end,
    subscription_plan = s.plan, subscription_status = s.status,
    entitlement_source = s.provider, subscription_state_event_at = s.event_at,
    subscription_grace_until = CASE WHEN s.status = 'past_due' THEN s.period_end ELSE NULL END,
    pending_plan = NULL, pending_plan_effective_at = NULL, updated_at = now()
  FROM (SELECT DISTINCT ON (user_id) * FROM public.mobile_store_subscriptions
    WHERE status IN ('active', 'canceled', 'past_due') AND period_end > now()
    ORDER BY user_id, CASE WHEN plan = 'premium' THEN 2 ELSE 1 END DESC,
      period_end DESC, event_at DESC, created_at DESC) s
  WHERE p.id = s.user_id AND p.entitlement_source IN ('apple', 'google')
    AND p.plan <> 'free' AND p.plan_expires_at <= now();
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  UPDATE public.profiles SET plan = 'free', plan_expires_at = NULL,
    subscription_status = 'expired', subscription_plan = NULL,
    pending_plan = NULL, pending_plan_effective_at = NULL,
    entitlement_source = 'free', updated_at = now()
  WHERE plan <> 'free' AND (
    (entitlement_source IN ('admin', 'apple', 'google') AND plan_expires_at <= now())
    OR (entitlement_source NOT IN ('admin', 'apple', 'google') AND (
      (subscription_status = 'past_due' AND subscription_grace_until <= now())
      OR (subscription_status = 'canceled' AND plan_expires_at <= now())
      OR subscription_status IN ('unpaid', 'incomplete_expired', 'expired', 'free')
    ))
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('classfy.authorized_profile_operation', 'off', true);
  RETURN v_count + v_restored;
END;
$$;
