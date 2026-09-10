
-- Corrigir CHECK de status em economic_cycles para incluir 'distributing' e 'distribution_failed'
ALTER TABLE economic_cycles DROP CONSTRAINT economic_cycles_status_check;
ALTER TABLE economic_cycles ADD CONSTRAINT economic_cycles_status_check
  CHECK (status IN ('open', 'distributing', 'closed', 'distribution_failed'));

-- Corrigir CHECK de payout_status em economic_cycle_users para incluir 'carried_over'
ALTER TABLE economic_cycle_users DROP CONSTRAINT economic_cycle_users_payout_status_check;
ALTER TABLE economic_cycle_users ADD CONSTRAINT economic_cycle_users_payout_status_check
  CHECK (payout_status IN ('pending', 'paid', 'failed', 'carried_over'));

-- Remover constraint UNIQUE duplicada (ficou duplicada de migrations anteriores)
ALTER TABLE economic_cycle_users DROP CONSTRAINT IF EXISTS economic_cycle_users_cycle_id_user_id_key;
;
