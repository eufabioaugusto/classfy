-- wallets: saldo em maturação
ALTER TABLE wallets ADD COLUMN pending_balance DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE wallets ADD CONSTRAINT wallets_pending_nonneg CHECK (pending_balance >= 0);

-- Tabela de saldo pendente de maturação
CREATE TABLE public.wallet_pending (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       uuid          NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id         uuid          NOT NULL,
  amount          DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  source_type     text          NOT NULL,
  cycle_id        uuid          REFERENCES economic_cycles(id) ON DELETE SET NULL,
  idempotency_key text          UNIQUE,
  mature_at       timestamptz   NOT NULL,
  matured_at      timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wallet_pending_due    ON wallet_pending(mature_at) WHERE matured_at IS NULL;
CREATE INDEX idx_wallet_pending_user   ON wallet_pending(user_id);
CREATE INDEX idx_wallet_pending_wallet ON wallet_pending(wallet_id);
ALTER TABLE public.wallet_pending ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own pending" ON wallet_pending FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage pending"  ON wallet_pending FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- economic_cycle_users: colunas de qualificação
ALTER TABLE economic_cycle_users
  ADD COLUMN qualified_for_pool         boolean     NOT NULL DEFAULT false,
  ADD COLUMN qualification_points       numeric     NOT NULL DEFAULT 0,
  ADD COLUMN qualification_details      jsonb       NOT NULL DEFAULT '{}',
  ADD COLUMN qualification_evaluated_at timestamptz;

-- Expandir platform_settings.economic com defaults
UPDATE platform_settings
SET value = value || jsonb_build_object(
  'min_payout', 0.10,
  'plan_config', jsonb_build_object(
    'free',    jsonb_build_object('multiplier', 0.1,  'maturation_days', 60, 'qualification_threshold', 60),
    'pro',     jsonb_build_object('multiplier', 1.0,  'maturation_days', 10, 'qualification_threshold', 40),
    'premium', jsonb_build_object('multiplier', 1.5,  'maturation_days', 2,  'qualification_threshold', 20)
  ),
  'checkpoints', jsonb_build_object(
    'share_content',     jsonb_build_object('qp_per_action', 3,  'max_qp', 15),
    'referral_signup',   jsonb_build_object('qp_per_action', 25, 'max_qp', 75),
    'referral_upgrade',  jsonb_build_object('qp_per_action', 50, 'max_qp', 100),
    'subscription_paid', jsonb_build_object('qp', 20),
    'boost_purchased',   jsonb_build_object('qp', 30),
    'content_purchased', jsonb_build_object('qp', 15),
    'active_days',       jsonb_build_object('required_days', 15, 'qp', 15),
    'content_completed', jsonb_build_object('required_count', 5,  'qp', 10),
    'engagement',        jsonb_build_object('required_count', 20, 'qp', 10)
  )
)
WHERE key = 'economic';
