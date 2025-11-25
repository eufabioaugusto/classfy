-- Corrigir wallets com saques aprovados que não foram debitados
-- Atualiza o balance e total_withdrawn baseado nos saques aprovados

UPDATE wallets w
SET 
  balance = w.balance - COALESCE((
    SELECT SUM(wr.amount)
    FROM withdraw_requests wr
    WHERE wr.user_id = w.user_id 
    AND wr.status = 'approved'
    AND NOT EXISTS (
      -- Verifica se já foi contabilizado comparando total_withdrawn com soma de aprovados
      SELECT 1 
      WHERE w.total_withdrawn >= (
        SELECT COALESCE(SUM(amount), 0) 
        FROM withdraw_requests 
        WHERE user_id = w.user_id AND status = 'approved'
      )
    )
  ), 0),
  total_withdrawn = w.total_withdrawn + COALESCE((
    SELECT SUM(wr.amount)
    FROM withdraw_requests wr
    WHERE wr.user_id = w.user_id 
    AND wr.status = 'approved'
    AND NOT EXISTS (
      -- Verifica se já foi contabilizado
      SELECT 1 
      WHERE w.total_withdrawn >= (
        SELECT COALESCE(SUM(amount), 0) 
        FROM withdraw_requests 
        WHERE user_id = w.user_id AND status = 'approved'
      )
    )
  ), 0),
  updated_at = now()
WHERE EXISTS (
  -- Só atualiza se houver saques aprovados não contabilizados
  SELECT 1
  FROM withdraw_requests wr
  WHERE wr.user_id = w.user_id 
  AND wr.status = 'approved'
  AND w.total_withdrawn < (
    SELECT COALESCE(SUM(amount), 0) 
    FROM withdraw_requests 
    WHERE user_id = w.user_id AND status = 'approved'
  )
);