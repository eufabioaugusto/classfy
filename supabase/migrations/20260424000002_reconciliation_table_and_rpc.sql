
-- Tabela de logs de reconciliação financeira
CREATE TABLE public.reconciliation_runs (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at         timestamptz   NOT NULL DEFAULT NOW(),
  period         text,
  wallets_ok     int           NOT NULL DEFAULT 0,
  wallets_drift  int           NOT NULL DEFAULT 0,
  total_drift    numeric(10,4) NOT NULL DEFAULT 0,
  cycles_ok      int           NOT NULL DEFAULT 0,
  cycles_drift   int           NOT NULL DEFAULT 0,
  status         text          NOT NULL CHECK (status IN ('ok', 'warning', 'error')),
  details        jsonb         NOT NULL DEFAULT '{}',
  created_at     timestamptz   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage reconciliation runs"
  ON public.reconciliation_runs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_reconciliation_runs_status
  ON reconciliation_runs(status, run_at DESC);

COMMENT ON TABLE reconciliation_runs IS
  'Log de cada execução de reconciliação. status=error = divergência > R$1,00.';

-- RPC principal de reconciliação
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
  FOR r IN
    SELECT
      w.user_id, w.id AS wallet_id, w.balance AS stored,
      COALESCE(SUM(wt.amount), 0) AS from_ledger
    FROM wallets w
    LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
    GROUP BY w.user_id, w.id, w.balance
  LOOP
    IF ABS(r.stored - r.from_ledger) > WALLET_DRIFT_THRESHOLD THEN
      v_wallets_drift := v_wallets_drift + 1;
      v_total_drift   := v_total_drift + ABS(r.stored - r.from_ledger);
      v_wallet_issues := v_wallet_issues || jsonb_build_object(
        'user_id', r.user_id, 'wallet_id', r.wallet_id,
        'balance_stored', r.stored, 'balance_ledger', r.from_ledger,
        'drift', r.stored - r.from_ledger
      );
    ELSE
      v_wallets_ok := v_wallets_ok + 1;
    END IF;
  END LOOP;

  -- CHECK 2: economic_cycles.distributed_amount = SUM(pool_distribution txs)
  FOR r IN
    SELECT
      ec.id, ec.year_month,
      ec.distributed_amount AS stored,
      COALESCE(SUM(wt.amount), 0) AS from_txs,
      ec.distributed_amount - COALESCE(SUM(wt.amount), 0) AS drift
    FROM economic_cycles ec
    LEFT JOIN wallet_transactions wt
      ON wt.cycle_id = ec.id AND wt.type = 'pool_distribution'
    WHERE ec.status = 'closed'
      AND (p_period IS NULL OR ec.year_month = p_period)
    GROUP BY ec.id, ec.year_month, ec.distributed_amount
  LOOP
    IF ABS(r.drift) > WALLET_DRIFT_THRESHOLD THEN
      v_cycles_drift := v_cycles_drift + 1;
      v_cycle_issues := v_cycle_issues || jsonb_build_object(
        'cycle_id', r.id, 'year_month', r.year_month,
        'distributed_stored', r.stored, 'distributed_from_txs', r.from_txs,
        'drift', r.drift
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

REVOKE ALL ON FUNCTION public.run_reconciliation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_reconciliation TO service_role;

-- Cron diário às 03:00 Brasília (06:00 UTC)
SELECT cron.schedule(
  'classfy-reconciliation-daily',
  '0 6 * * *',
  $$ SELECT run_reconciliation() $$
);
