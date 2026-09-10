
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
  v_rows_updated int;
  v_percentage   numeric;
  v_idem_key     text;
BEGIN
  -- Guard de idempotência: se já foi pago para este user neste ciclo, não faz nada
  UPDATE economic_cycle_users
  SET calculated_share = p_amount,
      payout_status    = 'paid',
      updated_at       = NOW()
  WHERE cycle_id = p_cycle_id
    AND user_id   = p_user_id
    AND payout_status != 'paid'   -- idempotência: só atualiza se ainda não pago
  ;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Se 0 rows afetadas, esse user já recebeu → sai sem crédito duplicado
  IF v_rows_updated = 0 THEN
    RETURN;
  END IF;

  v_percentage  := (p_user_pp / NULLIF(p_total_pp, 0)) * 100;
  v_idem_key    := 'pool_dist_' || p_cycle_id::text || '_' || p_user_id::text;

  -- Crédito atômico via increment_wallet com idempotency_key
  PERFORM increment_wallet(
    p_user_id         := p_user_id,
    p_amount          := p_amount,
    p_tx_type         := 'pool_distribution',
    p_description     := 'Distribuição do pool - ' || p_year_month,
    p_idempotency_key := v_idem_key,
    p_cycle_id        := p_cycle_id
  );

  -- Notificação
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (
    p_user_id,
    'reward',
    '💰 Recompensa Mensal!',
    'Você recebeu R$ ' || p_amount::text || ' do pool de ' || p_year_month ||
    '. Seus ' || FLOOR(p_user_pp)::text || ' PP representaram ' ||
    ROUND(v_percentage, 1)::text || '% do pool.'
  );
END;
$$;
;
