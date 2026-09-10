
-- Adicionar FKs nullable para rastreabilidade de origem de cada transação
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS withdraw_request_id uuid REFERENCES withdraw_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cycle_id            uuid REFERENCES economic_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_id       uuid REFERENCES referral_commissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_event_id     text,
  ADD COLUMN IF NOT EXISTS idempotency_key     text;

-- UNIQUE parcial: quando idempotency_key estiver preenchido, garante que a transação não duplica
CREATE UNIQUE INDEX IF NOT EXISTS idx_wtx_idempotency_key
  ON wallet_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
;
