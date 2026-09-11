-- =============================================================================
-- ECONOMIA CLASSFY V1
-- Fonte unica de configuracao, Points, receita elegivel, carteira e auditoria.
-- Estruturas antigas sao preservadas para leitura historica e marcadas deprecated.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuracao economica oficial
-- -----------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'economic_v1',
  jsonb_build_object(
    'version', 1,
    'pool_percentage', 40,
    'user_points_multipliers', jsonb_build_object('free', 1, 'pro', 1.5, 'premium', 2),
    'reward_maturation_days', jsonb_build_object('free', 30, 'pro', 7, 'premium', 2),
    'minimum_withdrawal_amount', 10,
    'sales_commission_percent', 20,
    'creator_sales_hold_days', 7,
    'subscription_grace_period_days', 3,
    'referral_commission_percent', 10,
    'approved_content_monthly_limit', NULL,
    'growth_checkpoints', jsonb_build_array(100, 500, 1000, 5000, 10000)
  ),
  'Fonte unica da Economia Classfy V1'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();

UPDATE public.platform_settings
SET description = 'DEPRECATED: configuracao economica anterior a economic_v1',
    value = value || jsonb_build_object('deprecated', true),
    updated_at = now()
WHERE key = 'economic';

DELETE FROM public.system_config
WHERE config_key IN (
  'min_withdrawal_amount',
  'minimum_withdrawal_amount',
  'earnings_maturation_days',
  'direct_sale_platform_commission_rate',
  'referral_commission_rate'
);

COMMENT ON TABLE public.system_config IS
  'Configuracoes nao economicas. Parametros financeiros oficiais ficam em platform_settings/economic_v1.';

-- -----------------------------------------------------------------------------
-- 2. Uma tabela oficial de acoes e Points
-- -----------------------------------------------------------------------------
ALTER TABLE public.reward_actions_config
  ADD COLUMN IF NOT EXISTS canonical_name text,
  ADD COLUMN IF NOT EXISTS dedupe_scope text NOT NULL DEFAULT 'user_content',
  ADD COLUMN IF NOT EXISTS daily_limit integer,
  ADD COLUMN IF NOT EXISTS monthly_creator_limit integer,
  ADD COLUMN IF NOT EXISTS requires_evidence boolean NOT NULL DEFAULT true;

ALTER TABLE public.reward_actions_config
  DROP CONSTRAINT IF EXISTS reward_actions_config_dedupe_scope_check;
ALTER TABLE public.reward_actions_config
  ADD CONSTRAINT reward_actions_config_dedupe_scope_check CHECK (
    dedupe_scope IN ('daily', 'weekly', 'user_content', 'user_creator', 'lifetime', 'creator_content')
  );
ALTER TABLE public.reward_actions_config
  DROP CONSTRAINT IF EXISTS reward_actions_config_daily_limit_check;
ALTER TABLE public.reward_actions_config
  ADD CONSTRAINT reward_actions_config_daily_limit_check CHECK (daily_limit IS NULL OR daily_limit > 0);
ALTER TABLE public.reward_actions_config
  DROP CONSTRAINT IF EXISTS reward_actions_config_monthly_limit_check;
ALTER TABLE public.reward_actions_config
  ADD CONSTRAINT reward_actions_config_monthly_limit_check CHECK (monthly_creator_limit IS NULL OR monthly_creator_limit > 0);

INSERT INTO public.reward_actions_config (
  action_key, canonical_name, description, points_user, points_creator,
  value_user, value_creator, dedupe_scope, daily_limit, monthly_creator_limit,
  requires_evidence, active
)
VALUES
  ('DAILY_LOGIN', 'LOGIN_DIARIO', 'Login diario', 2, 0, 0, 0, 'daily', 1, NULL, true, true),
  ('WEEKLY_STREAK', 'SEQUENCIA_7_DIAS', 'Sequencia de sete dias', 10, 0, 0, 0, 'weekly', NULL, NULL, true, true),
  ('FIRST_CONTENT_WEEK', 'PRIMEIRO_CONTEUDO_SEMANA', 'Primeiro conteudo da semana', 4, 0, 0, 0, 'weekly', NULL, NULL, true, true),
  ('VIEW_15S', 'ASSISTIR_15S', 'Assistir quinze segundos', 2, 1, 0, 0, 'user_content', 50, NULL, true, true),
  ('WATCH_50', 'ASSISTIR_50_PERCENT', 'Assistir cinquenta por cento', 6, 3, 0, 0, 'user_content', 30, NULL, true, true),
  ('WATCH_100', 'ASSISTIR_100_PERCENT', 'Assistir cem por cento', 10, 5, 0, 0, 'user_content', 20, NULL, true, true),
  ('LIKE', 'CURTIR', 'Curtir conteudo', 2, 1, 0, 0, 'user_content', 30, NULL, true, true),
  ('SAVE', 'SALVAR', 'Salvar conteudo', 4, 2, 0, 0, 'user_content', 20, NULL, true, true),
  ('FAVORITE', 'FAVORITAR', 'Favoritar conteudo', 4, 2, 0, 0, 'user_content', 20, NULL, true, true),
  ('COMMENT', 'COMENTAR', 'Comentar em conteudo', 6, 3, 0, 0, 'user_content', 15, NULL, true, true),
  ('SHARE', 'COMPARTILHAR', 'Compartilhar conteudo', 4, 2, 0, 0, 'user_content', 15, NULL, true, true),
  ('SUBSCRIBE_CREATOR', 'SEGUIR_CREATOR', 'Seguir Creator', 6, 3, 0, 0, 'user_creator', 10, NULL, true, true),
  ('COMPLETE_COURSE', 'CONCLUIR_CURSO', 'Concluir curso', 20, 10, 0, 0, 'user_content', NULL, NULL, true, true),
  ('PROFILE_COMPLETE', 'COMPLETAR_PERFIL', 'Completar perfil', 10, 0, 0, 0, 'lifetime', NULL, NULL, true, true),
  ('CREATOR_APPROVED', 'CREATOR_APROVADO', 'Aprovacao como Creator', 0, 20, 0, 0, 'lifetime', NULL, NULL, true, true),
  ('FIRST_UPLOAD', 'PRIMEIRO_UPLOAD', 'Primeiro upload aprovado', 0, 10, 0, 0, 'lifetime', NULL, NULL, true, true),
  ('CONTENT_APPROVED', 'CONTEUDO_APROVADO_PUBLICADO', 'Conteudo aprovado e publicado', 0, 4, 0, 0, 'creator_content', NULL, NULL, true, true)
ON CONFLICT (action_key) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  description = EXCLUDED.description,
  points_user = EXCLUDED.points_user,
  points_creator = EXCLUDED.points_creator,
  value_user = 0,
  value_creator = 0,
  dedupe_scope = EXCLUDED.dedupe_scope,
  daily_limit = EXCLUDED.daily_limit,
  monthly_creator_limit = EXCLUDED.monthly_creator_limit,
  requires_evidence = EXCLUDED.requires_evidence,
  active = true,
  updated_at = now();

UPDATE public.reward_actions_config
SET active = false,
    value_user = 0,
    value_creator = 0,
    description = COALESCE(description, '') || ' [DEPRECATED na Economia V1]',
    updated_at = now()
WHERE action_key NOT IN (
  'DAILY_LOGIN', 'WEEKLY_STREAK', 'FIRST_CONTENT_WEEK',
  'VIEW_15S', 'WATCH_50', 'WATCH_100',
  'LIKE', 'SAVE', 'FAVORITE', 'COMMENT', 'SHARE',
  'SUBSCRIBE_CREATOR', 'COMPLETE_COURSE', 'PROFILE_COMPLETE',
  'CREATOR_APPROVED', 'FIRST_UPLOAD', 'CONTENT_APPROVED'
);

COMMENT ON COLUMN public.reward_actions_config.value_user IS 'DEPRECATED: Points nao possuem valor fixo em reais.';
COMMENT ON COLUMN public.reward_actions_config.value_creator IS 'DEPRECATED: Points nao possuem valor fixo em reais.';

-- -----------------------------------------------------------------------------
-- 3. Origem dos Points e acumuladores do ciclo
-- -----------------------------------------------------------------------------
ALTER TABLE public.reward_events
  ADD COLUMN IF NOT EXISTS point_type text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS cycle_points numeric NOT NULL DEFAULT 0;

UPDATE public.reward_events
SET point_type = CASE
      WHEN COALESCE(metadata->>'as_creator', 'false') = 'true'
        OR action_key IN ('CREATOR_APPROVED', 'FIRST_UPLOAD', 'CONTENT_APPROVED', 'CREATOR_MILESTONE_CLAIM')
        OR action_key LIKE 'MILESTONE_%_VIEWS'
      THEN 'creator'
      ELSE 'user'
    END,
    cycle_points = COALESCE(performance_points, points, 0);

ALTER TABLE public.reward_events DROP CONSTRAINT IF EXISTS reward_events_point_type_check;
ALTER TABLE public.reward_events
  ADD CONSTRAINT reward_events_point_type_check CHECK (point_type IN ('user', 'creator'));
ALTER TABLE public.reward_events DROP CONSTRAINT IF EXISTS reward_events_cycle_points_nonneg;
ALTER TABLE public.reward_events
  ADD CONSTRAINT reward_events_cycle_points_nonneg CHECK (cycle_points >= 0);

COMMENT ON COLUMN public.reward_events.points IS 'Points historicos definitivos do evento.';
COMMENT ON COLUMN public.reward_events.cycle_points IS 'Points economicos do ciclo do evento.';
COMMENT ON COLUMN public.reward_events.performance_points IS 'DEPRECATED: espelho temporario de cycle_points para compatibilidade.';
COMMENT ON COLUMN public.reward_events.value IS 'DEPRECATED: Point nao possui cambio fixo.';

ALTER TABLE public.economic_cycle_users
  ADD COLUMN IF NOT EXISTS user_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS creator_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cycle_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_at_close public.plan_type,
  ADD COLUMN IF NOT EXISTS maturation_days integer,
  ADD COLUMN IF NOT EXISTS points_liquidated_at timestamptz;

WITH event_totals AS (
  SELECT cycle_id, user_id,
    COALESCE(sum(cycle_points) FILTER (WHERE point_type = 'user'), 0) AS user_points,
    COALESCE(sum(cycle_points) FILTER (WHERE point_type = 'creator'), 0) AS creator_points
  FROM public.reward_events
  WHERE cycle_id IS NOT NULL
  GROUP BY cycle_id, user_id
)
UPDATE public.economic_cycle_users ecu
SET user_points = et.user_points,
    creator_points = et.creator_points,
    cycle_points = et.user_points + et.creator_points,
    performance_points = CASE WHEN ec.status = 'open'
      THEN et.user_points + et.creator_points ELSE ecu.performance_points END,
    qualified_for_pool = CASE WHEN ec.status = 'open' THEN true ELSE ecu.qualified_for_pool END,
    qualification_points = CASE WHEN ec.status = 'open' THEN 0 ELSE ecu.qualification_points END,
    qualification_details = CASE WHEN ec.status = 'open' THEN '{}'::jsonb ELSE ecu.qualification_details END
FROM event_totals et, public.economic_cycles ec
WHERE ecu.cycle_id = et.cycle_id
  AND ecu.user_id = et.user_id
  AND ec.id = ecu.cycle_id;

UPDATE public.economic_cycle_users ecu
SET cycle_points = performance_points
WHERE cycle_points = 0
  AND performance_points > 0
  AND EXISTS (SELECT 1 FROM public.economic_cycles ec WHERE ec.id = ecu.cycle_id AND ec.status <> 'open');

COMMENT ON COLUMN public.economic_cycle_users.performance_points IS 'DEPRECATED: espelho temporario de cycle_points.';
COMMENT ON COLUMN public.economic_cycle_users.qualification_points IS 'DEPRECATED: QP nao participa da Economia V1.';
COMMENT ON COLUMN public.economic_cycle_users.qualified_for_pool IS 'DEPRECATED: todos os Points validos participam do fechamento V1.';

ALTER TABLE public.economic_cycles
  ADD COLUMN IF NOT EXISTS gross_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligible_net_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_user_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_creator_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS economy_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.economic_cycles.rbm IS 'DEPRECATED na UI: espelho da receita liquida elegivel.';
COMMENT ON COLUMN public.economic_cycles.prm IS 'DEPRECATED na UI: espelho do pool confirmado.';

-- -----------------------------------------------------------------------------
-- 4. Receita explicitamente elegivel e split congelado de vendas
-- -----------------------------------------------------------------------------
ALTER TABLE public.revenue_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS is_pool_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chargeback_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS affiliate_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS creator_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classfy_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_eligible_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

UPDATE public.revenue_entries
SET gross_amount = CASE WHEN gross_amount = 0 THEN amount ELSE gross_amount END,
    classfy_amount = CASE WHEN classfy_amount = 0 THEN amount ELSE classfy_amount END,
    is_pool_eligible = CASE
      WHEN revenue_type IN ('subscription_pro', 'subscription_premium', 'content_purchase', 'boost') THEN true
      WHEN revenue_type = 'other' AND COALESCE((metadata->>'pool_eligible')::boolean, false) THEN true
      ELSE false
    END,
    net_eligible_amount = CASE
      WHEN revenue_type IN ('subscription_pro', 'subscription_premium', 'content_purchase', 'boost') THEN GREATEST(amount, 0)
      WHEN revenue_type = 'other' AND COALESCE((metadata->>'pool_eligible')::boolean, false) THEN GREATEST(amount, 0)
      ELSE 0
    END,
    confirmed_at = COALESCE(confirmed_at, created_at);

ALTER TABLE public.revenue_entries DROP CONSTRAINT IF EXISTS revenue_entries_status_check;
ALTER TABLE public.revenue_entries ADD CONSTRAINT revenue_entries_status_check
  CHECK (status IN ('pending', 'confirmed', 'refunded', 'chargeback', 'void'));
ALTER TABLE public.revenue_entries DROP CONSTRAINT IF EXISTS revenue_entries_amounts_nonneg;
ALTER TABLE public.revenue_entries ADD CONSTRAINT revenue_entries_amounts_nonneg CHECK (
  gross_amount >= 0 AND payment_fee_amount >= 0 AND tax_amount >= 0
  AND refund_amount >= 0 AND chargeback_amount >= 0 AND affiliate_amount >= 0
  AND creator_amount >= 0 AND classfy_amount >= 0 AND net_eligible_amount >= 0
);

ALTER TABLE public.purchased_contents
  ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS classfy_percent numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS creator_percent numeric NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS classfy_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS creator_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chargeback_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'legacy_confirmed',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

UPDATE public.purchased_contents pc
SET creator_id = c.creator_id,
    gross_amount = CASE WHEN pc.gross_amount = 0 THEN pc.price_paid ELSE pc.gross_amount END,
    classfy_amount = CASE WHEN pc.classfy_amount = 0 THEN round(pc.price_paid * 0.20, 2) ELSE pc.classfy_amount END,
    creator_amount = CASE WHEN pc.creator_amount = 0 THEN round(pc.price_paid * 0.80, 2) ELSE pc.creator_amount END,
    processed_at = COALESCE(pc.processed_at, pc.purchased_at)
FROM public.contents c
WHERE c.id = pc.content_id;

CREATE UNIQUE INDEX IF NOT EXISTS purchased_contents_payment_intent_unique
  ON public.purchased_contents(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Estado oficial de assinatura. profiles.plan continua sendo o entitlement
-- efetivo consumido por todas as telas existentes.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan public.plan_type,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS pending_plan public.plan_type,
  ADD COLUMN IF NOT EXISTS pending_plan_effective_at timestamptz;
UPDATE public.profiles
SET subscription_status = CASE WHEN plan IN ('pro', 'premium') THEN 'active' ELSE 'free' END,
    subscription_plan = CASE WHEN plan IN ('pro', 'premium') THEN plan ELSE NULL END
WHERE subscription_status = 'free' AND subscription_plan IS NULL;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_status_check CHECK (
  subscription_status IN ('free', 'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'expired', 'paused')
);

-- -----------------------------------------------------------------------------
-- 5. Ledger: pendente, disponivel, reversoes e reserva de saque
-- -----------------------------------------------------------------------------
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_balance_nonneg;
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS reserved_balance numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_reserved_nonneg;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_reserved_nonneg CHECK (reserved_balance >= 0);

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.purchased_contents(id),
  ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_status_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_status_check
  CHECK (status IN ('pending', 'posted', 'reversed'));

ALTER TABLE public.wallet_pending
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.purchased_contents(id),
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.wallet_transactions(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reversed_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE public.wallet_pending
SET status = CASE WHEN matured_at IS NULL THEN 'pending' ELSE 'matured' END;
ALTER TABLE public.wallet_pending DROP CONSTRAINT IF EXISTS wallet_pending_status_check;
ALTER TABLE public.wallet_pending ADD CONSTRAINT wallet_pending_status_check
  CHECK (status IN ('pending', 'matured', 'reversed'));
ALTER TABLE public.wallet_pending DROP CONSTRAINT IF EXISTS wallet_pending_reversed_check;
ALTER TABLE public.wallet_pending ADD CONSTRAINT wallet_pending_reversed_check
  CHECK (reversed_amount >= 0 AND reversed_amount <= amount);

CREATE OR REPLACE VIEW public.v_wallet_ledger AS
SELECT w.user_id,
  w.id AS wallet_id,
  w.balance AS balance_stored,
  COALESCE(sum(wt.amount) FILTER (WHERE wt.status = 'posted'), 0) AS balance_from_ledger,
  w.balance - COALESCE(sum(wt.amount) FILTER (WHERE wt.status = 'posted'), 0) AS drift,
  count(wt.id) FILTER (WHERE wt.status = 'posted') AS tx_count,
  count(wt.id) FILTER (WHERE wt.status = 'posted' AND wt.direction = 'credit') AS credit_count,
  count(wt.id) FILTER (WHERE wt.status = 'posted' AND wt.direction = 'debit') AS debit_count,
  sum(wt.amount) FILTER (WHERE wt.status = 'posted' AND wt.direction = 'credit') AS total_credited,
  sum(abs(wt.amount)) FILTER (WHERE wt.status = 'posted' AND wt.direction = 'debit') AS total_debited,
  max(wt.created_at) FILTER (WHERE wt.status = 'posted') AS last_tx_at
FROM public.wallets w
LEFT JOIN public.wallet_transactions wt ON wt.wallet_id = w.id
GROUP BY w.user_id, w.id, w.balance;

COMMENT ON VIEW public.v_wallet_ledger IS
  'Ledger V1: somente transacoes posted compoem o saldo disponivel.';

-- -----------------------------------------------------------------------------
-- 6. Auditoria administrativa
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.economic_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  reason text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.economic_admin_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view economic audit" ON public.economic_admin_audit;
CREATE POLICY "Admins can view economic audit"
ON public.economic_admin_audit FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
REVOKE INSERT, UPDATE, DELETE ON public.economic_admin_audit FROM anon, authenticated;
GRANT SELECT ON public.economic_admin_audit TO authenticated;

-- Configuracoes economicas so podem mudar pelas RPCs auditadas abaixo.
DROP POLICY IF EXISTS "Admins can manage platform settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Admins can manage config" ON public.reward_actions_config;
DROP POLICY IF EXISTS "Admins can manage system config" ON public.system_config;
REVOKE INSERT, UPDATE, DELETE ON public.platform_settings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reward_actions_config FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.system_config FROM authenticated;

-- -----------------------------------------------------------------------------
-- 7. Helpers e RPCs de configuracao
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_economic_v1_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value FROM public.platform_settings WHERE key = 'economic_v1'
$$;
REVOKE ALL ON FUNCTION public.get_economic_v1_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_economic_v1_settings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_subscription_state_v1(
  p_user_id uuid, p_status text, p_plan public.plan_type,
  p_period_end timestamptz, p_subscription_id text, p_customer_id text,
  p_pending_plan public.plan_type DEFAULT NULL, p_pending_effective_at timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_settings jsonb; v_grace_days integer;
  v_grace_until timestamptz; v_effective_plan public.plan_type;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_status NOT IN ('free', 'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'expired', 'paused')
    THEN RAISE EXCEPTION 'invalid_subscription_status'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
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
  UPDATE public.profiles SET plan = v_effective_plan,
    plan_expires_at = CASE WHEN v_effective_plan = 'free' THEN NULL ELSE p_period_end END,
    billing_id = COALESCE(p_customer_id, billing_id),
    stripe_subscription_id = p_subscription_id,
    subscription_status = p_status,
    subscription_plan = CASE WHEN p_plan IN ('pro', 'premium') THEN p_plan ELSE NULL END,
    subscription_grace_until = v_grace_until,
    pending_plan = p_pending_plan,
    pending_plan_effective_at = p_pending_effective_at,
    updated_at = now()
  WHERE id = p_user_id;
  RETURN jsonb_build_object('plan', v_effective_plan, 'status', p_status,
    'period_end', p_period_end, 'grace_until', v_grace_until,
    'pending_plan', p_pending_plan, 'pending_effective_at', p_pending_effective_at);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_subscription_state_v1(uuid, text, public.plan_type, timestamptz, text, text, public.plan_type, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_subscription_state_v1(uuid, text, public.plan_type, timestamptz, text, text, public.plan_type, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_subscription_entitlements_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin')
    THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.profiles SET plan = 'free', plan_expires_at = NULL, updated_at = now()
  WHERE plan <> 'free' AND (
    (subscription_status = 'past_due' AND subscription_grace_until <= now())
    OR (subscription_status = 'canceled' AND plan_expires_at <= now())
    OR subscription_status IN ('unpaid', 'incomplete_expired', 'expired', 'free')
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_subscription_entitlements_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_subscription_entitlements_v1() TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('classfy-expire-subscriptions-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('classfy-expire-subscriptions-daily', '15 7 * * *',
  $$ SELECT public.expire_subscription_entitlements_v1() $$);

CREATE OR REPLACE FUNCTION public.update_economic_v1_settings(p_value jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_merged jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT value INTO v_old FROM public.platform_settings WHERE key = 'economic_v1' FOR UPDATE;
  v_merged := COALESCE(v_old, '{}'::jsonb) || COALESCE(p_value, '{}'::jsonb);

  IF (v_merged->>'pool_percentage')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid_pool_percentage'; END IF;
  IF (v_merged->'user_points_multipliers'->>'free')::numeric NOT BETWEEN 0 AND 10
    OR (v_merged->'user_points_multipliers'->>'pro')::numeric NOT BETWEEN 0 AND 10
    OR (v_merged->'user_points_multipliers'->>'premium')::numeric NOT BETWEEN 0 AND 10
    THEN RAISE EXCEPTION 'invalid_points_multiplier'; END IF;
  IF (v_merged->'reward_maturation_days'->>'free')::int NOT BETWEEN 0 AND 365
    OR (v_merged->'reward_maturation_days'->>'pro')::int NOT BETWEEN 0 AND 365
    OR (v_merged->'reward_maturation_days'->>'premium')::int NOT BETWEEN 0 AND 365
    THEN RAISE EXCEPTION 'invalid_maturation_days'; END IF;
  IF (v_merged->>'minimum_withdrawal_amount')::numeric < 0 THEN RAISE EXCEPTION 'invalid_minimum_withdrawal'; END IF;
  IF (v_merged->>'sales_commission_percent')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'invalid_sales_commission'; END IF;
  IF (v_merged->>'creator_sales_hold_days')::int NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'invalid_creator_hold'; END IF;
  IF (v_merged->>'subscription_grace_period_days')::int NOT BETWEEN 0 AND 30 THEN RAISE EXCEPTION 'invalid_subscription_grace'; END IF;
  IF (v_merged->>'referral_commission_percent')::numeric NOT BETWEEN 0 AND 50 THEN RAISE EXCEPTION 'invalid_referral_commission'; END IF;
  IF v_merged->>'approved_content_monthly_limit' IS NOT NULL
    AND (v_merged->>'approved_content_monthly_limit')::int <= 0
    THEN RAISE EXCEPTION 'invalid_approved_content_limit'; END IF;

  UPDATE public.platform_settings SET value = v_merged, updated_at = now() WHERE key = 'economic_v1';
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'update', 'economic_settings', 'economic_v1', btrim(p_reason), v_old, v_merged);
  RETURN v_merged;
END;
$$;
REVOKE ALL ON FUNCTION public.update_economic_v1_settings(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_economic_v1_settings(jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_reward_action_config_v1(
  p_action_key text, p_points_user numeric, p_points_creator numeric,
  p_daily_limit integer, p_monthly_creator_limit integer,
  p_active boolean, p_description text, p_reason text
)
RETURNS public.reward_actions_config LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old public.reward_actions_config%ROWTYPE; v_new public.reward_actions_config%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_points_user < 0 OR p_points_creator < 0 THEN RAISE EXCEPTION 'negative_points'; END IF;
  IF p_daily_limit IS NOT NULL AND p_daily_limit <= 0 THEN RAISE EXCEPTION 'invalid_daily_limit'; END IF;
  IF p_monthly_creator_limit IS NOT NULL AND p_monthly_creator_limit <= 0 THEN RAISE EXCEPTION 'invalid_monthly_limit'; END IF;
  SELECT * INTO v_old FROM public.reward_actions_config WHERE action_key = p_action_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reward_action_not_found'; END IF;
  UPDATE public.reward_actions_config SET
    points_user = p_points_user, points_creator = p_points_creator,
    daily_limit = p_daily_limit, monthly_creator_limit = p_monthly_creator_limit,
    active = p_active, description = p_description,
    value_user = 0, value_creator = 0, updated_at = now()
  WHERE action_key = p_action_key RETURNING * INTO v_new;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'update', 'reward_action', p_action_key, btrim(p_reason), to_jsonb(v_old), to_jsonb(v_new));
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.update_reward_action_config_v1(text, numeric, numeric, integer, integer, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_reward_action_config_v1(text, numeric, numeric, integer, integer, boolean, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Commit atomico central de Points
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_reward_award(
  p_tracking_user_id uuid, p_tracking_action_key text, p_tracking_content_id uuid,
  p_tracking_metadata jsonb, p_cycle_id uuid, p_actor_event jsonb,
  p_creator_event jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tracking_id uuid; v_actor public.reward_events%ROWTYPE; v_creator public.reward_events%ROWTYPE;
  v_actor_points numeric; v_creator_points numeric; v_actor_type text; v_creator_type text;
BEGIN
  IF p_cycle_id IS NULL OR p_actor_event IS NULL THEN RAISE EXCEPTION 'invalid_reward_payload'; END IF;
  INSERT INTO public.reward_action_tracking(user_id, content_id, action_key, metadata)
  VALUES (p_tracking_user_id, p_tracking_content_id, p_tracking_action_key, COALESCE(p_tracking_metadata, '{}'::jsonb))
  ON CONFLICT (user_id, action_key) DO NOTHING RETURNING id INTO v_tracking_id;
  IF v_tracking_id IS NULL THEN RETURN jsonb_build_object('already_tracked', true, 'rewards', '[]'::jsonb); END IF;

  v_actor_points := COALESCE((p_actor_event->>'cycle_points')::numeric, (p_actor_event->>'performance_points')::numeric, (p_actor_event->>'points')::numeric, 0);
  v_actor_type := COALESCE(p_actor_event->>'point_type', 'user');
  IF v_actor_points < 0 OR v_actor_type NOT IN ('user', 'creator') THEN RAISE EXCEPTION 'invalid_reward_points'; END IF;
  INSERT INTO public.reward_events(user_id, related_user_id, content_id, action_key, points, value,
    performance_points, cycle_points, point_type, cycle_id, metadata)
  VALUES ((p_actor_event->>'user_id')::uuid, NULLIF(p_actor_event->>'related_user_id', '')::uuid,
    NULLIF(p_actor_event->>'content_id', '')::uuid, p_actor_event->>'action_key', v_actor_points, 0,
    v_actor_points, v_actor_points, v_actor_type, p_cycle_id, COALESCE(p_actor_event->'metadata', '{}'::jsonb))
  RETURNING * INTO v_actor;
  INSERT INTO public.economic_cycle_users(cycle_id, user_id, performance_points, user_points, creator_points, cycle_points, qualified_for_pool)
  VALUES (p_cycle_id, v_actor.user_id, v_actor_points,
    CASE WHEN v_actor_type = 'user' THEN v_actor_points ELSE 0 END,
    CASE WHEN v_actor_type = 'creator' THEN v_actor_points ELSE 0 END,
    v_actor_points, true)
  ON CONFLICT (cycle_id, user_id) DO UPDATE SET
    user_points = economic_cycle_users.user_points + EXCLUDED.user_points,
    creator_points = economic_cycle_users.creator_points + EXCLUDED.creator_points,
    cycle_points = economic_cycle_users.cycle_points + EXCLUDED.cycle_points,
    performance_points = economic_cycle_users.performance_points + EXCLUDED.cycle_points,
    qualified_for_pool = true, qualification_points = 0, qualification_details = '{}'::jsonb,
    updated_at = now();

  IF p_creator_event IS NOT NULL THEN
    v_creator_points := COALESCE((p_creator_event->>'cycle_points')::numeric, (p_creator_event->>'performance_points')::numeric, (p_creator_event->>'points')::numeric, 0);
    v_creator_type := COALESCE(p_creator_event->>'point_type', 'creator');
    IF v_creator_points < 0 OR v_creator_type <> 'creator' THEN RAISE EXCEPTION 'invalid_creator_points'; END IF;
    INSERT INTO public.reward_events(user_id, related_user_id, content_id, action_key, points, value,
      performance_points, cycle_points, point_type, cycle_id, metadata)
    VALUES ((p_creator_event->>'user_id')::uuid, NULLIF(p_creator_event->>'related_user_id', '')::uuid,
      NULLIF(p_creator_event->>'content_id', '')::uuid, p_creator_event->>'action_key', v_creator_points, 0,
      v_creator_points, v_creator_points, 'creator', p_cycle_id, COALESCE(p_creator_event->'metadata', '{}'::jsonb))
    RETURNING * INTO v_creator;
    INSERT INTO public.economic_cycle_users(cycle_id, user_id, performance_points, user_points, creator_points, cycle_points, qualified_for_pool)
    VALUES (p_cycle_id, v_creator.user_id, v_creator_points, 0, v_creator_points, v_creator_points, true)
    ON CONFLICT (cycle_id, user_id) DO UPDATE SET
      creator_points = economic_cycle_users.creator_points + EXCLUDED.creator_points,
      cycle_points = economic_cycle_users.cycle_points + EXCLUDED.cycle_points,
      performance_points = economic_cycle_users.performance_points + EXCLUDED.cycle_points,
      qualified_for_pool = true, qualification_points = 0, qualification_details = '{}'::jsonb,
      updated_at = now();
  END IF;
  RETURN jsonb_build_object('already_tracked', false, 'rewards', CASE
    WHEN p_creator_event IS NULL THEN jsonb_build_array(to_jsonb(v_actor))
    ELSE jsonb_build_array(to_jsonb(v_actor), to_jsonb(v_creator)) END);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_reward_award(uuid, text, uuid, jsonb, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_reward_award(uuid, text, uuid, jsonb, uuid, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_reward_award(p_user_id uuid, p_content_id uuid, p_action_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reward public.reward_events%ROWTYPE; v_creator public.reward_events%ROWTYPE;
  v_tracking_key text := p_action_key || '_' || p_content_id::text; v_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  SELECT * INTO v_reward FROM public.reward_events
  WHERE user_id = p_user_id AND content_id = p_content_id AND action_key = p_action_key AND point_type = 'user'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('reversed', false); END IF;
  SELECT status INTO v_status FROM public.economic_cycles WHERE id = v_reward.cycle_id;
  IF v_status IS DISTINCT FROM 'open' THEN RETURN jsonb_build_object('reversed', false, 'cycle_closed', true); END IF;
  SELECT * INTO v_creator FROM public.reward_events
  WHERE related_user_id = p_user_id AND content_id = p_content_id AND action_key = p_action_key
    AND point_type = 'creator' AND metadata->>'tracking_key' = v_tracking_key
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  DELETE FROM public.reward_events WHERE id = v_reward.id;
  UPDATE public.economic_cycle_users SET
    user_points = GREATEST(0, user_points - v_reward.cycle_points),
    cycle_points = GREATEST(0, cycle_points - v_reward.cycle_points),
    performance_points = GREATEST(0, performance_points - v_reward.cycle_points), updated_at = now()
  WHERE cycle_id = v_reward.cycle_id AND user_id = v_reward.user_id;
  IF v_creator.id IS NOT NULL THEN
    DELETE FROM public.reward_events WHERE id = v_creator.id;
    UPDATE public.economic_cycle_users SET
      creator_points = GREATEST(0, creator_points - v_creator.cycle_points),
      cycle_points = GREATEST(0, cycle_points - v_creator.cycle_points),
      performance_points = GREATEST(0, performance_points - v_creator.cycle_points), updated_at = now()
    WHERE cycle_id = v_creator.cycle_id AND user_id = v_creator.user_id;
  END IF;
  DELETE FROM public.reward_action_tracking WHERE user_id = p_user_id AND action_key = v_tracking_key;
  RETURN jsonb_build_object('reversed', true, 'points', v_reward.cycle_points,
    'creator_points', COALESCE(v_creator.cycle_points, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_reward_award(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_reward_award(uuid, uuid, text) TO service_role;

-- Aprovacao de Creator usa o mesmo commit central, dentro da transacao do perfil.
CREATE OR REPLACE FUNCTION public.award_creator_approval_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cfg public.reward_actions_config%ROWTYPE; v_cycle uuid;
BEGIN
  IF NEW.creator_status = 'approved' AND OLD.creator_status IS DISTINCT FROM 'approved' THEN
    SELECT * INTO v_cfg FROM public.reward_actions_config WHERE action_key = 'CREATOR_APPROVED' AND active;
    IF FOUND THEN
      SELECT public.get_or_create_current_cycle() INTO v_cycle;
      PERFORM public.commit_reward_award(
        NEW.id, 'CREATOR_APPROVED', NULL,
        jsonb_build_object('source', 'creator_status_transition'), v_cycle,
        jsonb_build_object('user_id', NEW.id, 'action_key', 'CREATOR_APPROVED',
          'points', v_cfg.points_creator, 'cycle_points', v_cfg.points_creator,
          'point_type', 'creator', 'metadata', jsonb_build_object('activation', true)), NULL
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_award_creator_approval_v1 ON public.profiles;
CREATE TRIGGER profiles_award_creator_approval_v1
AFTER UPDATE OF creator_status ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.award_creator_approval_v1();

-- -----------------------------------------------------------------------------
-- 9. Receita liquida elegivel
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_eligible_revenue_v1(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start date; v_end date; v_gross numeric; v_net numeric; v_affiliate numeric;
BEGIN
  v_start := (p_year_month || '-01')::date; v_end := (v_start + interval '1 month')::date;
  SELECT COALESCE(sum(gross_amount), 0), COALESCE(sum(net_eligible_amount), 0)
  INTO v_gross, v_net
  FROM public.revenue_entries
  WHERE year_month = p_year_month AND status = 'confirmed' AND is_pool_eligible = true;
  SELECT COALESCE(sum(commission_amount), 0) INTO v_affiliate
  FROM public.referral_commissions
  WHERE status = 'paid' AND created_at >= v_start AND created_at < v_end;
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
  IF p_gross_amount <= 0 OR p_payment_fee_amount < 0 OR p_tax_amount < 0 OR p_creator_amount < 0 THEN RAISE EXCEPTION 'invalid_revenue_amount'; END IF;
  IF p_revenue_type NOT IN ('subscription_pro', 'subscription_premium', 'content_purchase', 'boost', 'other') THEN RAISE EXCEPTION 'invalid_revenue_type'; END IF;
  IF p_revenue_type = 'other' AND p_is_pool_eligible IS DISTINCT FROM true THEN RAISE EXCEPTION 'other_revenue_requires_explicit_eligibility'; END IF;
  v_month := to_char(now(), 'YYYY-MM');
  v_net := CASE WHEN p_is_pool_eligible THEN GREATEST(0, p_gross_amount - p_payment_fee_amount - p_tax_amount - p_creator_amount) ELSE 0 END;
  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, user_id, metadata,
    status, is_pool_eligible, gross_amount, payment_fee_amount, tax_amount, creator_amount, classfy_amount,
    net_eligible_amount, confirmed_at)
  VALUES (v_month, p_revenue_type, v_net, p_source_id, p_user_id, COALESCE(p_metadata, '{}'::jsonb),
    'confirmed', p_is_pool_eligible, p_gross_amount, p_payment_fee_amount, p_tax_amount,
    p_creator_amount, GREATEST(0, p_gross_amount - p_creator_amount), v_net, now())
  ON CONFLICT (source_id) WHERE source_id IS NOT NULL DO UPDATE SET source_id = EXCLUDED.source_id
  RETURNING * INTO v_entry;
  RETURN v_entry;
END;
$$;
REVOKE ALL ON FUNCTION public.record_revenue_entry_v1(text, numeric, text, uuid, jsonb, boolean, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_revenue_entry_v1(text, numeric, text, uuid, jsonb, boolean, numeric, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.record_manual_eligible_revenue_v1(p_amount numeric, p_description text, p_reason text)
RETURNS public.revenue_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entry public.revenue_entries%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF NULLIF(btrim(p_description), '') IS NULL OR NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'description_and_reason_required'; END IF;
  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, user_id, metadata,
    status, is_pool_eligible, gross_amount, classfy_amount, net_eligible_amount, confirmed_at)
  VALUES (to_char(now(), 'YYYY-MM'), 'other', p_amount, 'admin_' || gen_random_uuid()::text, auth.uid(),
    jsonb_build_object('description', btrim(p_description), 'pool_eligible', true),
    'confirmed', true, p_amount, p_amount, p_amount, now()) RETURNING * INTO v_entry;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'create', 'eligible_revenue', v_entry.id::text, btrim(p_reason), NULL, to_jsonb(v_entry));
  RETURN v_entry;
END;
$$;
REVOKE ALL ON FUNCTION public.record_manual_eligible_revenue_v1(numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_eligible_revenue_v1(numeric, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. Carteira e maturacao
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_wallet(
  p_user_id uuid, p_amount numeric, p_tx_type text, p_description text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_cycle_id uuid DEFAULT NULL,
  p_commission_id uuid DEFAULT NULL, p_stripe_event_id text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet public.wallets%ROWTYPE; v_tx_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_amount = 0 THEN RAISE EXCEPTION 'zero_wallet_amount'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT wt.id INTO v_tx_id FROM public.wallet_transactions wt JOIN public.wallets w ON w.id = wt.wallet_id
    WHERE w.user_id = p_user_id AND wt.idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN json_build_object('success', true, 'idempotent', true, 'tx_id', v_tx_id); END IF;
  END IF;
  INSERT INTO public.wallets(user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets SET balance = balance + p_amount,
    total_earned = CASE WHEN p_amount > 0 THEN total_earned + p_amount ELSE total_earned END,
    updated_at = now() WHERE user_id = p_user_id RETURNING * INTO v_wallet;
  INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, idempotency_key,
    cycle_id, commission_id, stripe_event_id, status)
  VALUES (v_wallet.id, p_tx_type, p_amount, p_description, p_idempotency_key,
    p_cycle_id, p_commission_id, p_stripe_event_id, 'posted') RETURNING id INTO v_tx_id;
  RETURN json_build_object('success', true, 'idempotent', false, 'new_balance', v_wallet.balance, 'tx_id', v_tx_id);
END;
$$;
REVOKE ALL ON FUNCTION public.increment_wallet(uuid, numeric, text, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_wallet(uuid, numeric, text, text, text, uuid, uuid, text) TO service_role;

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
  -- wallet_transactions e append-only e representa apenas saldo efetivado.
  -- A obrigacao ainda em maturacao vive exclusivamente em wallet_pending.
  v_tx_id := NULL;
  INSERT INTO public.wallet_pending(wallet_id, user_id, amount, source_type, cycle_id, idempotency_key,
    mature_at, transaction_id, status, metadata)
  VALUES (v_wallet_id, p_user_id, round(p_amount, 2), 'pool_distribution', p_cycle_id, v_key,
    now() + make_interval(days => v_days), v_tx_id, 'pending', jsonb_build_object('plan_at_close', v_plan, 'maturation_days', v_days))
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_pending_id;
  IF v_pending_id IS NOT NULL THEN
    UPDATE public.wallets SET pending_balance = pending_balance + round(p_amount, 2), updated_at = now() WHERE id = v_wallet_id;
    INSERT INTO public.notifications(user_id, type, title, message)
    VALUES (p_user_id, 'reward', 'Recompensa confirmada', 'O ciclo ' || p_year_month || ' confirmou R$ ' || round(p_amount, 2)::text || '. Disponivel em ' || v_days::text || ' dias.');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.distribute_cycle_payout(uuid, uuid, numeric, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.distribute_cycle_payout(uuid, uuid, numeric, text, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.batch_mature_pending()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_amount numeric; v_count integer := 0; v_total numeric := 0; v_label text;
BEGIN
  -- pg_cron executa como postgres; chamadas externas continuam restritas ao service role.
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
    UPDATE public.wallets SET balance = balance + v_amount,
      pending_balance = GREATEST(0, pending_balance - v_amount),
      total_earned = total_earned + v_amount, updated_at = now()
    WHERE id = r.wallet_id;
    SELECT COALESCE(ec.year_month, '') INTO v_label FROM public.economic_cycles ec WHERE ec.id = r.cycle_id;
    INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, cycle_id, purchase_id,
      idempotency_key, status)
    VALUES (r.wallet_id, r.source_type, v_amount, 'Saldo liberado' || CASE WHEN v_label <> '' THEN ' - ' || v_label ELSE '' END,
      r.cycle_id, r.purchase_id, 'matured_' || r.id::text, 'posted')
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    UPDATE public.wallet_pending SET matured_at = now(), status = 'matured' WHERE id = r.id;
    INSERT INTO public.notifications(user_id, type, title, message)
    VALUES (r.user_id, 'reward', 'Saldo liberado', 'R$ ' || v_amount::text || ' estao disponiveis na sua carteira.');
    v_count := v_count + 1; v_total := v_total + v_amount;
  END LOOP;
  RETURN jsonb_build_object('matured_count', v_count, 'total_released', v_total, 'run_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.batch_mature_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_mature_pending() TO service_role;

-- -----------------------------------------------------------------------------
-- 11. Saque: minimo unico, reserva e baixa manual paga
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric, p_pix_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_wallet public.wallets%ROWTYPE; v_min numeric; v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF NULLIF(btrim(p_pix_key), '') IS NULL THEN RAISE EXCEPTION 'pix_key_required'; END IF;
  SELECT COALESCE((value->>'minimum_withdrawal_amount')::numeric, 10) INTO v_min
  FROM public.platform_settings WHERE key = 'economic_v1';
  IF p_amount < v_min THEN RAISE EXCEPTION 'below_minimum_withdrawal'; END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
  IF v_wallet.balance <= 0 OR p_amount > v_wallet.balance - v_wallet.reserved_balance THEN RAISE EXCEPTION 'insufficient_available_balance'; END IF;
  INSERT INTO public.withdraw_requests(user_id, wallet_id, amount, pix_key, status)
  VALUES (v_user, v_wallet.id, round(p_amount, 2), btrim(p_pix_key), 'pending') RETURNING id INTO v_id;
  UPDATE public.wallets SET reserved_balance = reserved_balance + round(p_amount, 2), updated_at = now() WHERE id = v_wallet.id;
  RETURN jsonb_build_object('success', true, 'request_id', v_id, 'reserved_amount', round(p_amount, 2));
END;
$$;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_withdrawal_paid(p_request_id uuid, p_admin_notes text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.withdraw_requests%ROWTYPE; v_wallet public.wallets%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.withdraw_requests SET status = 'paid', approved_by = auth.uid(), approved_at = now(), admin_notes = p_admin_notes
  WHERE id = p_request_id AND status = 'pending' RETURNING * INTO v_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdraw_already_processed'; END IF;
  UPDATE public.wallets SET balance = balance - v_req.amount,
    reserved_balance = GREATEST(0, reserved_balance - v_req.amount),
    total_withdrawn = total_withdrawn + v_req.amount, updated_at = now()
  WHERE id = v_req.wallet_id RETURNING * INTO v_wallet;
  INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, withdraw_request_id,
    idempotency_key, status, admin_id, metadata)
  VALUES (v_wallet.id, 'withdraw', -v_req.amount, 'Saque pago - R$ ' || v_req.amount::text, v_req.id,
    'withdraw_' || v_req.id::text, 'posted', auth.uid(), jsonb_build_object('reason', btrim(p_reason)));
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'pay', 'withdrawal', v_req.id::text, btrim(p_reason), NULL, to_jsonb(v_req));
  INSERT INTO public.notifications(user_id, type, title, message)
  VALUES (v_req.user_id, 'withdraw', 'Saque pago', 'Seu saque de R$ ' || v_req.amount::text || ' foi pago.');
  RETURN jsonb_build_object('success', true, 'new_balance', v_wallet.balance, 'amount', v_req.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_withdrawal_paid(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_paid(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_withdrawal_v1(p_request_id uuid, p_admin_notes text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.withdraw_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.withdraw_requests SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), admin_notes = p_admin_notes
  WHERE id = p_request_id AND status = 'pending' RETURNING * INTO v_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdraw_already_processed'; END IF;
  UPDATE public.wallets SET reserved_balance = GREATEST(0, reserved_balance - v_req.amount), updated_at = now() WHERE id = v_req.wallet_id;
  INSERT INTO public.economic_admin_audit(admin_id, action, entity_type, entity_id, reason, old_value, new_value)
  VALUES (auth.uid(), 'reject', 'withdrawal', v_req.id::text, btrim(p_reason), NULL, to_jsonb(v_req));
  INSERT INTO public.notifications(user_id, type, title, message)
  VALUES (v_req.user_id, 'withdraw', 'Saque recusado', 'Seu saque de R$ ' || v_req.amount::text || ' foi recusado.');
  RETURN jsonb_build_object('success', true, 'released_amount', v_req.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.reject_withdrawal_v1(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_v1(uuid, text, text) TO authenticated;

-- Compatibilidade: a RPC antiga passa a significar pagamento confirmado.
CREATE OR REPLACE FUNCTION public.approve_withdrawal(p_request_id uuid, p_admin_id uuid, p_admin_notes text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_admin_id THEN RAISE EXCEPTION 'admin_identity_mismatch'; END IF;
  RETURN public.mark_withdrawal_paid(p_request_id, p_admin_notes, 'Pagamento manual confirmado pelo Admin');
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. Venda avulsa, hold e reversao
-- -----------------------------------------------------------------------------
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
  IF p_gross_amount <= 0 OR p_payment_fee_amount < 0 OR p_tax_amount < 0 THEN RAISE EXCEPTION 'invalid_sale_amount'; END IF;
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
    payment_fee_amount, tax_amount, status, stripe_payment_intent_id, stripe_checkout_session_id, processed_at)
  VALUES (p_user_id, p_content_id, v_creator, p_gross_amount, COALESCE(p_discount_applied, 0),
    p_gross_amount, v_classfy_pct, v_creator_pct, v_classfy, v_creator_amount,
    p_payment_fee_amount, p_tax_amount, 'confirmed', p_payment_intent_id, p_checkout_session_id, now())
  ON CONFLICT (user_id, content_id) DO UPDATE SET
    creator_id = EXCLUDED.creator_id, price_paid = EXCLUDED.price_paid, discount_applied = EXCLUDED.discount_applied,
    gross_amount = EXCLUDED.gross_amount, classfy_percent = EXCLUDED.classfy_percent,
    creator_percent = EXCLUDED.creator_percent, classfy_amount = EXCLUDED.classfy_amount,
    creator_amount = EXCLUDED.creator_amount, payment_fee_amount = EXCLUDED.payment_fee_amount,
    tax_amount = EXCLUDED.tax_amount, status = EXCLUDED.status,
    stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
    stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id, processed_at = now()
  RETURNING * INTO v_purchase;

  INSERT INTO public.revenue_entries(year_month, revenue_type, amount, source_id, user_id, metadata,
    status, is_pool_eligible, gross_amount, payment_fee_amount, tax_amount, creator_amount, classfy_amount,
    net_eligible_amount, confirmed_at)
  VALUES (to_char(now(), 'YYYY-MM'), 'content_purchase', v_net, p_payment_intent_id, p_user_id,
    jsonb_build_object('purchase_id', v_purchase.id, 'content_id', p_content_id,
      'classfy_percent', v_classfy_pct, 'creator_percent', v_creator_pct,
      'classfy_amount', v_classfy, 'creator_amount', v_creator_amount),
    'confirmed', true, p_gross_amount, p_payment_fee_amount, p_tax_amount,
    v_creator_amount, v_classfy, v_net, now())
  ON CONFLICT (source_id) WHERE source_id IS NOT NULL DO NOTHING;

  INSERT INTO public.wallets(user_id) VALUES (v_creator) ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet FROM public.wallets WHERE user_id = v_creator FOR UPDATE;
  -- O credito contabil so nasce quando o hold termina; ate la, wallet_pending
  -- e a fonte oficial e evita mutacoes no ledger append-only.
  v_tx := NULL;
  INSERT INTO public.wallet_pending(wallet_id, user_id, amount, source_type, purchase_id, idempotency_key,
    mature_at, transaction_id, status, metadata)
  VALUES (v_wallet, v_creator, v_creator_amount, 'creator_sale', v_purchase.id,
    'creator_sale_' || p_payment_intent_id, now() + make_interval(days => v_hold), v_tx, 'pending',
    jsonb_build_object('hold_days', v_hold, 'payment_intent_id', p_payment_intent_id))
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_pending;
  IF v_pending IS NOT NULL THEN UPDATE public.wallets SET pending_balance = pending_balance + v_creator_amount, updated_at = now() WHERE id = v_wallet; END IF;
  RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase.id,
    'gross_amount', p_gross_amount, 'classfy_percent', v_classfy_pct, 'classfy_amount', v_classfy,
    'creator_percent', v_creator_pct, 'creator_amount', v_creator_amount,
    'eligible_net_revenue', v_net, 'creator_hold_days', v_hold);
END;
$$;
REVOKE ALL ON FUNCTION public.record_content_sale_v1(uuid, uuid, numeric, numeric, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_sale_v1(uuid, uuid, numeric, numeric, text, text, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_content_sale_v1(
  p_payment_intent_id text, p_reversal_type text, p_reversed_gross_amount numeric, p_stripe_event_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_purchase public.purchased_contents%ROWTYPE; v_old_total numeric; v_new_total numeric;
  v_delta numeric; v_creator_delta numeric; v_classfy_reversal numeric; v_pending public.wallet_pending%ROWTYPE;
  v_wallet public.wallets%ROWTYPE; v_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_reversal_type NOT IN ('refund', 'chargeback') OR p_reversed_gross_amount <= 0 THEN RAISE EXCEPTION 'invalid_reversal'; END IF;
  SELECT * INTO v_purchase FROM public.purchased_contents
  WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'purchase_not_found', true); END IF;
  v_old_total := LEAST(v_purchase.gross_amount, v_purchase.refunded_amount + v_purchase.chargeback_amount);
  IF p_reversal_type = 'refund' THEN
    UPDATE public.purchased_contents SET refunded_amount = LEAST(gross_amount, GREATEST(refunded_amount, p_reversed_gross_amount))
    WHERE id = v_purchase.id RETURNING * INTO v_purchase;
  ELSE
    UPDATE public.purchased_contents SET chargeback_amount = LEAST(gross_amount, GREATEST(chargeback_amount, p_reversed_gross_amount))
    WHERE id = v_purchase.id RETURNING * INTO v_purchase;
  END IF;
  v_new_total := LEAST(v_purchase.gross_amount, v_purchase.refunded_amount + v_purchase.chargeback_amount);
  v_delta := GREATEST(0, v_new_total - v_old_total);
  IF v_delta = 0 THEN RETURN jsonb_build_object('success', true, 'idempotent', true); END IF;
  v_creator_delta := LEAST(v_purchase.creator_amount, round(v_purchase.creator_amount * v_delta / v_purchase.gross_amount, 2));
  v_classfy_reversal := LEAST(v_purchase.classfy_amount, round(v_purchase.classfy_amount * v_new_total / v_purchase.gross_amount, 2));
  v_status := CASE WHEN v_new_total >= v_purchase.gross_amount
    THEN CASE WHEN p_reversal_type = 'refund' THEN 'refunded' ELSE 'chargeback' END
    ELSE 'confirmed' END;
  UPDATE public.purchased_contents SET status = v_status WHERE id = v_purchase.id;
  UPDATE public.revenue_entries SET
    refund_amount = CASE WHEN p_reversal_type = 'refund' THEN v_classfy_reversal ELSE refund_amount END,
    chargeback_amount = CASE WHEN p_reversal_type = 'chargeback' THEN v_classfy_reversal ELSE chargeback_amount END,
    net_eligible_amount = GREATEST(0, classfy_amount - payment_fee_amount - tax_amount - v_classfy_reversal),
    amount = GREATEST(0, classfy_amount - payment_fee_amount - tax_amount - v_classfy_reversal),
    status = CASE WHEN v_new_total >= v_purchase.gross_amount
      THEN CASE WHEN p_reversal_type = 'refund' THEN 'refunded' ELSE 'chargeback' END
      ELSE 'confirmed' END
  WHERE source_id = p_payment_intent_id;

  SELECT * INTO v_pending FROM public.wallet_pending WHERE purchase_id = v_purchase.id FOR UPDATE;
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_purchase.creator_id FOR UPDATE;
  IF v_pending.id IS NOT NULL AND v_pending.matured_at IS NULL AND v_pending.status = 'pending' THEN
    UPDATE public.wallet_pending SET reversed_amount = LEAST(amount, reversed_amount + v_creator_delta),
      status = CASE WHEN reversed_amount + v_creator_delta >= amount THEN 'reversed' ELSE 'pending' END
    WHERE id = v_pending.id;
    UPDATE public.wallets SET pending_balance = GREATEST(0, pending_balance - v_creator_delta), updated_at = now() WHERE id = v_wallet.id;
    INSERT INTO public.wallet_transactions(wallet_id, type, amount, description, purchase_id, stripe_event_id,
      idempotency_key, status, metadata)
    VALUES (v_wallet.id, 'creator_sale_reversal', -v_creator_delta, 'Reversao antes da liberacao', v_purchase.id,
      p_stripe_event_id, 'creator_sale_reversal_' || p_stripe_event_id, 'reversed',
      jsonb_build_object('reversal_type', p_reversal_type, 'pending_reversal', true));
  ELSE
    PERFORM public.increment_wallet(v_purchase.creator_id, -v_creator_delta, 'creator_sale_reversal',
      'Reversao de venda apos liberacao', 'creator_sale_reversal_' || p_stripe_event_id,
      NULL, NULL, p_stripe_event_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'reversed_gross', v_delta, 'creator_debit', v_creator_delta,
    'new_purchase_status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_content_sale_v1(text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_content_sale_v1(text, text, numeric, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 13. Fechamento mensal transacional, sem QP, carry-over ou buffer
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_economic_cycle_v1(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cycle public.economic_cycles%ROWTYPE; v_settings jsonb; v_revenue jsonb;
  v_pool_pct numeric; v_eligible numeric; v_gross numeric; v_pool numeric; v_total numeric;
  v_user_total numeric; v_creator_total numeric; v_pool_cents bigint; v_base_sum bigint;
  v_leftover bigint; v_index bigint := 0; v_paid integer := 0; r record; v_amount numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_year_month'; END IF;
  INSERT INTO public.economic_cycles(year_month, pool_percentage, economy_version)
  VALUES (p_year_month, 40, 1) ON CONFLICT (year_month) DO NOTHING;
  SELECT * INTO v_cycle FROM public.economic_cycles WHERE year_month = p_year_month FOR UPDATE;
  IF v_cycle.status <> 'open' THEN RAISE EXCEPTION 'cycle_not_open'; END IF;
  SELECT value INTO v_settings FROM public.platform_settings WHERE key = 'economic_v1';
  v_pool_pct := COALESCE((v_settings->>'pool_percentage')::numeric, 40);
  SELECT public.calculate_eligible_revenue_v1(p_year_month) INTO v_revenue;
  v_gross := COALESCE((v_revenue->>'gross_revenue')::numeric, 0);
  v_eligible := COALESCE((v_revenue->>'eligible_net_revenue')::numeric, 0);
  v_pool := round(v_eligible * v_pool_pct / 100, 2);
  SELECT COALESCE(sum(cycle_points), 0), COALESCE(sum(user_points), 0), COALESCE(sum(creator_points), 0)
  INTO v_total, v_user_total, v_creator_total
  FROM public.economic_cycle_users WHERE cycle_id = v_cycle.id AND cycle_points > 0;
  v_pool_cents := round(v_pool * 100)::bigint;
  SELECT COALESCE(sum(floor((cycle_points / NULLIF(v_total, 0)) * v_pool_cents)), 0)::bigint
  INTO v_base_sum FROM public.economic_cycle_users WHERE cycle_id = v_cycle.id AND cycle_points > 0;
  v_leftover := GREATEST(0, v_pool_cents - v_base_sum);

  FOR r IN
    SELECT user_id, cycle_points,
      floor((cycle_points / NULLIF(v_total, 0)) * v_pool_cents)::bigint AS base_cents,
      ((cycle_points / NULLIF(v_total, 0)) * v_pool_cents) - floor((cycle_points / NULLIF(v_total, 0)) * v_pool_cents) AS remainder
    FROM public.economic_cycle_users
    WHERE cycle_id = v_cycle.id AND cycle_points > 0
    ORDER BY remainder DESC, user_id
  LOOP
    v_index := v_index + 1;
    v_amount := (r.base_cents + CASE WHEN v_index <= v_leftover THEN 1 ELSE 0 END)::numeric / 100;
    PERFORM public.distribute_cycle_payout(v_cycle.id, r.user_id, v_amount, p_year_month, r.cycle_points, v_total);
    IF v_amount > 0 THEN v_paid := v_paid + 1; END IF;
  END LOOP;

  UPDATE public.economic_cycles SET gross_revenue = v_gross, eligible_net_revenue = v_eligible,
    rbm = v_eligible, pool_percentage = v_pool_pct, prm = v_pool,
    total_performance_points = v_total, total_user_points = v_user_total,
    total_creator_points = v_creator_total,
    distributed_amount = CASE WHEN v_total > 0 THEN v_pool ELSE 0 END,
    status = 'closed', closed_at = now(), updated_at = now(), economy_version = 1
  WHERE id = v_cycle.id;
  RETURN jsonb_build_object('success', true, 'year_month', p_year_month,
    'gross_revenue', v_gross, 'eligible_net_revenue', v_eligible,
    'pool_percentage', v_pool_pct, 'pool_amount', v_pool,
    'total_points', v_total, 'total_user_points', v_user_total,
    'total_creator_points', v_creator_total, 'users_paid', v_paid,
    'distributed_amount', CASE WHEN v_total > 0 THEN v_pool ELSE 0 END);
END;
$$;
REVOKE ALL ON FUNCTION public.close_economic_cycle_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_economic_cycle_v1(text) TO service_role;

-- Carry-over e qualificacao deixam de ser fontes ativas.
REVOKE ALL ON FUNCTION public.carryover_cycle_points(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.evaluate_pool_qualification(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.batch_evaluate_qualifications(uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('classfy-evaluate-qualifications-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- O motor economico de milestones por view e removido. Historico permanece.
DROP TRIGGER IF EXISTS trigger_check_view_milestones ON public.contents;
ALTER TABLE public.creator_milestones
  ADD COLUMN IF NOT EXISTS legacy_points_reward numeric,
  ADD COLUMN IF NOT EXISTS legacy_value_reward numeric,
  ADD COLUMN IF NOT EXISTS awards_points boolean NOT NULL DEFAULT false;
UPDATE public.creator_milestones
SET legacy_points_reward = COALESCE(legacy_points_reward, points_reward),
    legacy_value_reward = COALESCE(legacy_value_reward, value_reward),
    value_reward = 0, points_reward = 0, awards_points = false, updated_at = now();
COMMENT ON TABLE public.creator_milestones IS
  'Milestones V1 sao reconhecimento e progressao; nao geram Points financeiros.';

-- Recalcula total_earned materializado a partir do ledger postado positivo.
UPDATE public.wallets w
SET total_earned = COALESCE((
  SELECT sum(wt.amount) FROM public.wallet_transactions wt
  WHERE wt.wallet_id = w.id AND wt.status = 'posted' AND wt.amount > 0
), 0),
pending_balance = COALESCE((
  SELECT sum(wp.amount - wp.reversed_amount) FROM public.wallet_pending wp
  WHERE wp.wallet_id = w.id AND wp.status = 'pending' AND wp.matured_at IS NULL
), 0),
reserved_balance = COALESCE((
  SELECT sum(wr.amount) FROM public.withdraw_requests wr
  WHERE wr.wallet_id = w.id AND wr.status = 'pending'
), 0),
updated_at = now();
