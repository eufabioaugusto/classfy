
-- ═══════════════════════════════════════════════════════
-- LEDGER — wallet_transactions como fonte de verdade
-- ═══════════════════════════════════════════════════════

-- 1. direction: gerado automaticamente a partir do sinal do amount
--    positivo = credit (entrada), negativo = debit (saída)
ALTER TABLE wallet_transactions
  ADD COLUMN direction text
  GENERATED ALWAYS AS (
    CASE WHEN amount > 0 THEN 'credit' ELSE 'debit' END
  ) STORED;

-- 2. amount nunca pode ser zero (transação sem valor não faz sentido)
ALTER TABLE wallet_transactions
  ADD CONSTRAINT wtx_amount_nonzero CHECK (amount <> 0);

-- 3. Trigger de imutabilidade: bloqueia UPDATE explícito
--    (CASCADE via FK de deleção de usuário ainda funciona)
CREATE OR REPLACE FUNCTION _wtx_block_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'wallet_transactions é append-only. Crie uma entrada corretiva no lugar de modificar.'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER wallet_transactions_no_update
  BEFORE UPDATE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION _wtx_block_update();

-- 4. RLS: tornar explícito que UPDATE e DELETE não são permitidos
--    (RLS já bloqueava por falta de policy, mas deixamos documentado)
CREATE POLICY "No direct updates on wallet_transactions"
  ON wallet_transactions FOR UPDATE USING (false);

CREATE POLICY "No direct deletes on wallet_transactions"
  ON wallet_transactions FOR DELETE USING (false);

-- 5. Vista de integridade do ledger
--    Mostra drift entre balance_stored (wallet) e balance_from_ledger (soma de txs)
--    Drift != 0 indica inconsistência grave
CREATE OR REPLACE VIEW v_wallet_ledger AS
SELECT
  w.user_id,
  w.id                                                    AS wallet_id,
  w.balance                                               AS balance_stored,
  COALESCE(SUM(wt.amount), 0)                             AS balance_from_ledger,
  w.balance - COALESCE(SUM(wt.amount), 0)                 AS drift,
  COUNT(wt.id)                                            AS tx_count,
  COUNT(wt.id) FILTER (WHERE wt.direction = 'credit')     AS credit_count,
  COUNT(wt.id) FILTER (WHERE wt.direction = 'debit')      AS debit_count,
  SUM(wt.amount) FILTER (WHERE wt.direction = 'credit')   AS total_credited,
  SUM(ABS(wt.amount)) FILTER (WHERE wt.direction='debit') AS total_debited,
  MAX(wt.created_at)                                      AS last_tx_at
FROM wallets w
LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
GROUP BY w.user_id, w.id, w.balance;

-- Admins podem ver a vista
ALTER VIEW v_wallet_ledger OWNER TO postgres;

COMMENT ON VIEW v_wallet_ledger IS
  'Fonte de verdade do ledger. drift != 0 indica bug ou manipulação de saldo.';
;
