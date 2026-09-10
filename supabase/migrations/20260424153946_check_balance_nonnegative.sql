
-- wallets não pode ter saldo negativo
ALTER TABLE wallets
  ADD CONSTRAINT wallets_balance_nonneg
    CHECK (balance >= 0) NOT VALID;
ALTER TABLE wallets VALIDATE CONSTRAINT wallets_balance_nonneg;

ALTER TABLE wallets
  ADD CONSTRAINT wallets_total_earned_nonneg
    CHECK (total_earned >= 0) NOT VALID;
ALTER TABLE wallets VALIDATE CONSTRAINT wallets_total_earned_nonneg;

-- economic_cycle_users PP não pode ser negativo
ALTER TABLE economic_cycle_users
  ADD CONSTRAINT ecu_performance_points_nonneg
    CHECK (performance_points >= 0) NOT VALID;
ALTER TABLE economic_cycle_users VALIDATE CONSTRAINT ecu_performance_points_nonneg;
;
