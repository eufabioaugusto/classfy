
-- Idempotência de webhook Stripe: mesmo source_id não pode gerar 2 revenue_entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_entries_source_unique
  ON revenue_entries(source_id)
  WHERE source_id IS NOT NULL;

-- Idempotência de comissão: uma conversão só pode gerar uma comissão
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_commissions_conversion_unique
  ON referral_commissions(conversion_id);
;
