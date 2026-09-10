
-- ═══════════════════════════════════════════════════════
-- RPC: evaluate_pool_qualification
-- Avalia se um usuário está qualificado para o pool
-- com base nos 9 checkpoints configuráveis
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.evaluate_pool_qualification(
  p_user_id uuid,
  p_cycle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle           RECORD;
  v_cycle_start     date;
  v_cycle_end       date;
  v_settings        jsonb;
  v_checkpoints     jsonb;
  v_plan            text;
  v_plan_config     jsonb;
  v_threshold       numeric;
  v_total_qp        numeric := 0;
  v_details         jsonb   := '{}'::jsonb;
  v_qp              numeric;
  v_qualified       boolean;

  -- contadores
  v_share_count     int;
  v_ref_signup      int;
  v_ref_upgrade     int;
  v_active_days     int;
  v_completed       int;
  v_engagement      int;
  v_has_boost       boolean;
  v_has_sub         boolean;
  v_has_purchase    boolean;
BEGIN
  -- Dados do ciclo
  SELECT * INTO v_cycle FROM economic_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found: %', p_cycle_id; END IF;
  v_cycle_start := (v_cycle.year_month || '-01')::date;
  v_cycle_end   := (v_cycle_start + INTERVAL '1 month')::date;

  -- Configurações
  SELECT value INTO v_settings FROM platform_settings WHERE key = 'economic';
  v_checkpoints := v_settings->'checkpoints';

  -- Plano do usuário
  SELECT COALESCE(plan::text, 'free') INTO v_plan FROM profiles WHERE id = p_user_id;
  v_plan_config := v_settings->'plan_config'->v_plan;
  v_threshold   := COALESCE((v_plan_config->>'qualification_threshold')::numeric, 60);

  -- ── CHECKPOINT 1: share_content ─────────────────────
  SELECT COUNT(*) INTO v_share_count
  FROM reward_action_tracking
  WHERE user_id = p_user_id
    AND action_key LIKE 'SHARE_CONTENT%'
    AND created_at >= v_cycle_start::timestamptz
    AND created_at <  v_cycle_end::timestamptz;
  v_qp := LEAST(
    v_share_count * COALESCE((v_checkpoints->'share_content'->>'qp_per_action')::numeric, 3),
    COALESCE((v_checkpoints->'share_content'->>'max_qp')::numeric, 15)
  );
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('share_content',
    jsonb_build_object('count', v_share_count, 'qp', v_qp));

  -- ── CHECKPOINT 2: referral_signup ───────────────────
  SELECT COUNT(*) INTO v_ref_signup
  FROM referral_conversions
  WHERE referrer_id = p_user_id
    AND created_at >= v_cycle_start::timestamptz
    AND created_at <  v_cycle_end::timestamptz;
  v_qp := LEAST(
    v_ref_signup * COALESCE((v_checkpoints->'referral_signup'->>'qp_per_action')::numeric, 25),
    COALESCE((v_checkpoints->'referral_signup'->>'max_qp')::numeric, 75)
  );
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('referral_signup',
    jsonb_build_object('count', v_ref_signup, 'qp', v_qp));

  -- ── CHECKPOINT 3: referral_upgrade ──────────────────
  SELECT COUNT(*) INTO v_ref_upgrade
  FROM referral_commissions
  WHERE referrer_id = p_user_id
    AND created_at >= v_cycle_start::timestamptz
    AND created_at <  v_cycle_end::timestamptz;
  v_qp := LEAST(
    v_ref_upgrade * COALESCE((v_checkpoints->'referral_upgrade'->>'qp_per_action')::numeric, 50),
    COALESCE((v_checkpoints->'referral_upgrade'->>'max_qp')::numeric, 100)
  );
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('referral_upgrade',
    jsonb_build_object('count', v_ref_upgrade, 'qp', v_qp));

  -- ── CHECKPOINT 4: subscription_paid ─────────────────
  v_has_sub := v_plan IN ('pro', 'premium');
  v_qp := CASE WHEN v_has_sub
    THEN COALESCE((v_checkpoints->'subscription_paid'->>'qp')::numeric, 20)
    ELSE 0 END;
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('subscription_paid',
    jsonb_build_object('active', v_has_sub, 'qp', v_qp));

  -- ── CHECKPOINT 5: boost_purchased ───────────────────
  SELECT EXISTS(
    SELECT 1 FROM revenue_entries
    WHERE user_id = p_user_id AND revenue_type = 'boost'
      AND created_at >= v_cycle_start::timestamptz
      AND created_at <  v_cycle_end::timestamptz
  ) INTO v_has_boost;
  v_qp := CASE WHEN v_has_boost
    THEN COALESCE((v_checkpoints->'boost_purchased'->>'qp')::numeric, 30)
    ELSE 0 END;
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('boost_purchased',
    jsonb_build_object('active', v_has_boost, 'qp', v_qp));

  -- ── CHECKPOINT 6: content_purchased ─────────────────
  SELECT EXISTS(
    SELECT 1 FROM revenue_entries
    WHERE user_id = p_user_id AND revenue_type = 'content_purchase'
      AND created_at >= v_cycle_start::timestamptz
      AND created_at <  v_cycle_end::timestamptz
  ) INTO v_has_purchase;
  v_qp := CASE WHEN v_has_purchase
    THEN COALESCE((v_checkpoints->'content_purchased'->>'qp')::numeric, 15)
    ELSE 0 END;
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('content_purchased',
    jsonb_build_object('active', v_has_purchase, 'qp', v_qp));

  -- ── CHECKPOINT 7: active_days ───────────────────────
  SELECT get_user_active_days(p_user_id, v_cycle_start) INTO v_active_days;
  v_qp := CASE
    WHEN v_active_days >= COALESCE((v_checkpoints->'active_days'->>'required_days')::int, 15)
    THEN COALESCE((v_checkpoints->'active_days'->>'qp')::numeric, 15)
    ELSE 0 END;
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('active_days',
    jsonb_build_object('count', v_active_days,
      'required', COALESCE((v_checkpoints->'active_days'->>'required_days')::int, 15), 'qp', v_qp));

  -- ── CHECKPOINT 8: content_completed ─────────────────
  SELECT COUNT(*) INTO v_completed
  FROM reward_action_tracking
  WHERE user_id = p_user_id
    AND action_key LIKE 'WATCH_100%'
    AND created_at >= v_cycle_start::timestamptz
    AND created_at <  v_cycle_end::timestamptz;
  v_qp := CASE
    WHEN v_completed >= COALESCE((v_checkpoints->'content_completed'->>'required_count')::int, 5)
    THEN COALESCE((v_checkpoints->'content_completed'->>'qp')::numeric, 10)
    ELSE 0 END;
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('content_completed',
    jsonb_build_object('count', v_completed,
      'required', COALESCE((v_checkpoints->'content_completed'->>'required_count')::int, 5), 'qp', v_qp));

  -- ── CHECKPOINT 9: engagement ────────────────────────
  SELECT COUNT(*) INTO v_engagement
  FROM reward_action_tracking
  WHERE user_id = p_user_id
    AND (action_key LIKE 'LIKE_CONTENT%' OR action_key LIKE 'SAVE_CONTENT%'
      OR action_key LIKE 'COMMENT_CONTENT%' OR action_key LIKE 'FAVORITE_CONTENT%')
    AND created_at >= v_cycle_start::timestamptz
    AND created_at <  v_cycle_end::timestamptz;
  v_qp := CASE
    WHEN v_engagement >= COALESCE((v_checkpoints->'engagement'->>'required_count')::int, 20)
    THEN COALESCE((v_checkpoints->'engagement'->>'qp')::numeric, 10)
    ELSE 0 END;
  v_total_qp := v_total_qp + v_qp;
  v_details  := v_details || jsonb_build_object('engagement',
    jsonb_build_object('count', v_engagement,
      'required', COALESCE((v_checkpoints->'engagement'->>'required_count')::int, 20), 'qp', v_qp));

  -- ── RESULTADO ───────────────────────────────────────
  v_qualified := v_total_qp >= v_threshold;
  v_details   := v_details || jsonb_build_object('threshold', v_threshold, 'plan', v_plan);

  -- Gravar em economic_cycle_users
  INSERT INTO economic_cycle_users (cycle_id, user_id, performance_points,
    qualified_for_pool, qualification_points, qualification_details, qualification_evaluated_at)
  VALUES (p_cycle_id, p_user_id, 0,
    v_qualified, v_total_qp, v_details, NOW())
  ON CONFLICT (cycle_id, user_id) DO UPDATE SET
    qualified_for_pool         = EXCLUDED.qualified_for_pool,
    qualification_points       = EXCLUDED.qualification_points,
    qualification_details      = EXCLUDED.qualification_details,
    qualification_evaluated_at = EXCLUDED.qualification_evaluated_at;

  RETURN jsonb_build_object(
    'qualified',            v_qualified,
    'qualification_points', v_total_qp,
    'threshold',            v_threshold,
    'plan',                 v_plan,
    'details',              v_details
  );
END;
$$;

-- Batch: avalia todos os usuários de um ciclo de uma vez
CREATE OR REPLACE FUNCTION public.batch_evaluate_qualifications(p_cycle_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  FOR r IN SELECT user_id FROM economic_cycle_users WHERE cycle_id = p_cycle_id LOOP
    PERFORM evaluate_pool_qualification(r.user_id, p_cycle_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_pool_qualification FROM PUBLIC;
REVOKE ALL ON FUNCTION public.batch_evaluate_qualifications FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_pool_qualification TO service_role;
GRANT EXECUTE ON FUNCTION public.batch_evaluate_qualifications TO service_role;
-- Usuário autenticado pode ver a própria qualificação
GRANT EXECUTE ON FUNCTION public.evaluate_pool_qualification TO authenticated;
;
