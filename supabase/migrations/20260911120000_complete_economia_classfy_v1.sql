-- =============================================================================
-- ECONOMIA CLASSFY V1 - conclusao operacional
-- Fecha lacunas de autorizacao, auditoria, ledger, Stripe e checkpoints sem
-- reativar QP, carry-over, cambio fixo de Points ou motores paralelos.
-- =============================================================================

-- A regra de teto pertence a tabela oficial de acoes, nao a configuracao global.
UPDATE public.platform_settings
SET value = value - 'approved_content_monthly_limit', updated_at = now()
WHERE key = 'economic_v1';

-- ----------------------------------------------------------------------------
-- 1. Estado de assinatura ordenado e origem explicita do entitlement
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_state_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS entitlement_source text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_entitlement_source_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_entitlement_source_check
  CHECK (entitlement_source IN ('free', 'stripe', 'admin', 'legacy'));

UPDATE public.profiles
SET entitlement_source = CASE
  WHEN stripe_subscription_id IS NOT NULL OR billing_id IS NOT NULL THEN 'stripe'
  WHEN plan = 'free' THEN 'free'
  ELSE 'legacy'
END
WHERE entitlement_source = 'legacy';

CREATE OR REPLACE FUNCTION public.protect_profile_operational_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR current_setting('classfy.authorized_profile_operation', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at
     OR NEW.billing_id IS DISTINCT FROM OLD.billing_id
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.subscription_grace_until IS DISTINCT FROM OLD.subscription_grace_until
     OR NEW.pending_plan IS DISTINCT FROM OLD.pending_plan
     OR NEW.pending_plan_effective_at IS DISTINCT FROM OLD.pending_plan_effective_at
     OR NEW.subscription_state_event_at IS DISTINCT FROM OLD.subscription_state_event_at
     OR NEW.entitlement_source IS DISTINCT FROM OLD.entitlement_source THEN
    RAISE EXCEPTION 'financial_profile_fields_are_server_managed';
  END IF;

  IF NEW.creator_status IS DISTINCT FROM OLD.creator_status
     AND NOT (OLD.creator_status IN ('none', 'rejected') AND NEW.creator_status = 'pending') THEN
    RAISE EXCEPTION 'creator_status_transition_not_allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.sync_subscription_state_v1(
  uuid, text, public.plan_type, timestamptz, text, text, public.plan_type, timestamptz
);
CREATE FUNCTION public.sync_subscription_state_v1(
  p_user_id uuid, p_status text, p_plan public.plan_type,
  p_period_end timestamptz, p_subscription_id text, p_customer_id text,
  p_pending_plan public.plan_type DEFAULT NULL,
  p_pending_effective_at timestamptz DEFAULT NULL,
  p_event_created_at timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE; v_settings jsonb; v_grace_days integer;
  v_grace_until timestamptz; v_effective_plan public.plan_type;
  v_event_at timestamptz := COALESCE(p_event_created_at, now());
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_status NOT IN ('free', 'active', 'trialing', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'expired', 'paused') THEN
    RAISE EXCEPTION 'invalid_subscription_status';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

  IF v_profile.subscription_state_event_at IS NOT NULL
     AND v_event_at < v_profile.subscription_state_event_at THEN
    RETURN jsonb_build_object('ignored_stale_event', true, 'plan', v_profile.plan,
      'status', v_profile.subscription_status,
      'last_event_at', v_profile.subscription_state_event_at);
  END IF;

  -- Concessao administrativa vigente nao e cancelada por ausencia/inatividade
  -- de assinatura Stripe. Um pagamento Stripe confirmado volta a ser soberano.
  IF v_profile.entitlement_source = 'admin'
     AND v_profile.plan_expires_at > now()
     AND p_status NOT IN ('active', 'trialing', 'past_due') THEN
    RETURN jsonb_build_object('admin_entitlement_preserved', true,
      'plan', v_profile.plan, 'status', v_profile.subscription_status);
  END IF;

  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_grace_days := COALESCE((v_settings->>'subscription_grace_period_days')::int, 3);
  v_grace_until := CASE WHEN p_status = 'past_due'
    THEN COALESCE(v_profile.subscription_grace_until, now() + make_interval(days => v_grace_days))
    ELSE NULL END;
  v_effective_plan := CASE
    WHEN p_pending_plan IS NOT NULL AND p_pending_effective_at > now() AND v_profile.plan <> 'free'
      THEN v_profile.plan
    WHEN p_status IN ('active', 'trialing') THEN COALESCE(p_plan, 'free'::public.plan_type)
    WHEN p_status = 'past_due' AND v_grace_until > now() THEN COALESCE(p_plan, v_profile.plan)
    WHEN p_status = 'canceled' AND p_period_end > now() THEN COALESCE(p_plan, v_profile.plan)
    ELSE 'free'::public.plan_type
  END;

  UPDATE public.profiles SET
    plan = v_effective_plan,
    plan_expires_at = CASE WHEN v_effective_plan = 'free' THEN NULL ELSE p_period_end END,
    billing_id = COALESCE(p_customer_id, billing_id),
    stripe_subscription_id = p_subscription_id,
    subscription_status = p_status,
    subscription_plan = CASE WHEN p_plan IN ('pro', 'premium') THEN p_plan ELSE NULL END,
    subscription_grace_until = v_grace_until,
    pending_plan = p_pending_plan,
    pending_plan_effective_at = p_pending_effective_at,
    subscription_state_event_at = v_event_at,
    entitlement_source = CASE WHEN v_effective_plan = 'free' THEN 'free' ELSE 'stripe' END,
    updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('plan', v_effective_plan, 'status', p_status,
    'period_end', p_period_end, 'grace_until', v_grace_until,
    'pending_plan', p_pending_plan, 'pending_effective_at', p_pending_effective_at,
    'event_at', v_event_at);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_subscription_state_v1(
  uuid, text, public.plan_type, timestamptz, text, text, public.plan_type, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_subscription_state_v1(
  uuid, text, public.plan_type, timestamptz, text, text, public.plan_type, timestamptz, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_subscription_entitlements_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin')
    THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.profiles SET plan = 'free', plan_expires_at = NULL,
    subscription_status = 'expired', subscription_plan = NULL,
    pending_plan = NULL, pending_plan_effective_at = NULL,
    entitlement_source = 'free', updated_at = now()
  WHERE plan <> 'free' AND (
    (entitlement_source = 'admin' AND plan_expires_at <= now())
    OR (entitlement_source <> 'admin' AND (
      (subscription_status = 'past_due' AND subscription_grace_until <= now())
      OR (subscription_status = 'canceled' AND plan_expires_at <= now())
      OR subscription_status IN ('unpaid', 'incomplete_expired', 'expired', 'free')
    ))
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_subscription_entitlements_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_subscription_entitlements_v1() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. RLS: mutacoes economicas e operacionais somente por RPC auditada
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage all requests" ON public.creator_requests;
CREATE POLICY "Admins can view all creator requests" ON public.creator_requests FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage withdrawals" ON public.withdraw_requests;
CREATE POLICY "Admins can view all withdrawals" ON public.withdraw_requests FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage pending" ON public.wallet_pending;
CREATE POLICY "Admins can view pending balances" ON public.wallet_pending FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage economic cycles" ON public.economic_cycles;
CREATE POLICY "Admins can view economic cycles" ON public.economic_cycles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage cycle users" ON public.economic_cycle_users;
CREATE POLICY "Admins can view cycle users" ON public.economic_cycle_users FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage revenue entries" ON public.revenue_entries;
DROP POLICY IF EXISTS "Admins can insert revenue entries" ON public.revenue_entries;
CREATE POLICY "Admins can view revenue entries" ON public.revenue_entries FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage reconciliation runs" ON public.reconciliation_runs;
CREATE POLICY "Admins can view reconciliation runs" ON public.reconciliation_runs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Streak e evidencias de login nao podem ser fabricados pelo cliente.
DROP POLICY IF EXISTS "Users can insert own streaks" ON public.user_login_streaks;
DROP POLICY IF EXISTS "Users can update own streaks" ON public.user_login_streaks;
REVOKE INSERT, UPDATE, DELETE ON public.user_login_streaks FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_login_streak_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.user_login_streaks%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_yesterday date := v_today - 1;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':login-streak', 0));
  SELECT * INTO v_row FROM public.user_login_streaks WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_login_streaks(user_id, current_streak, longest_streak, last_login_date)
    VALUES (p_user_id, 1, 1, v_today) RETURNING * INTO v_row;
  ELSIF v_row.last_login_date IS DISTINCT FROM v_today THEN
    UPDATE public.user_login_streaks SET
      current_streak = CASE WHEN v_row.last_login_date = v_yesterday THEN v_row.current_streak + 1 ELSE 1 END,
      longest_streak = GREATEST(v_row.longest_streak,
        CASE WHEN v_row.last_login_date = v_yesterday THEN v_row.current_streak + 1 ELSE 1 END),
      last_login_date = v_today
    WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak, 'last_login_date', v_row.last_login_date);
END;
$$;
REVOKE ALL ON FUNCTION public.record_login_streak_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_streak_v1(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Ciclo atual, preview server-side e fechamento idempotente
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_current_cycle()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_year_month text; v_cycle_id uuid; v_pool_pct numeric;
BEGIN
  IF auth.role() <> 'service_role'
     AND current_setting('classfy.authorized_reward_operation', true) <> 'on'
    THEN RAISE EXCEPTION 'service_role_required'; END IF;
  v_year_month := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  SELECT id INTO v_cycle_id FROM public.economic_cycles WHERE year_month = v_year_month AND status = 'open';
  IF v_cycle_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.economic_cycles WHERE year_month = v_year_month AND status = 'closed') THEN
      RAISE EXCEPTION 'current_cycle_already_closed';
    END IF;
    SELECT COALESCE((value->>'pool_percentage')::numeric, 40) INTO v_pool_pct
    FROM public.platform_settings WHERE key = 'economic_v1';
    INSERT INTO public.economic_cycles(year_month, pool_percentage, economy_version)
    VALUES (v_year_month, v_pool_pct, 1)
    ON CONFLICT (year_month) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_cycle_id;
  END IF;
  RETURN v_cycle_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_current_cycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_current_cycle() TO service_role;

CREATE OR REPLACE FUNCTION public.commit_reward_award(
  p_tracking_user_id uuid, p_tracking_action_key text, p_tracking_content_id uuid,
  p_tracking_metadata jsonb, p_cycle_id uuid, p_actor_event jsonb,
  p_creator_event jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tracking_id uuid; v_actor public.reward_events%ROWTYPE; v_creator public.reward_events%ROWTYPE;
  v_actor_points numeric; v_creator_points numeric; v_actor_type text; v_creator_type text;
  v_cycle_status text; v_daily_limit integer; v_daily_count integer;
BEGIN
  IF auth.role() <> 'service_role'
     AND current_setting('classfy.authorized_reward_operation', true) <> 'on'
    THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_cycle_id IS NULL OR p_actor_event IS NULL THEN RAISE EXCEPTION 'invalid_reward_payload'; END IF;
  SELECT status INTO v_cycle_status FROM public.economic_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF v_cycle_status IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'economic_cycle_not_open'; END IF;
  SELECT daily_limit INTO v_daily_limit FROM public.reward_actions_config
  WHERE action_key = p_actor_event->>'action_key' AND active;
  IF v_daily_limit IS NOT NULL THEN
    -- Serializa ações fáceis do mesmo usuário/dia para o teto não ser vencido
    -- por duas requisições concorrentes.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_tracking_user_id::text || ':' || (p_actor_event->>'action_key') || ':' ||
      to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'), 0));
    SELECT count(*) INTO v_daily_count FROM public.reward_events
    WHERE user_id = p_tracking_user_id AND action_key = p_actor_event->>'action_key'
      AND point_type = COALESCE(p_actor_event->>'point_type', 'user')
      AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date =
        (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    IF v_daily_count >= v_daily_limit THEN
      RETURN jsonb_build_object('already_tracked', false, 'daily_limit_reached', true,
        'limit', v_daily_limit, 'rewards', '[]'::jsonb);
    END IF;
  END IF;
  INSERT INTO public.reward_action_tracking(user_id, content_id, action_key, metadata)
  VALUES (p_tracking_user_id, p_tracking_content_id, p_tracking_action_key,
    COALESCE(p_tracking_metadata, '{}'::jsonb))
  ON CONFLICT (user_id, action_key) DO NOTHING RETURNING id INTO v_tracking_id;
  IF v_tracking_id IS NULL THEN
    RETURN jsonb_build_object('already_tracked', true, 'rewards', '[]'::jsonb);
  END IF;
  v_actor_points := COALESCE((p_actor_event->>'cycle_points')::numeric,
    (p_actor_event->>'performance_points')::numeric, (p_actor_event->>'points')::numeric, 0);
  v_actor_type := COALESCE(p_actor_event->>'point_type', 'user');
  IF v_actor_points < 0 OR v_actor_type NOT IN ('user','creator') THEN RAISE EXCEPTION 'invalid_reward_points'; END IF;
  INSERT INTO public.reward_events(user_id, related_user_id, content_id, action_key, points, value,
    performance_points, cycle_points, point_type, cycle_id, metadata)
  VALUES ((p_actor_event->>'user_id')::uuid, NULLIF(p_actor_event->>'related_user_id','')::uuid,
    NULLIF(p_actor_event->>'content_id','')::uuid, p_actor_event->>'action_key', v_actor_points, 0,
    v_actor_points, v_actor_points, v_actor_type, p_cycle_id,
    COALESCE(p_actor_event->'metadata','{}'::jsonb)) RETURNING * INTO v_actor;
  INSERT INTO public.economic_cycle_users(cycle_id,user_id,performance_points,user_points,
    creator_points,cycle_points,qualified_for_pool)
  VALUES (p_cycle_id,v_actor.user_id,v_actor_points,
    CASE WHEN v_actor_type='user' THEN v_actor_points ELSE 0 END,
    CASE WHEN v_actor_type='creator' THEN v_actor_points ELSE 0 END,v_actor_points,true)
  ON CONFLICT (cycle_id,user_id) DO UPDATE SET
    user_points=economic_cycle_users.user_points+EXCLUDED.user_points,
    creator_points=economic_cycle_users.creator_points+EXCLUDED.creator_points,
    cycle_points=economic_cycle_users.cycle_points+EXCLUDED.cycle_points,
    performance_points=economic_cycle_users.performance_points+EXCLUDED.cycle_points,
    qualified_for_pool=true,qualification_points=0,qualification_details='{}'::jsonb,updated_at=now();
  IF p_creator_event IS NOT NULL THEN
    v_creator_points := COALESCE((p_creator_event->>'cycle_points')::numeric,
      (p_creator_event->>'performance_points')::numeric,(p_creator_event->>'points')::numeric,0);
    v_creator_type := COALESCE(p_creator_event->>'point_type','creator');
    IF v_creator_points < 0 OR v_creator_type <> 'creator' THEN RAISE EXCEPTION 'invalid_creator_points'; END IF;
    INSERT INTO public.reward_events(user_id,related_user_id,content_id,action_key,points,value,
      performance_points,cycle_points,point_type,cycle_id,metadata)
    VALUES ((p_creator_event->>'user_id')::uuid,NULLIF(p_creator_event->>'related_user_id','')::uuid,
      NULLIF(p_creator_event->>'content_id','')::uuid,p_creator_event->>'action_key',v_creator_points,0,
      v_creator_points,v_creator_points,'creator',p_cycle_id,
      COALESCE(p_creator_event->'metadata','{}'::jsonb)) RETURNING * INTO v_creator;
    INSERT INTO public.economic_cycle_users(cycle_id,user_id,performance_points,user_points,
      creator_points,cycle_points,qualified_for_pool)
    VALUES (p_cycle_id,v_creator.user_id,v_creator_points,0,v_creator_points,v_creator_points,true)
    ON CONFLICT (cycle_id,user_id) DO UPDATE SET
      creator_points=economic_cycle_users.creator_points+EXCLUDED.creator_points,
      cycle_points=economic_cycle_users.cycle_points+EXCLUDED.cycle_points,
      performance_points=economic_cycle_users.performance_points+EXCLUDED.cycle_points,
      qualified_for_pool=true,qualification_points=0,qualification_details='{}'::jsonb,updated_at=now();
  END IF;
  RETURN jsonb_build_object('already_tracked',false,'rewards',CASE
    WHEN p_creator_event IS NULL THEN jsonb_build_array(to_jsonb(v_actor))
    ELSE jsonb_build_array(to_jsonb(v_actor),to_jsonb(v_creator)) END);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_reward_award(uuid,text,uuid,jsonb,uuid,jsonb,jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_reward_award(uuid,text,uuid,jsonb,uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.award_creator_approval_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cfg public.reward_actions_config%ROWTYPE; v_cycle uuid;
BEGIN
  IF NEW.creator_status='approved' AND OLD.creator_status IS DISTINCT FROM 'approved' THEN
    SELECT * INTO v_cfg FROM public.reward_actions_config WHERE action_key='CREATOR_APPROVED' AND active;
    IF FOUND THEN
      PERFORM set_config('classfy.authorized_reward_operation','on',true);
      SELECT public.get_or_create_current_cycle() INTO v_cycle;
      PERFORM public.commit_reward_award(NEW.id,'CREATOR_APPROVED',NULL,
        jsonb_build_object('source','creator_status_transition'),v_cycle,
        jsonb_build_object('user_id',NEW.id,'action_key','CREATOR_APPROVED',
          'points',v_cfg.points_creator,'cycle_points',v_cfg.points_creator,'point_type','creator',
          'metadata',jsonb_build_object('activation',true)),NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_economic_cycle_preview_v1(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_revenue jsonb; v_settings jsonb; v_cycle uuid; v_points numeric; v_users integer; v_pct numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_year_month'; END IF;
  SELECT public.calculate_eligible_revenue_v1(p_year_month) INTO v_revenue;
  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_pct := COALESCE((v_settings->>'pool_percentage')::numeric, 40);
  SELECT id INTO v_cycle FROM public.economic_cycles WHERE year_month = p_year_month;
  SELECT COALESCE(sum(cycle_points), 0), count(*) FILTER (WHERE cycle_points > 0)
  INTO v_points, v_users FROM public.economic_cycle_users WHERE cycle_id = v_cycle;
  RETURN v_revenue || jsonb_build_object(
    'pool_percentage', v_pct,
    'pool_amount', round(COALESCE((v_revenue->>'eligible_net_revenue')::numeric, 0) * v_pct / 100, 2),
    'total_points', COALESCE(v_points, 0), 'participants', COALESCE(v_users, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_economic_cycle_preview_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_economic_cycle_preview_v1(text) TO authenticated;

ALTER TABLE public.economic_cycles
  ADD COLUMN IF NOT EXISTS settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.calculate_eligible_revenue_v1(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_gross numeric; v_net numeric; v_affiliate numeric;
BEGIN
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_year_month'; END IF;
  SELECT COALESCE(sum(gross_amount), 0), COALESCE(sum(net_eligible_amount), 0)
  INTO v_gross, v_net FROM public.revenue_entries
  WHERE year_month = p_year_month AND status = 'confirmed' AND is_pool_eligible = true;
  SELECT COALESCE(sum(commission_amount), 0) INTO v_affiliate
  FROM public.referral_commissions
  WHERE status = 'paid'
    AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = p_year_month;
  v_net := GREATEST(0, v_net - v_affiliate);
  RETURN jsonb_build_object('gross_revenue', v_gross, 'affiliate_deductions', v_affiliate,
    'eligible_net_revenue', round(v_net, 2));
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_eligible_revenue_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_eligible_revenue_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_revenue_entry_v1(
  p_revenue_type text, p_gross_amount numeric, p_source_id text, p_user_id uuid,
  p_metadata jsonb, p_is_pool_eligible boolean,
  p_payment_fee_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0,
  p_creator_amount numeric DEFAULT 0
)
RETURNS public.revenue_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entry public.revenue_entries%ROWTYPE; v_month text; v_net numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_gross_amount <= 0 OR p_payment_fee_amount < 0 OR p_tax_amount < 0 OR p_creator_amount < 0
    THEN RAISE EXCEPTION 'invalid_revenue_amount'; END IF;
  IF p_payment_fee_amount + p_tax_amount + p_creator_amount > p_gross_amount
    THEN RAISE EXCEPTION 'deductions_exceed_gross'; END IF;
  IF p_revenue_type NOT IN ('subscription_pro', 'subscription_premium', 'content_purchase', 'boost', 'other')
    THEN RAISE EXCEPTION 'invalid_revenue_type'; END IF;
  IF p_revenue_type = 'other' AND p_is_pool_eligible IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'other_revenue_requires_explicit_eligibility'; END IF;
  v_month := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  v_net := CASE WHEN p_is_pool_eligible
    THEN round(GREATEST(0, p_gross_amount-p_payment_fee_amount-p_tax_amount-p_creator_amount), 2)
    ELSE 0 END;
  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, user_id, metadata,
    status, is_pool_eligible, gross_amount, payment_fee_amount, tax_amount, creator_amount,
    classfy_amount, net_eligible_amount, confirmed_at)
  VALUES (v_month, p_revenue_type, v_net, p_source_id, p_user_id, COALESCE(p_metadata, '{}'::jsonb),
    'confirmed', p_is_pool_eligible, p_gross_amount, p_payment_fee_amount, p_tax_amount,
    p_creator_amount, GREATEST(0, p_gross_amount-p_creator_amount), v_net, now())
  ON CONFLICT (source_id) WHERE source_id IS NOT NULL DO UPDATE SET source_id = EXCLUDED.source_id
  RETURNING * INTO v_entry;
  RETURN v_entry;
END;
$$;
REVOKE ALL ON FUNCTION public.record_revenue_entry_v1(text, numeric, text, uuid, jsonb, boolean, numeric, numeric, numeric)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_revenue_entry_v1(text, numeric, text, uuid, jsonb, boolean, numeric, numeric, numeric)
TO service_role;

CREATE OR REPLACE FUNCTION public.record_manual_eligible_revenue_v1(
  p_amount numeric, p_description text, p_reason text
)
RETURNS public.revenue_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entry public.revenue_entries%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF NULLIF(btrim(p_description), '') IS NULL OR NULLIF(btrim(p_reason), '') IS NULL
    THEN RAISE EXCEPTION 'description_and_reason_required'; END IF;
  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, user_id, metadata,
    status, is_pool_eligible, gross_amount, classfy_amount, net_eligible_amount, confirmed_at)
  VALUES (to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM'), 'other', p_amount,
    'admin_' || gen_random_uuid()::text, auth.uid(),
    jsonb_build_object('description', btrim(p_description), 'pool_eligible', true),
    'confirmed', true, p_amount, p_amount, p_amount, now()) RETURNING * INTO v_entry;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'create', 'eligible_revenue', v_entry.id::text, btrim(p_reason), NULL, to_jsonb(v_entry));
  RETURN v_entry;
END;
$$;
REVOKE ALL ON FUNCTION public.record_manual_eligible_revenue_v1(numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_eligible_revenue_v1(numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_economic_cycle_v1(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cycle public.economic_cycles%ROWTYPE; v_settings jsonb; v_revenue jsonb;
  v_pool_pct numeric; v_eligible numeric; v_gross numeric; v_pool numeric; v_total numeric;
  v_user_total numeric; v_creator_total numeric; v_pool_cents bigint; v_base_sum bigint;
  v_leftover bigint; v_index bigint := 0; v_paid integer := 0; r record; v_amount numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_year_month'; END IF;
  IF p_year_month >= to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')
    THEN RAISE EXCEPTION 'cycle_not_finished'; END IF;
  INSERT INTO public.economic_cycles(year_month, pool_percentage, economy_version)
  VALUES (p_year_month, 40, 1) ON CONFLICT (year_month) DO NOTHING;
  SELECT * INTO v_cycle FROM public.economic_cycles WHERE year_month = p_year_month FOR UPDATE;
  IF v_cycle.status = 'closed' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'year_month', p_year_month,
      'gross_revenue', v_cycle.gross_revenue,
      'eligible_net_revenue', v_cycle.eligible_net_revenue,
      'pool_percentage', v_cycle.pool_percentage, 'pool_amount', v_cycle.prm,
      'total_points', v_cycle.total_performance_points,
      'total_user_points', v_cycle.total_user_points,
      'total_creator_points', v_cycle.total_creator_points,
      'distributed_amount', v_cycle.distributed_amount);
  END IF;
  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_pool_pct := COALESCE((v_settings->>'pool_percentage')::numeric, 40);
  SELECT public.calculate_eligible_revenue_v1(p_year_month) INTO v_revenue;
  v_gross := COALESCE((v_revenue->>'gross_revenue')::numeric, 0);
  v_eligible := COALESCE((v_revenue->>'eligible_net_revenue')::numeric, 0);
  v_pool := round(v_eligible*v_pool_pct/100, 2);
  SELECT COALESCE(sum(cycle_points), 0), COALESCE(sum(user_points), 0),
    COALESCE(sum(creator_points), 0) INTO v_total, v_user_total, v_creator_total
  FROM public.economic_cycle_users WHERE cycle_id = v_cycle.id AND cycle_points > 0;
  v_pool_cents := round(v_pool*100)::bigint;
  SELECT COALESCE(sum(floor((cycle_points/NULLIF(v_total,0))*v_pool_cents)),0)::bigint
  INTO v_base_sum FROM public.economic_cycle_users WHERE cycle_id=v_cycle.id AND cycle_points>0;
  v_leftover := GREATEST(0, v_pool_cents-v_base_sum);
  FOR r IN
    SELECT user_id, cycle_points,
      floor((cycle_points/NULLIF(v_total,0))*v_pool_cents)::bigint base_cents,
      ((cycle_points/NULLIF(v_total,0))*v_pool_cents)
        - floor((cycle_points/NULLIF(v_total,0))*v_pool_cents) remainder
    FROM public.economic_cycle_users WHERE cycle_id=v_cycle.id AND cycle_points>0
    ORDER BY remainder DESC, user_id
  LOOP
    v_index := v_index+1;
    v_amount := (r.base_cents + CASE WHEN v_index<=v_leftover THEN 1 ELSE 0 END)::numeric/100;
    PERFORM public.distribute_cycle_payout(v_cycle.id,r.user_id,v_amount,p_year_month,r.cycle_points,v_total);
    IF v_amount>0 THEN v_paid:=v_paid+1; END IF;
  END LOOP;
  UPDATE public.economic_cycles SET gross_revenue=v_gross, eligible_net_revenue=v_eligible,
    rbm=v_eligible, pool_percentage=v_pool_pct, prm=v_pool,
    total_performance_points=v_total, total_user_points=v_user_total,
    total_creator_points=v_creator_total,
    distributed_amount=CASE WHEN v_total>0 THEN v_pool ELSE 0 END,
    status='closed', closed_at=now(), updated_at=now(), economy_version=1,
    settings_snapshot=v_settings
  WHERE id=v_cycle.id;
  RETURN jsonb_build_object('success',true,'idempotent',false,'year_month',p_year_month,
    'gross_revenue',v_gross,'eligible_net_revenue',v_eligible,'pool_percentage',v_pool_pct,
    'pool_amount',v_pool,'total_points',v_total,'total_user_points',v_user_total,
    'total_creator_points',v_creator_total,'users_paid',v_paid,
    'distributed_amount',CASE WHEN v_total>0 THEN v_pool ELSE 0 END);
END;
$$;
REVOKE ALL ON FUNCTION public.close_economic_cycle_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_economic_cycle_v1(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Ledger pendente e disponivel, ambos append-only e reconciliaveis
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.distribute_cycle_payout(
  p_cycle_id uuid, p_user_id uuid, p_amount numeric, p_year_month text,
  p_user_pp numeric, p_total_pp numeric
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer; v_wallet_id uuid; v_tx_id uuid; v_pending_id uuid;
  v_plan public.plan_type; v_settings jsonb; v_days integer; v_key text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_amount < 0 THEN RAISE EXCEPTION 'negative_payout'; END IF;
  SELECT COALESCE(plan, 'free'::public.plan_type) INTO v_plan FROM public.profiles WHERE id = p_user_id;
  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_days := COALESCE((v_settings->'reward_maturation_days'->>v_plan::text)::int,
    CASE v_plan WHEN 'premium' THEN 2 WHEN 'pro' THEN 7 ELSE 30 END);
  UPDATE public.economic_cycle_users SET calculated_share = round(p_amount, 2), payout_status = 'paid',
    plan_at_close = v_plan, maturation_days = v_days, points_liquidated_at = now(), updated_at = now()
  WHERE cycle_id = p_cycle_id AND user_id = p_user_id AND payout_status IS DISTINCT FROM 'paid';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 OR p_amount = 0 THEN RETURN; END IF;

  INSERT INTO public.wallets(user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  v_key := 'pool_dist_' || p_cycle_id::text || '_' || p_user_id::text;
  INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, idempotency_key,
    cycle_id, status, metadata)
  VALUES (v_wallet_id, 'pool_distribution_pending', round(p_amount, 2),
    'Recompensa confirmada em maturacao - ' || p_year_month, 'pending_' || v_key,
    p_cycle_id, 'pending', jsonb_build_object('plan_at_close', v_plan,
      'maturation_days', v_days, 'participant_points', p_user_pp,
      'total_cycle_points', p_total_pp))
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_tx_id;

  INSERT INTO public.wallet_pending(wallet_id, user_id, amount, source_type, cycle_id, idempotency_key,
    mature_at, transaction_id, status, metadata)
  VALUES (v_wallet_id, p_user_id, round(p_amount, 2), 'pool_distribution', p_cycle_id, v_key,
    now() + make_interval(days => v_days), v_tx_id, 'pending',
    jsonb_build_object('plan_at_close', v_plan, 'maturation_days', v_days,
      'participant_points', p_user_pp, 'total_cycle_points', p_total_pp))
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_pending_id;
  IF v_pending_id IS NOT NULL THEN
    UPDATE public.wallets SET pending_balance = pending_balance + round(p_amount, 2), updated_at = now()
    WHERE id = v_wallet_id;
    INSERT INTO public.notifications(user_id, type, title, message)
    VALUES (p_user_id, 'reward', 'Recompensa confirmada',
      'O ciclo ' || p_year_month || ' confirmou R$ ' || round(p_amount, 2)::text ||
      '. Disponivel em ' || v_days::text || ' dias.');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.distribute_cycle_payout(uuid, uuid, numeric, text, numeric, numeric)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.distribute_cycle_payout(uuid, uuid, numeric, text, numeric, numeric)
TO service_role;

CREATE OR REPLACE FUNCTION public.batch_mature_pending()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_amount numeric; v_count integer := 0; v_total numeric := 0; v_label text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin')
    THEN RAISE EXCEPTION 'service_role_required'; END IF;
  FOR r IN SELECT * FROM public.wallet_pending
    WHERE mature_at <= now() AND matured_at IS NULL AND status = 'pending'
    FOR UPDATE SKIP LOCKED
  LOOP
    v_amount := round(r.amount - r.reversed_amount, 2);
    IF v_amount <= 0 THEN
      UPDATE public.wallet_pending SET status = 'reversed', matured_at = now() WHERE id = r.id;
      CONTINUE;
    END IF;
    INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, cycle_id, purchase_id,
      idempotency_key, status, metadata)
    VALUES (r.wallet_id, r.source_type, v_amount, 'Saldo liberado', r.cycle_id, r.purchase_id,
      'matured_' || r.id::text, 'posted', jsonb_build_object('pending_transaction_id', r.transaction_id))
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    IF NOT FOUND THEN
      UPDATE public.wallet_pending SET matured_at = COALESCE(matured_at, now()), status = 'matured' WHERE id = r.id;
      CONTINUE;
    END IF;
    UPDATE public.wallets SET balance = balance + v_amount,
      pending_balance = GREATEST(0, pending_balance - v_amount),
      total_earned = total_earned + v_amount, updated_at = now()
    WHERE id = r.wallet_id;
    UPDATE public.wallet_pending SET matured_at = now(), status = 'matured' WHERE id = r.id;
    SELECT COALESCE(ec.year_month, '') INTO v_label FROM public.economic_cycles ec WHERE ec.id = r.cycle_id;
    INSERT INTO public.notifications(user_id, type, title, message)
    VALUES (r.user_id, 'reward', 'Saldo liberado',
      'R$ ' || v_amount::text || ' estao disponiveis na sua carteira' ||
      CASE WHEN v_label <> '' THEN ' pelo ciclo ' || v_label ELSE '' END || '.');
    v_count := v_count + 1; v_total := v_total + v_amount;
  END LOOP;
  RETURN jsonb_build_object('matured_count', v_count, 'total_released', v_total, 'run_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.batch_mature_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_mature_pending() TO service_role;

-- Saque reservado nao pode ser pago se uma reversao tornou o saldo negativo.
CREATE OR REPLACE FUNCTION public.mark_withdrawal_paid(p_request_id uuid, p_admin_notes text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.withdraw_requests%ROWTYPE; v_wallet public.wallets%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_req FROM public.withdraw_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.status <> 'pending' THEN RAISE EXCEPTION 'withdraw_already_processed'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_req.wallet_id FOR UPDATE;
  IF v_wallet.balance <= 0
     OR v_wallet.balance < v_req.amount
     OR v_wallet.balance < v_wallet.reserved_balance THEN
    RAISE EXCEPTION 'insufficient_available_balance';
  END IF;
  UPDATE public.withdraw_requests SET status = 'paid', approved_by = auth.uid(), approved_at = now(),
    admin_notes = p_admin_notes WHERE id = v_req.id;
  UPDATE public.wallets SET balance = balance - v_req.amount,
    reserved_balance = GREATEST(0, reserved_balance - v_req.amount),
    total_withdrawn = total_withdrawn + v_req.amount, updated_at = now()
  WHERE id = v_req.wallet_id RETURNING * INTO v_wallet;
  INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, withdraw_request_id,
    idempotency_key, status, admin_id, metadata)
  VALUES (v_wallet.id, 'withdraw', -v_req.amount, 'Saque pago - R$ ' || v_req.amount::text, v_req.id,
    'withdraw_' || v_req.id::text, 'posted', auth.uid(), jsonb_build_object('reason', btrim(p_reason)));
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'pay', 'withdrawal', v_req.id::text, btrim(p_reason), to_jsonb(v_req),
    jsonb_build_object('status', 'paid', 'amount', v_req.amount));
  INSERT INTO public.notifications(user_id, type, title, message)
  VALUES (v_req.user_id, 'withdraw', 'Saque pago', 'Seu saque de R$ ' || v_req.amount::text || ' foi pago.');
  RETURN jsonb_build_object('success', true, 'new_balance', v_wallet.balance, 'amount', v_req.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_withdrawal_paid(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_paid(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Venda avulsa: ledger pendente e reversao ligada ao pagamento correto
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_entry_id uuid NOT NULL REFERENCES public.revenue_entries(id),
  reversal_type text NOT NULL CHECK (reversal_type IN ('refund', 'chargeback')),
  gross_amount numeric NOT NULL CHECK (gross_amount > 0),
  classfy_amount numeric NOT NULL CHECK (classfy_amount >= 0),
  stripe_event_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.revenue_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view revenue reversals" ON public.revenue_reversals FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
REVOKE INSERT, UPDATE, DELETE ON public.revenue_reversals FROM anon, authenticated;

-- Uma nova compra apos reembolso deve criar novo registro, preservando todo o
-- historico anterior. Apenas uma posse ativa por usuario/conteudo e permitida.
ALTER TABLE public.purchased_contents
  DROP CONSTRAINT IF EXISTS purchased_contents_user_id_content_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS purchased_contents_active_ownership_unique
  ON public.purchased_contents(user_id, content_id)
  WHERE status IN ('confirmed', 'legacy_confirmed');

CREATE OR REPLACE FUNCTION public.record_content_sale_v1(
  p_user_id uuid, p_content_id uuid, p_gross_amount numeric, p_discount_applied numeric,
  p_payment_intent_id text, p_checkout_session_id text,
  p_payment_fee_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_creator uuid; v_settings jsonb; v_classfy_pct numeric; v_creator_pct numeric;
  v_classfy numeric; v_creator_amount numeric; v_net numeric; v_hold integer;
  v_purchase public.purchased_contents%ROWTYPE; v_wallet uuid; v_tx uuid; v_pending uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_gross_amount <= 0 OR p_payment_fee_amount < 0 OR p_tax_amount < 0
     OR NULLIF(btrim(p_payment_intent_id), '') IS NULL THEN RAISE EXCEPTION 'invalid_sale_amount'; END IF;
  SELECT creator_id INTO v_creator FROM public.contents WHERE id = p_content_id AND status = 'approved';
  IF v_creator IS NULL THEN RAISE EXCEPTION 'content_or_creator_not_found'; END IF;
  IF v_creator = p_user_id THEN RAISE EXCEPTION 'creator_cannot_buy_own_content'; END IF;
  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_classfy_pct := COALESCE((v_settings->>'sales_commission_percent')::numeric, 20);
  v_creator_pct := 100 - v_classfy_pct;
  v_classfy := round(p_gross_amount * v_classfy_pct / 100, 2);
  v_creator_amount := round(p_gross_amount - v_classfy, 2);
  v_net := GREATEST(0, round(v_classfy - p_payment_fee_amount - p_tax_amount, 2));
  v_hold := COALESCE((v_settings->>'creator_sales_hold_days')::int, 7);

  INSERT INTO public.purchased_contents(user_id, content_id, creator_id, price_paid, discount_applied,
    gross_amount, classfy_percent, creator_percent, classfy_amount, creator_amount,
    payment_fee_amount, tax_amount, refunded_amount, chargeback_amount, status,
    stripe_payment_intent_id, stripe_checkout_session_id, processed_at)
  VALUES (p_user_id, p_content_id, v_creator, p_gross_amount, COALESCE(p_discount_applied, 0),
    p_gross_amount, v_classfy_pct, v_creator_pct, v_classfy, v_creator_amount,
    p_payment_fee_amount, p_tax_amount, 0, 0, 'confirmed',
    p_payment_intent_id, p_checkout_session_id, now())
  ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL
  DO UPDATE SET stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id
  RETURNING * INTO v_purchase;

  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, user_id, metadata,
    status, is_pool_eligible, gross_amount, payment_fee_amount, tax_amount, creator_amount,
    classfy_amount, net_eligible_amount, confirmed_at)
  VALUES (to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM'), 'content_purchase', v_net,
    p_payment_intent_id, p_user_id,
    jsonb_build_object('purchase_id', v_purchase.id, 'content_id', p_content_id,
      'classfy_percent', v_classfy_pct, 'creator_percent', v_creator_pct,
      'classfy_amount', v_classfy, 'creator_amount', v_creator_amount),
    'confirmed', true, p_gross_amount, p_payment_fee_amount, p_tax_amount,
    v_creator_amount, v_classfy, v_net, now())
  ON CONFLICT (source_id) WHERE source_id IS NOT NULL DO NOTHING;

  INSERT INTO public.wallets(user_id) VALUES (v_creator) ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet FROM public.wallets WHERE user_id = v_creator FOR UPDATE;
  INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, purchase_id,
    idempotency_key, status, metadata)
  VALUES (v_wallet, 'creator_sale_pending', v_creator_amount, 'Venda em hold', v_purchase.id,
    'pending_creator_sale_' || p_payment_intent_id, 'pending',
    jsonb_build_object('hold_days', v_hold, 'payment_intent_id', p_payment_intent_id,
      'classfy_percent', v_classfy_pct, 'creator_percent', v_creator_pct))
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id INTO v_tx;

  INSERT INTO public.wallet_pending(wallet_id, user_id, amount, source_type, purchase_id, idempotency_key,
    mature_at, transaction_id, status, metadata)
  VALUES (v_wallet, v_creator, v_creator_amount, 'creator_sale', v_purchase.id,
    'creator_sale_' || p_payment_intent_id, now() + make_interval(days => v_hold), v_tx, 'pending',
    jsonb_build_object('hold_days', v_hold, 'payment_intent_id', p_payment_intent_id,
      'gross_amount', p_gross_amount, 'classfy_amount', v_classfy,
      'creator_amount', v_creator_amount, 'classfy_percent', v_classfy_pct,
      'creator_percent', v_creator_pct))
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_pending;
  IF v_pending IS NOT NULL THEN
    UPDATE public.wallets SET pending_balance = pending_balance + v_creator_amount, updated_at = now()
    WHERE id = v_wallet;
  END IF;
  RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase.id,
    'gross_amount', p_gross_amount, 'classfy_percent', v_classfy_pct, 'classfy_amount', v_classfy,
    'creator_percent', v_creator_pct, 'creator_amount', v_creator_amount,
    'eligible_net_revenue', v_net, 'creator_hold_days', v_hold);
END;
$$;
REVOKE ALL ON FUNCTION public.record_content_sale_v1(uuid, uuid, numeric, numeric, text, text, numeric, numeric)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_sale_v1(uuid, uuid, numeric, numeric, text, text, numeric, numeric)
TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_content_sale_v1(
  p_payment_intent_id text, p_reversal_type text, p_reversed_gross_amount numeric, p_stripe_event_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_purchase public.purchased_contents%ROWTYPE; v_old_total numeric; v_new_total numeric;
  v_delta numeric; v_creator_delta numeric; v_total_classfy_reversal numeric;
  v_refund_classfy numeric; v_chargeback_classfy numeric; v_pending public.wallet_pending%ROWTYPE;
  v_wallet public.wallets%ROWTYPE; v_status text; v_revenue public.revenue_entries%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_reversal_type NOT IN ('refund', 'chargeback') OR p_reversed_gross_amount <= 0
     OR NULLIF(btrim(p_stripe_event_id), '') IS NULL THEN RAISE EXCEPTION 'invalid_reversal'; END IF;
  IF EXISTS (SELECT 1 FROM public.revenue_reversals WHERE stripe_event_id = p_stripe_event_id) THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;
  SELECT * INTO v_purchase FROM public.purchased_contents
  WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'purchase_not_found', true); END IF;
  v_old_total := LEAST(v_purchase.gross_amount, v_purchase.refunded_amount + v_purchase.chargeback_amount);
  IF p_reversal_type = 'refund' THEN
    UPDATE public.purchased_contents
    SET refunded_amount = LEAST(gross_amount - chargeback_amount,
      GREATEST(refunded_amount, p_reversed_gross_amount))
    WHERE id = v_purchase.id RETURNING * INTO v_purchase;
  ELSE
    UPDATE public.purchased_contents
    SET chargeback_amount = LEAST(gross_amount - refunded_amount,
      chargeback_amount + p_reversed_gross_amount)
    WHERE id = v_purchase.id RETURNING * INTO v_purchase;
  END IF;
  v_new_total := LEAST(v_purchase.gross_amount, v_purchase.refunded_amount + v_purchase.chargeback_amount);
  v_delta := GREATEST(0, v_new_total - v_old_total);
  IF v_delta = 0 THEN RETURN jsonb_build_object('success', true, 'idempotent', true); END IF;
  v_creator_delta := LEAST(v_purchase.creator_amount,
    round(v_purchase.creator_amount * v_delta / v_purchase.gross_amount, 2));
  v_refund_classfy := round(v_purchase.classfy_amount * v_purchase.refunded_amount / v_purchase.gross_amount, 2);
  v_chargeback_classfy := round(v_purchase.classfy_amount * v_purchase.chargeback_amount / v_purchase.gross_amount, 2);
  v_total_classfy_reversal := LEAST(v_purchase.classfy_amount, v_refund_classfy + v_chargeback_classfy);
  v_status := CASE WHEN v_new_total >= v_purchase.gross_amount
    THEN CASE WHEN p_reversal_type = 'refund' THEN 'refunded' ELSE 'chargeback' END
    ELSE 'confirmed' END;
  UPDATE public.purchased_contents SET status = v_status WHERE id = v_purchase.id;
  UPDATE public.revenue_entries SET refund_amount = v_refund_classfy,
    chargeback_amount = v_chargeback_classfy,
    net_eligible_amount = GREATEST(0, classfy_amount - payment_fee_amount - tax_amount - v_total_classfy_reversal),
    amount = GREATEST(0, classfy_amount - payment_fee_amount - tax_amount - v_total_classfy_reversal),
    status = CASE WHEN v_new_total >= v_purchase.gross_amount
      THEN CASE WHEN p_reversal_type = 'refund' THEN 'refunded' ELSE 'chargeback' END
      ELSE 'confirmed' END
  WHERE source_id = p_payment_intent_id RETURNING * INTO v_revenue;
  IF v_revenue.id IS NOT NULL THEN
    INSERT INTO public.revenue_reversals(revenue_entry_id, reversal_type, gross_amount,
      classfy_amount, stripe_event_id)
    VALUES (v_revenue.id, p_reversal_type, v_delta,
      round(v_purchase.classfy_amount * v_delta / v_purchase.gross_amount, 2), p_stripe_event_id);
  END IF;

  SELECT * INTO v_pending FROM public.wallet_pending
  WHERE idempotency_key = 'creator_sale_' || p_payment_intent_id FOR UPDATE;
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_purchase.creator_id FOR UPDATE;
  IF v_pending.id IS NOT NULL AND v_pending.matured_at IS NULL AND v_pending.status = 'pending' THEN
    UPDATE public.wallet_pending SET reversed_amount = LEAST(amount, reversed_amount + v_creator_delta),
      status = CASE WHEN reversed_amount + v_creator_delta >= amount THEN 'reversed' ELSE 'pending' END
    WHERE id = v_pending.id;
    UPDATE public.wallets SET pending_balance = GREATEST(0, pending_balance - v_creator_delta), updated_at = now()
    WHERE id = v_wallet.id;
    INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, purchase_id,
      stripe_event_id, idempotency_key, status, metadata)
    VALUES (v_wallet.id, 'creator_sale_reversal', -v_creator_delta, 'Reversao antes da liberacao',
      v_purchase.id, p_stripe_event_id, 'creator_sale_reversal_' || p_stripe_event_id,
      'reversed', jsonb_build_object('reversal_type', p_reversal_type, 'pending_reversal', true,
        'pending_transaction_id', v_pending.transaction_id));
  ELSE
    PERFORM public.increment_wallet(v_purchase.creator_id, -v_creator_delta, 'creator_sale_reversal',
      'Reversao de venda apos liberacao', 'creator_sale_reversal_' || p_stripe_event_id,
      NULL, NULL, p_stripe_event_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'reversed_gross', v_delta,
    'creator_debit', v_creator_delta, 'new_purchase_status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_content_sale_v1(text, text, numeric, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_content_sale_v1(text, text, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_revenue_entry_v1(
  p_source_id text, p_reversal_type text, p_reversed_gross_amount numeric, p_stripe_event_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entry public.revenue_entries%ROWTYPE; v_classfy_reversal numeric;
  v_refund numeric; v_chargeback numeric; v_total numeric; v_prior_gross numeric;
  v_gross_delta numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_reversal_type NOT IN ('refund', 'chargeback') OR p_reversed_gross_amount <= 0
     OR NULLIF(btrim(p_source_id), '') IS NULL OR NULLIF(btrim(p_stripe_event_id), '') IS NULL
     THEN RAISE EXCEPTION 'invalid_reversal'; END IF;
  IF EXISTS (SELECT 1 FROM public.revenue_reversals WHERE stripe_event_id = p_stripe_event_id) THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;
  SELECT * INTO v_entry FROM public.revenue_entries WHERE source_id = p_source_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'revenue_not_found', true); END IF;
  SELECT COALESCE(sum(gross_amount), 0) INTO v_prior_gross
  FROM public.revenue_reversals
  WHERE revenue_entry_id = v_entry.id AND reversal_type = p_reversal_type;
  -- charge.refunded informa o total acumulado; chargeback informa o delta.
  v_gross_delta := CASE WHEN p_reversal_type = 'refund'
    THEN GREATEST(0, LEAST(p_reversed_gross_amount, v_entry.gross_amount) - v_prior_gross)
    ELSE LEAST(p_reversed_gross_amount,
      GREATEST(0, v_entry.gross_amount - v_prior_gross)) END;
  IF v_gross_delta = 0 THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;
  v_classfy_reversal := LEAST(v_entry.classfy_amount,
    round(v_entry.classfy_amount * v_gross_delta /
      NULLIF(v_entry.gross_amount, 0), 2));
  INSERT INTO public.revenue_reversals(revenue_entry_id, reversal_type, gross_amount,
    classfy_amount, stripe_event_id)
  VALUES (v_entry.id, p_reversal_type, v_gross_delta,
    v_classfy_reversal, p_stripe_event_id);
  SELECT COALESCE(sum(classfy_amount) FILTER (WHERE reversal_type = 'refund'), 0),
    COALESCE(sum(classfy_amount) FILTER (WHERE reversal_type = 'chargeback'), 0)
  INTO v_refund, v_chargeback FROM public.revenue_reversals WHERE revenue_entry_id = v_entry.id;
  v_total := LEAST(v_entry.classfy_amount, v_refund + v_chargeback);
  UPDATE public.revenue_entries SET refund_amount = LEAST(classfy_amount, v_refund),
    chargeback_amount = LEAST(classfy_amount, v_chargeback),
    net_eligible_amount = GREATEST(0, classfy_amount - payment_fee_amount - tax_amount - v_total),
    amount = GREATEST(0, classfy_amount - payment_fee_amount - tax_amount - v_total),
    status = CASE WHEN v_total >= classfy_amount
      THEN CASE WHEN p_reversal_type = 'refund' THEN 'refunded' ELSE 'chargeback' END
      ELSE 'confirmed' END
  WHERE id = v_entry.id;
  RETURN jsonb_build_object('success', true, 'reversed_classfy_amount', v_classfy_reversal);
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_revenue_entry_v1(text, text, numeric, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_revenue_entry_v1(text, text, numeric, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Indicacao atomica e autorizada
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS referral_commissions_conversion_unique
  ON public.referral_commissions(conversion_id);

CREATE OR REPLACE FUNCTION public.process_referral_commission_v1(
  p_conversion_id uuid, p_purchase_amount numeric, p_purchase_type text, p_stripe_charge_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conversion public.referral_conversions%ROWTYPE; v_settings jsonb;
  v_rate numeric; v_amount numeric; v_commission public.referral_commissions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_purchase_amount <= 0 OR p_purchase_amount > 100000
     OR NULLIF(btrim(p_purchase_type), '') IS NULL THEN RAISE EXCEPTION 'invalid_purchase'; END IF;
  SELECT * INTO v_conversion FROM public.referral_conversions WHERE id = p_conversion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversion_not_found'; END IF;
  IF v_conversion.commission_paid OR v_conversion.first_purchase_at IS NOT NULL THEN
    SELECT * INTO v_commission FROM public.referral_commissions WHERE conversion_id = p_conversion_id;
    RETURN jsonb_build_object('success', true, 'idempotent', true,
      'commission_id', v_commission.id, 'commission_amount', v_commission.commission_amount);
  END IF;
  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_rate := LEAST(0.5, GREATEST(0, COALESCE((v_settings->>'referral_commission_percent')::numeric, 10) / 100));
  v_amount := round(p_purchase_amount * v_rate, 2);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'zero_commission'; END IF;
  INSERT INTO public.referral_commissions(referrer_id, referred_user_id, conversion_id,
    purchase_type, purchase_amount, commission_rate, commission_amount, status,
    stripe_charge_id, paid_at)
  VALUES (v_conversion.referrer_id, v_conversion.referred_user_id, v_conversion.id,
    p_purchase_type, p_purchase_amount, v_rate, v_amount, 'paid', p_stripe_charge_id, now())
  RETURNING * INTO v_commission;
  UPDATE public.referral_conversions SET first_purchase_at = now(), commission_paid = true
  WHERE id = v_conversion.id;
  PERFORM public.increment_wallet(v_conversion.referrer_id, v_amount, 'commission',
    'Comissao de indicacao - conversao ' || left(v_conversion.id::text, 8),
    'commission_' || v_commission.id::text, NULL, v_commission.id, p_stripe_charge_id);
  INSERT INTO public.notifications(user_id, type, title, message)
  VALUES (v_conversion.referrer_id, 'reward', 'Comissao recebida',
    'Voce recebeu R$ ' || v_amount::text || ' por uma indicacao.');
  RETURN jsonb_build_object('success', true, 'commission_id', v_commission.id,
    'commission_amount', v_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.process_referral_commission_v1(uuid, numeric, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_commission_v1(uuid, numeric, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Operacoes administrativas auditadas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_content_v1(
  p_item_id uuid, p_item_type text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_creator uuid; v_title text; v_content_type text; v_old_status text;
  v_creator_status public.creator_status; v_has_role boolean; v_cycle uuid;
  v_cfg public.reward_actions_config%ROWTYPE; v_first_cfg public.reward_actions_config%ROWTYPE;
  v_approved_count integer; v_reward_count integer; v_reward jsonb; v_first_reward jsonb;
  v_tracking_content uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_item_type NOT IN ('content','course') THEN RAISE EXCEPTION 'invalid_item_type'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_item_type='content' THEN
    SELECT creator_id,title,content_type,status INTO v_creator,v_title,v_content_type,v_old_status
    FROM public.contents WHERE id=p_item_id FOR UPDATE;
    v_tracking_content:=p_item_id;
  ELSE
    SELECT creator_id,title,NULL::text,status INTO v_creator,v_title,v_content_type,v_old_status
    FROM public.courses WHERE id=p_item_id FOR UPDATE;
    v_tracking_content:=NULL;
  END IF;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  SELECT creator_status INTO v_creator_status FROM public.profiles WHERE id=v_creator;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_creator AND role='creator') INTO v_has_role;
  IF v_creator_status<>'approved' OR NOT v_has_role THEN RAISE EXCEPTION 'approved_creator_required'; END IF;

  IF v_old_status='approved' THEN
    RETURN jsonb_build_object('success',true,'idempotent',true,'creator_id',v_creator,
      'title',v_title,'content_type',v_content_type,'points',0,'first_upload_points',0);
  END IF;
  IF p_item_type='content' THEN
    UPDATE public.contents SET status='approved',published_at=now() WHERE id=p_item_id;
  ELSE
    UPDATE public.courses SET status='approved',published_at=now() WHERE id=p_item_id;
  END IF;

  PERFORM set_config('classfy.authorized_reward_operation','on',true);
  SELECT public.get_or_create_current_cycle() INTO v_cycle;
  SELECT * INTO v_cfg FROM public.reward_actions_config WHERE action_key='CONTENT_APPROVED' AND active;
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      v_creator::text || ':CONTENT_APPROVED:' ||
      to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'), 0));
    SELECT count(*) INTO v_reward_count FROM public.reward_events
    WHERE user_id=v_creator AND action_key='CONTENT_APPROVED' AND point_type='creator'
      AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM')=
        to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM');
    IF v_cfg.monthly_creator_limit IS NULL OR v_reward_count<v_cfg.monthly_creator_limit THEN
      SELECT public.commit_reward_award(v_creator,'CONTENT_APPROVED_'||p_item_type||'_'||p_item_id::text,
        v_tracking_content,jsonb_build_object('source','admin_approval','item_type',p_item_type),v_cycle,
        jsonb_build_object('user_id',v_creator,'content_id',v_tracking_content,
          'action_key','CONTENT_APPROVED','points',v_cfg.points_creator,
          'cycle_points',v_cfg.points_creator,'point_type','creator',
          'metadata',jsonb_build_object('activation',true,'item_type',p_item_type,
            'item_id',p_item_id,'title',v_title)),NULL) INTO v_reward;
    END IF;
  END IF;

  SELECT count(*) INTO v_approved_count FROM (
    SELECT id FROM public.contents WHERE creator_id=v_creator AND status='approved'
    UNION ALL SELECT id FROM public.courses WHERE creator_id=v_creator AND status='approved'
  ) approved_items;
  IF v_approved_count=1 THEN
    SELECT * INTO v_first_cfg FROM public.reward_actions_config WHERE action_key='FIRST_UPLOAD' AND active;
    IF FOUND THEN
      SELECT public.commit_reward_award(v_creator,'FIRST_UPLOAD',NULL,
        jsonb_build_object('source','first_approved_upload'),v_cycle,
        jsonb_build_object('user_id',v_creator,'action_key','FIRST_UPLOAD',
          'points',v_first_cfg.points_creator,'cycle_points',v_first_cfg.points_creator,
          'point_type','creator','metadata',jsonb_build_object('activation',true,
            'item_type',p_item_type,'item_id',p_item_id,'title',v_title)),NULL) INTO v_first_reward;
    END IF;
  END IF;
  INSERT INTO public.notifications(user_id,type,title,message,related_content_id)
  VALUES (v_creator,'admin',CASE WHEN p_item_type='course' THEN 'Curso aprovado!' ELSE 'Conteudo aprovado!' END,
    'Seu '||CASE WHEN p_item_type='course' THEN 'curso' ELSE 'conteudo' END||' "'||v_title||
    '" foi aprovado e publicado.',CASE WHEN p_item_type='content' THEN p_item_id ELSE NULL END);
  INSERT INTO public.economic_admin_audit(admin_id,action,entity_type,entity_id,reason,old_value,new_value)
  VALUES (auth.uid(),'approve',p_item_type,p_item_id::text,btrim(p_reason),
    jsonb_build_object('status',v_old_status),jsonb_build_object('status','approved','creator_id',v_creator,
      'content_reward',v_reward,'first_upload_reward',v_first_reward));
  RETURN jsonb_build_object('success',true,'idempotent',false,'creator_id',v_creator,
    'title',v_title,'content_type',v_content_type,
    'points',CASE WHEN COALESCE((v_reward->>'already_tracked')::boolean,false) THEN 0 ELSE COALESCE(v_cfg.points_creator,0) END,
    'first_upload_points',CASE WHEN COALESCE((v_first_reward->>'already_tracked')::boolean,false) THEN 0 ELSE COALESCE(v_first_cfg.points_creator,0) END,
    'monthly_limit_reached',v_cfg.monthly_creator_limit IS NOT NULL AND v_reward_count>=v_cfg.monthly_creator_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_content_v1(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_v1(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_content_v1(
  p_item_id uuid, p_item_type text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_creator uuid; v_title text; v_old_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_item_type NOT IN ('content','course') THEN RAISE EXCEPTION 'invalid_item_type'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_item_type = 'content' THEN
    SELECT creator_id,title,status INTO v_creator,v_title,v_old_status
    FROM public.contents WHERE id=p_item_id FOR UPDATE;
  ELSE
    SELECT creator_id,title,status INTO v_creator,v_title,v_old_status
    FROM public.courses WHERE id=p_item_id FOR UPDATE;
  END IF;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF v_old_status = 'rejected' THEN
    RETURN jsonb_build_object('success',true,'idempotent',true,'creator_id',v_creator,'title',v_title);
  END IF;
  IF p_item_type = 'content' THEN
    UPDATE public.contents SET status='rejected',published_at=NULL WHERE id=p_item_id;
  ELSE
    UPDATE public.courses SET status='rejected',published_at=NULL WHERE id=p_item_id;
  END IF;
  INSERT INTO public.notifications(user_id,type,title,message,related_content_id)
  VALUES (v_creator,'admin',CASE WHEN p_item_type='course' THEN 'Curso reprovado' ELSE 'Conteudo reprovado' END,
    'Seu '||CASE WHEN p_item_type='course' THEN 'curso' ELSE 'conteudo' END||' "'||v_title||
    '" nao foi aprovado. Motivo: '||btrim(p_reason),
    CASE WHEN p_item_type='content' THEN p_item_id ELSE NULL END);
  INSERT INTO public.economic_admin_audit(admin_id,action,entity_type,entity_id,reason,old_value,new_value)
  VALUES (auth.uid(),'reject',p_item_type,p_item_id::text,btrim(p_reason),
    jsonb_build_object('status',v_old_status),jsonb_build_object('status','rejected','creator_id',v_creator));
  RETURN jsonb_build_object('success',true,'idempotent',false,'creator_id',v_creator,'title',v_title);
END;
$$;
REVOKE ALL ON FUNCTION public.reject_content_v1(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_content_v1(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_creator_request_v1(
  p_request_id uuid, p_approved boolean, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.creator_requests%ROWTYPE; v_old_profile public.profiles%ROWTYPE;
  v_status public.creator_status := CASE WHEN p_approved THEN 'approved'::public.creator_status ELSE 'rejected'::public.creator_status END;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_request FROM public.creator_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN RAISE EXCEPTION 'creator_request_already_processed'; END IF;
  SELECT * INTO v_old_profile FROM public.profiles WHERE id = v_request.user_id FOR UPDATE;
  PERFORM set_config('classfy.authorized_profile_operation', 'on', true);
  PERFORM set_config('classfy.authorized_reward_operation', 'on', true);
  UPDATE public.creator_requests SET status = v_status, reviewed_at = now(), reviewed_by = auth.uid(),
    admin_notes = btrim(p_reason) WHERE id = v_request.id;
  UPDATE public.profiles SET creator_status = v_status,
    creator_channel_name = CASE WHEN p_approved THEN v_request.channel_name ELSE creator_channel_name END,
    creator_bio = CASE WHEN p_approved THEN v_request.bio ELSE creator_bio END,
    updated_at = now() WHERE id = v_request.user_id;
  IF p_approved THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (v_request.user_id, 'creator')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = v_request.user_id AND role = 'creator';
  END IF;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), CASE WHEN p_approved THEN 'approve' ELSE 'reject' END,
    'creator_request', v_request.id::text, btrim(p_reason),
    jsonb_build_object('request', to_jsonb(v_request), 'profile', to_jsonb(v_old_profile)),
    jsonb_build_object('status', v_status, 'user_id', v_request.user_id));
  INSERT INTO public.notifications(user_id, type, title, message)
  VALUES (v_request.user_id, CASE WHEN p_approved THEN 'creator_approved' ELSE 'admin' END,
    CASE WHEN p_approved THEN 'Voce agora e Creator!' ELSE 'Solicitacao de Creator revisada' END,
    CASE WHEN p_approved THEN 'Sua solicitacao foi aprovada. Voce ja pode publicar conteudos.'
      ELSE 'Sua solicitacao de Creator nao foi aprovada nesta revisao.' END);
  RETURN jsonb_build_object('success', true, 'status', v_status, 'user_id', v_request.user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.review_creator_request_v1(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_creator_request_v1(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_user_access_v1(
  p_user_id uuid, p_role public.app_role, p_plan public.plan_type,
  p_plan_expires_at timestamptz, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_profile public.profiles%ROWTYPE; v_old_roles jsonb; v_admins integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_role IS NULL AND p_plan IS NULL THEN RAISE EXCEPTION 'no_access_change_requested'; END IF;
  IF p_plan IS NOT NULL AND p_plan <> 'free' AND (p_plan_expires_at IS NULL OR p_plan_expires_at <= now())
    THEN RAISE EXCEPTION 'paid_plan_requires_future_expiry'; END IF;
  SELECT * INTO v_old_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  SELECT COALESCE(jsonb_agg(role ORDER BY role), '[]'::jsonb) INTO v_old_roles
  FROM public.user_roles WHERE user_id = p_user_id;
  IF p_role IS NOT NULL AND public.has_role(p_user_id, 'admin'::public.app_role) AND p_role <> 'admin' THEN
    SELECT count(DISTINCT user_id) INTO v_admins FROM public.user_roles WHERE role = 'admin';
    IF v_admins <= 1 THEN RAISE EXCEPTION 'cannot_remove_last_admin'; END IF;
  END IF;
  PERFORM set_config('classfy.authorized_profile_operation', 'on', true);
  PERFORM set_config('classfy.authorized_reward_operation', 'on', true);
  UPDATE public.profiles SET
    plan = COALESCE(p_plan, plan),
    plan_expires_at = CASE WHEN p_plan IS NULL THEN plan_expires_at
      WHEN p_plan = 'free' THEN NULL ELSE p_plan_expires_at END,
    subscription_status = CASE WHEN p_plan IS NULL THEN subscription_status
      WHEN p_plan = 'free' THEN 'free' ELSE 'active' END,
    subscription_plan = CASE WHEN p_plan IS NULL THEN subscription_plan
      WHEN p_plan = 'free' THEN NULL ELSE p_plan END,
    subscription_grace_until = CASE WHEN p_plan IS NULL THEN subscription_grace_until ELSE NULL END,
    pending_plan = CASE WHEN p_plan IS NULL THEN pending_plan ELSE NULL END,
    pending_plan_effective_at = CASE WHEN p_plan IS NULL THEN pending_plan_effective_at ELSE NULL END,
    entitlement_source = CASE WHEN p_plan IS NULL THEN entitlement_source
      WHEN p_plan = 'free' THEN 'free' ELSE 'admin' END,
    subscription_state_event_at = CASE WHEN p_plan IS NULL THEN subscription_state_event_at ELSE now() END,
    creator_status = CASE
      WHEN p_role = 'creator' THEN 'approved'::public.creator_status
      WHEN p_role = 'user' AND creator_status = 'approved' THEN 'rejected'::public.creator_status
      ELSE creator_status END,
    updated_at = now() WHERE id = p_user_id;
  IF p_role IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    INSERT INTO public.user_roles(user_id, role) VALUES (p_user_id, p_role);
  END IF;
  IF p_role IS NOT NULL AND p_role <> 'user' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (p_user_id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'update_access', 'user', p_user_id::text, btrim(p_reason),
    jsonb_build_object('profile', to_jsonb(v_old_profile), 'roles', v_old_roles),
    jsonb_build_object('role', p_role, 'plan', p_plan, 'plan_expires_at', p_plan_expires_at));
  RETURN jsonb_build_object('success', true, 'user_id', p_user_id,
    'role', COALESCE(p_role::text, (v_old_roles->>0)),
    'plan', COALESCE(p_plan, v_old_profile.plan),
    'plan_expires_at', CASE WHEN p_plan IS NULL THEN v_old_profile.plan_expires_at
      WHEN p_plan = 'free' THEN NULL ELSE p_plan_expires_at END);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_user_access_v1(uuid, public.app_role, public.plan_type, timestamptz, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access_v1(uuid, public.app_role, public.plan_type, timestamptz, text)
TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_wallet_v1(p_user_id uuid, p_amount numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet public.wallets%ROWTYPE; v_key text; v_tx uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_amount = 0 OR abs(p_amount) > 100000 THEN RAISE EXCEPTION 'invalid_adjustment_amount'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  v_key := 'admin_adjustment_' || gen_random_uuid()::text;
  INSERT INTO public.wallets(user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets SET balance = balance + round(p_amount, 2),
    total_earned = CASE WHEN p_amount > 0 THEN total_earned + round(p_amount, 2) ELSE total_earned END,
    updated_at = now() WHERE user_id = p_user_id RETURNING * INTO v_wallet;
  INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, idempotency_key,
    status, admin_id, metadata)
  VALUES (v_wallet.id, 'admin_adjustment', round(p_amount, 2), btrim(p_reason), v_key,
    'posted', auth.uid(), jsonb_build_object('reason', btrim(p_reason))) RETURNING id INTO v_tx;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'wallet_adjustment', 'wallet', p_user_id::text, btrim(p_reason), NULL,
    jsonb_build_object('amount', round(p_amount, 2), 'idempotency_key', v_key));
  RETURN jsonb_build_object('success', true, 'transaction_id', v_tx,
    'new_balance', v_wallet.balance, 'amount', round(p_amount, 2));
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_wallet_v1(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_wallet_v1(uuid, numeric, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Checkpoints internos: historico ascendente, sem efeito economico
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.economic_growth_checkpoints (
  threshold integer PRIMARY KEY CHECK (threshold > 0),
  reached_at timestamptz,
  paid_users_at_reach integer,
  recorded_by uuid REFERENCES public.profiles(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.economic_growth_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view growth checkpoints" ON public.economic_growth_checkpoints
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
REVOKE INSERT, UPDATE, DELETE ON public.economic_growth_checkpoints FROM anon, authenticated;

INSERT INTO public.economic_growth_checkpoints(threshold)
VALUES (100), (500), (1000), (5000), (10000)
ON CONFLICT (threshold) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_growth_checkpoint_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paid integer; v_rows jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT count(*) INTO v_paid FROM public.profiles
  WHERE plan IN ('pro', 'premium') AND subscription_status IN ('active', 'trialing', 'past_due', 'canceled')
    AND (subscription_status NOT IN ('past_due', 'canceled')
      OR COALESCE(subscription_grace_until, plan_expires_at) > now());
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.threshold), '[]'::jsonb) INTO v_rows
  FROM public.economic_growth_checkpoints c;
  RETURN jsonb_build_object('paid_users', v_paid, 'checkpoints', v_rows, 'economic_effect', false);
END;
$$;
REVOKE ALL ON FUNCTION public.get_growth_checkpoint_status_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_growth_checkpoint_status_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_growth_checkpoint_v1(p_threshold integer, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paid integer; v_highest integer; v_row public.economic_growth_checkpoints%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT COALESCE(max(threshold) FILTER (WHERE reached_at IS NOT NULL), 0) INTO v_highest
  FROM public.economic_growth_checkpoints;
  IF p_threshold <= v_highest THEN RAISE EXCEPTION 'checkpoint_cannot_regress_or_repeat'; END IF;
  SELECT count(*) INTO v_paid FROM public.profiles
  WHERE plan IN ('pro', 'premium') AND subscription_status IN ('active', 'trialing', 'past_due', 'canceled')
    AND (subscription_status NOT IN ('past_due', 'canceled')
      OR COALESCE(subscription_grace_until, plan_expires_at) > now());
  IF v_paid < p_threshold THEN RAISE EXCEPTION 'checkpoint_not_reached'; END IF;
  UPDATE public.economic_growth_checkpoints SET reached_at = now(), paid_users_at_reach = v_paid,
    recorded_by = auth.uid(), reason = btrim(p_reason)
  WHERE threshold = p_threshold AND reached_at IS NULL RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkpoint_not_configured'; END IF;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'record', 'growth_checkpoint', p_threshold::text, btrim(p_reason), NULL, to_jsonb(v_row));
  RETURN to_jsonb(v_row) || jsonb_build_object('current_paid_users', v_paid, 'economic_effect', false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_growth_checkpoint_v1(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_growth_checkpoint_v1(integer, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Reconciliacao V1 sem multiplicacao de JOIN e ignorando ledger pendente
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_reconciliation_v1(p_period text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run_id uuid; v_status text := 'ok'; v_wallets_ok integer := 0;
  v_wallets_drift integer := 0; v_total_drift numeric := 0; v_wallet_issues jsonb := '[]'::jsonb;
  v_cycles_ok integer := 0; v_cycles_drift integer := 0; v_cycle_issues jsonb := '[]'::jsonb;
  v_result jsonb; r record;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    THEN RAISE EXCEPTION 'admin_required'; END IF;
  FOR r IN
    SELECT w.user_id, w.id wallet_id, w.balance stored,
      COALESCE((SELECT sum(wt.amount) FROM public.wallet_transactions wt
        WHERE wt.wallet_id = w.id AND wt.status = 'posted'), 0) from_ledger,
      w.pending_balance pending_stored,
      COALESCE((SELECT sum(wp.amount - wp.reversed_amount) FROM public.wallet_pending wp
        WHERE wp.wallet_id = w.id AND wp.status = 'pending' AND wp.matured_at IS NULL), 0) pending_from_table,
      w.total_earned earned_stored,
      COALESCE((SELECT sum(wt.amount) FROM public.wallet_transactions wt
        WHERE wt.wallet_id = w.id AND wt.status = 'posted' AND wt.amount > 0), 0) earned_from_ledger,
      w.reserved_balance reserved_stored,
      COALESCE((SELECT sum(wr.amount) FROM public.withdraw_requests wr
        WHERE wr.wallet_id = w.id AND wr.status = 'pending'), 0) reserved_from_requests
    FROM public.wallets w
  LOOP
    IF abs(r.stored-r.from_ledger) > 0.01 OR abs(r.pending_stored-r.pending_from_table) > 0.01
       OR abs(r.earned_stored-r.earned_from_ledger) > 0.01
       OR abs(r.reserved_stored-r.reserved_from_requests) > 0.01 THEN
      v_wallets_drift := v_wallets_drift + 1;
      v_total_drift := v_total_drift + abs(r.stored-r.from_ledger)
        + abs(r.pending_stored-r.pending_from_table) + abs(r.earned_stored-r.earned_from_ledger)
        + abs(r.reserved_stored-r.reserved_from_requests);
      v_wallet_issues := v_wallet_issues || jsonb_build_object('user_id', r.user_id,
        'wallet_id', r.wallet_id, 'balance_stored', r.stored, 'balance_ledger', r.from_ledger,
        'drift', r.stored-r.from_ledger, 'pending_drift', r.pending_stored-r.pending_from_table,
        'total_earned_drift', r.earned_stored-r.earned_from_ledger,
        'reserved_drift', r.reserved_stored-r.reserved_from_requests);
    ELSE v_wallets_ok := v_wallets_ok + 1; END IF;
  END LOOP;

  FOR r IN
    SELECT ec.id, ec.year_month, ec.distributed_amount stored,
      COALESCE((SELECT sum(wp.amount) FROM public.wallet_pending wp WHERE wp.cycle_id = ec.id), 0) accounted
    FROM public.economic_cycles ec WHERE ec.status = 'closed'
      AND (p_period IS NULL OR ec.year_month = p_period)
  LOOP
    IF abs(r.stored-r.accounted) > 0.01 THEN
      v_cycles_drift := v_cycles_drift + 1;
      v_cycle_issues := v_cycle_issues || jsonb_build_object('cycle_id', r.id,
        'year_month', r.year_month, 'distributed_stored', r.stored,
        'distributed_from_pending_records', r.accounted, 'drift', r.stored-r.accounted);
    ELSE v_cycles_ok := v_cycles_ok + 1; END IF;
  END LOOP;
  IF v_wallets_drift > 0 OR v_cycles_drift > 0 THEN
    v_status := CASE WHEN v_total_drift > 1 THEN 'error' ELSE 'warning' END;
  END IF;
  v_result := jsonb_build_object('status', v_status, 'period', p_period,
    'wallets_ok', v_wallets_ok, 'wallets_drift', v_wallets_drift,
    'total_drift', v_total_drift, 'cycles_ok', v_cycles_ok,
    'cycles_drift', v_cycles_drift, 'wallet_issues', v_wallet_issues,
    'cycle_issues', v_cycle_issues, 'run_at', now());
  INSERT INTO public.reconciliation_runs(period, wallets_ok, wallets_drift, total_drift,
    cycles_ok, cycles_drift, status, details)
  VALUES (p_period, v_wallets_ok, v_wallets_drift, v_total_drift,
    v_cycles_ok, v_cycles_drift, v_status, v_result) RETURNING id INTO v_run_id;
  RETURN v_result || jsonb_build_object('run_id', v_run_id);
END;
$$;
REVOKE ALL ON FUNCTION public.run_reconciliation_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_reconciliation_v1(text) TO authenticated, service_role;

-- A implementacao antiga permanece apenas para historico e cron legado, sem
-- acesso externo. O Admin usa exclusivamente run_reconciliation_v1.
REVOKE ALL ON FUNCTION public.run_reconciliation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_reconciliation(text) TO service_role;

-- Remove agendamentos dos motores antigos e mantem apenas as rotinas V1.
DO $$ BEGIN
  PERFORM cron.unschedule('classfy-evaluate-qualifications-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('classfy-reconciliation-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('classfy-reconciliation-daily', '0 6 * * *',
  $$ SELECT public.run_reconciliation_v1(NULL) $$);

-- Configuracao oficial deve ter ranges seguros.
CREATE OR REPLACE FUNCTION public.update_economic_v1_settings(p_value jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_merged jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT value INTO v_old FROM public.platform_settings WHERE key = 'economic_v1' FOR UPDATE;
  v_merged := (COALESCE(v_old, '{}'::jsonb) || COALESCE(p_value, '{}'::jsonb))
    - 'approved_content_monthly_limit';
  IF (v_merged->>'pool_percentage')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid_pool_percentage'; END IF;
  IF (v_merged->'user_points_multipliers'->>'free')::numeric <= 0
    OR (v_merged->'user_points_multipliers'->>'free')::numeric > 10
    OR (v_merged->'user_points_multipliers'->>'pro')::numeric <= 0
    OR (v_merged->'user_points_multipliers'->>'pro')::numeric > 10
    OR (v_merged->'user_points_multipliers'->>'premium')::numeric <= 0
    OR (v_merged->'user_points_multipliers'->>'premium')::numeric > 10
    THEN RAISE EXCEPTION 'invalid_points_multiplier'; END IF;
  IF (v_merged->'reward_maturation_days'->>'free')::int NOT BETWEEN 0 AND 365
    OR (v_merged->'reward_maturation_days'->>'pro')::int NOT BETWEEN 0 AND 365
    OR (v_merged->'reward_maturation_days'->>'premium')::int NOT BETWEEN 0 AND 365
    THEN RAISE EXCEPTION 'invalid_maturation_days'; END IF;
  IF (v_merged->>'minimum_withdrawal_amount')::numeric NOT BETWEEN 0.01 AND 100000
    THEN RAISE EXCEPTION 'invalid_minimum_withdrawal'; END IF;
  IF (v_merged->>'sales_commission_percent')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid_sales_commission'; END IF;
  IF (v_merged->>'creator_sales_hold_days')::int NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'invalid_creator_hold'; END IF;
  IF (v_merged->>'subscription_grace_period_days')::int NOT BETWEEN 0 AND 30 THEN RAISE EXCEPTION 'invalid_subscription_grace'; END IF;
  IF (v_merged->>'referral_commission_percent')::numeric NOT BETWEEN 0 AND 50 THEN RAISE EXCEPTION 'invalid_referral_commission'; END IF;
  UPDATE public.platform_settings SET value = v_merged, updated_at = now() WHERE key = 'economic_v1';
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'update', 'economic_settings', 'economic_v1', btrim(p_reason), v_old, v_merged);
  RETURN v_merged;
END;
$$;
REVOKE ALL ON FUNCTION public.update_economic_v1_settings(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_economic_v1_settings(jsonb, text) TO authenticated;

COMMENT ON COLUMN public.wallets.balance IS
  'Saldo contabil disponivel antes de reservas; pode ficar negativo por reversoes.';
COMMENT ON COLUMN public.wallets.pending_balance IS
  'Soma das obrigacoes ainda em maturacao em wallet_pending.';
COMMENT ON COLUMN public.wallets.reserved_balance IS
  'Parte do saldo reservada por solicitacoes de saque pendentes.';
COMMENT ON COLUMN public.wallets.total_earned IS
  'Soma historica de creditos positivos posted no ledger; saques e reversoes nao apagam o recebido historico.';
COMMENT ON COLUMN public.wallets.total_withdrawn IS
  'Soma historica de saques efetivamente marcados como pagos.';
