
-- 1. wallets: remover UPDATE direto por usuário
--    (toda mutação de saldo agora passa por approve_withdrawal ou increment_wallet via service_role)
DROP POLICY IF EXISTS "Users can update own wallet" ON wallets;

-- 2. economic_cycle_users: remover INSERT/UPDATE universais
--    (só admins via UI ou service_role via RPC podem escrever)
DROP POLICY IF EXISTS "System can upsert cycle users" ON economic_cycle_users;
DROP POLICY IF EXISTS "System can update cycle users" ON economic_cycle_users;

-- 3. reward_events: remover INSERT universal
--    (só edge functions com service_role inserem reward_events)
DROP POLICY IF EXISTS "System can insert reward events" ON reward_events;

-- 4. revenue_entries: trocar INSERT universal por INSERT restrito a admins
--    (AdminRewards.tsx insere aportes manuais de pool — só admin pode)
DROP POLICY IF EXISTS "System can insert revenue entries" ON revenue_entries;
CREATE POLICY "Admins can insert revenue entries"
  ON revenue_entries FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 5. reward_action_tracking: remover INSERT universal
--    (só edge functions com service_role inserem tracking)
DROP POLICY IF EXISTS "System can insert tracking" ON reward_action_tracking;
;
