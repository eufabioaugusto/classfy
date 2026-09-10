
-- ═══════════════════════════════════════════════════════
-- RPC: batch_mature_pending — libera saldo maturado diariamente
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.batch_mature_pending()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count         int     := 0;
  v_total_amount  numeric := 0;
  v_cycle_label   text;
  r               RECORD;
BEGIN
  FOR r IN
    SELECT wp.id, wp.wallet_id, wp.user_id, wp.amount, wp.cycle_id
    FROM wallet_pending wp
    WHERE wp.mature_at <= NOW()
      AND wp.matured_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Buscar label do ciclo para descrição
    SELECT COALESCE(year_month, '') INTO v_cycle_label
    FROM economic_cycles WHERE id = r.cycle_id;

    -- Creditar no saldo disponível
    UPDATE wallets
    SET balance         = balance + r.amount,
        pending_balance = GREATEST(0, pending_balance - r.amount),
        updated_at      = NOW()
    WHERE id = r.wallet_id;

    -- Registrar no ledger (wallet_transactions) — fonte de verdade definitiva
    INSERT INTO wallet_transactions (
      wallet_id, type, amount, description, cycle_id, idempotency_key
    ) VALUES (
      r.wallet_id,
      'pool_distribution',
      r.amount,
      'Pool liberado após maturação' || CASE WHEN v_cycle_label <> '' THEN ' - ' || v_cycle_label ELSE '' END,
      r.cycle_id,
      'matured_' || r.id::text
    );

    -- Marcar como maturado
    UPDATE wallet_pending SET matured_at = NOW() WHERE id = r.id;

    -- Notificação ao usuário
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (
      r.user_id, 'reward',
      '💰 Saldo Liberado!',
      'R$ ' || r.amount::text || ' do pool de recompensas estão disponíveis na sua carteira.'
    );

    v_count        := v_count + 1;
    v_total_amount := v_total_amount + r.amount;
  END LOOP;

  RETURN jsonb_build_object(
    'matured_count',  v_count,
    'total_released', v_total_amount,
    'run_at',         NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.batch_mature_pending FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_mature_pending TO service_role;

-- ═══════════════════════════════════════════════════════
-- Atualizar distribute_cycle_payout para usar maturação
-- e verificar qualificação antes de creditar
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.distribute_cycle_payout(
  p_cycle_id    uuid,
  p_user_id     uuid,
  p_amount      numeric,
  p_year_month  text,
  p_user_pp     numeric,
  p_total_pp    numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_updated  int;
  v_wallet_id     uuid;
  v_idem_key      text;
  v_plan          text;
  v_settings      jsonb;
  v_maturation    int;
  v_mature_at     timestamptz;
  v_percentage    numeric;
BEGIN
  -- Guard de idempotência: só executa se ainda não pago
  UPDATE economic_cycle_users
  SET calculated_share = p_amount,
      payout_status    = 'paid',
      updated_at       = NOW()
  WHERE cycle_id = p_cycle_id
    AND user_id   = p_user_id
    AND payout_status != 'paid'
    AND qualified_for_pool = true;   -- só qualificados recebem

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN RETURN; END IF;  -- já pago ou não qualificado

  -- Buscar wallet
  SELECT id INTO v_wallet_id FROM wallets WHERE user_id = p_user_id;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
  END IF;

  -- Maturation days do plano do usuário
  SELECT COALESCE(plan::text, 'free') INTO v_plan FROM profiles WHERE id = p_user_id;
  SELECT value INTO v_settings FROM platform_settings WHERE key = 'economic';
  v_maturation := COALESCE(
    (v_settings->'plan_config'->v_plan->>'maturation_days')::int,
    CASE v_plan WHEN 'premium' THEN 2 WHEN 'pro' THEN 10 ELSE 60 END
  );
  v_mature_at := NOW() + (v_maturation || ' days')::interval;

  v_percentage := (p_user_pp / NULLIF(p_total_pp, 0)) * 100;
  v_idem_key   := 'pool_dist_' || p_cycle_id::text || '_' || p_user_id::text;

  -- Registrar em wallet_pending (saldo bloqueado até maturação)
  INSERT INTO wallet_pending (wallet_id, user_id, amount, source_type, cycle_id, idempotency_key, mature_at)
  VALUES (v_wallet_id, p_user_id, p_amount, 'pool_distribution', p_cycle_id, v_idem_key, v_mature_at)
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Incrementar pending_balance
  UPDATE wallets
  SET pending_balance = pending_balance + p_amount,
      updated_at      = NOW()
  WHERE id = v_wallet_id;

  -- Notificação: saldo em maturação (não disponível ainda)
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (
    p_user_id, 'reward',
    '🏆 Recompensa do Pool!',
    'Você recebeu R$ ' || p_amount::text || ' do pool de ' || p_year_month ||
    ' (seus ' || FLOOR(p_user_pp)::text || ' PP = ' || ROUND(v_percentage, 1)::text || '% do pool).' ||
    ' Disponível em ' || v_maturation::text || ' dias.'
  );
END;
$$;

-- ═══════════════════════════════════════════════════════
-- Atualizar reconciliation para incluir wallet_pending
-- ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_reconciliation(
  p_period text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  WALLET_DRIFT_THRESHOLD  CONSTANT numeric := 0.01;
  ERROR_THRESHOLD         CONSTANT numeric := 1.00;
  v_run_id        uuid;
  v_status        text := 'ok';
  v_wallets_ok    int := 0;
  v_wallets_drift int := 0;
  v_total_drift   numeric := 0;
  v_wallet_issues jsonb := '[]'::jsonb;
  v_cycles_ok     int := 0;
  v_cycles_drift  int := 0;
  v_cycle_issues  jsonb := '[]'::jsonb;
  r               RECORD;
  v_result        jsonb;
BEGIN
  -- CHECK 1: wallets.balance = SUM(wallet_transactions.amount)
  -- wallets.pending_balance = SUM(wallet_pending.amount WHERE matured_at IS NULL)
  FOR r IN
    SELECT
      w.user_id, w.id AS wallet_id,
      w.balance AS stored,
      COALESCE(SUM(wt.amount), 0) AS from_ledger,
      w.pending_balance AS pending_stored,
      COALESCE(SUM(wp.amount) FILTER (WHERE wp.matured_at IS NULL), 0) AS pending_from_table
    FROM wallets w
    LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
    LEFT JOIN wallet_pending wp ON wp.wallet_id = w.id
    GROUP BY w.user_id, w.id, w.balance, w.pending_balance
  LOOP
    IF ABS(r.stored - r.from_ledger) > WALLET_DRIFT_THRESHOLD
    OR ABS(r.pending_stored - r.pending_from_table) > WALLET_DRIFT_THRESHOLD THEN
      v_wallets_drift := v_wallets_drift + 1;
      v_total_drift   := v_total_drift + ABS(r.stored - r.from_ledger) + ABS(r.pending_stored - r.pending_from_table);
      v_wallet_issues := v_wallet_issues || jsonb_build_object(
        'user_id', r.user_id, 'wallet_id', r.wallet_id,
        'balance_stored', r.stored, 'balance_ledger', r.from_ledger,
        'drift', r.stored - r.from_ledger,
        'pending_stored', r.pending_stored, 'pending_table', r.pending_from_table,
        'pending_drift', r.pending_stored - r.pending_from_table
      );
    ELSE
      v_wallets_ok := v_wallets_ok + 1;
    END IF;
  END LOOP;

  -- CHECK 2: cycle distributed_amount = wallet_pending(cycle) + wallet_transactions matured(cycle)
  FOR r IN
    SELECT
      ec.id, ec.year_month,
      ec.distributed_amount AS stored,
      COALESCE(SUM(wp.amount), 0) AS pending_sum,
      COALESCE(SUM(wt.amount) FILTER (WHERE wt.type = 'pool_distribution'), 0) AS matured_sum
    FROM economic_cycles ec
    LEFT JOIN wallet_pending wp ON wp.cycle_id = ec.id
    LEFT JOIN wallet_transactions wt ON wt.cycle_id = ec.id
    WHERE ec.status = 'closed'
      AND (p_period IS NULL OR ec.year_month = p_period)
    GROUP BY ec.id, ec.year_month, ec.distributed_amount
  LOOP
    IF ABS(r.stored - (r.pending_sum + r.matured_sum)) > WALLET_DRIFT_THRESHOLD THEN
      v_cycles_drift := v_cycles_drift + 1;
      v_cycle_issues := v_cycle_issues || jsonb_build_object(
        'cycle_id', r.id, 'year_month', r.year_month,
        'distributed_stored', r.stored,
        'pending', r.pending_sum, 'matured', r.matured_sum,
        'total_accounted', r.pending_sum + r.matured_sum,
        'drift', r.stored - (r.pending_sum + r.matured_sum)
      );
    ELSE
      v_cycles_ok := v_cycles_ok + 1;
    END IF;
  END LOOP;

  IF v_wallets_drift > 0 OR v_cycles_drift > 0 THEN
    v_status := CASE WHEN v_total_drift > ERROR_THRESHOLD THEN 'error' ELSE 'warning' END;
  END IF;

  v_result := jsonb_build_object(
    'status', v_status, 'period', p_period,
    'wallets_ok', v_wallets_ok, 'wallets_drift', v_wallets_drift,
    'total_drift', v_total_drift, 'cycles_ok', v_cycles_ok,
    'cycles_drift', v_cycles_drift,
    'wallet_issues', v_wallet_issues, 'cycle_issues', v_cycle_issues,
    'run_at', NOW()
  );

  INSERT INTO reconciliation_runs (
    period, wallets_ok, wallets_drift, total_drift,
    cycles_ok, cycles_drift, status, details
  ) VALUES (
    p_period, v_wallets_ok, v_wallets_drift, v_total_drift,
    v_cycles_ok, v_cycles_drift, v_status, v_result
  ) RETURNING id INTO v_run_id;

  IF v_status <> 'ok' THEN
    PERFORM pg_notify('reconciliation_alert', json_build_object(
      'run_id', v_run_id, 'status', v_status,
      'total_drift', v_total_drift, 'wallets_affected', v_wallets_drift
    )::text);
  END IF;

  RETURN v_result || jsonb_build_object('run_id', v_run_id);
END;
$$;

-- Crons
SELECT cron.schedule('classfy-mature-pending-daily', '30 6 * * *',
  $$ SELECT batch_mature_pending() $$);

SELECT cron.schedule('classfy-evaluate-qualifications-daily', '0 7 * * *',
  $$ SELECT batch_evaluate_qualifications(id) FROM economic_cycles WHERE status = 'open' $$);
;
