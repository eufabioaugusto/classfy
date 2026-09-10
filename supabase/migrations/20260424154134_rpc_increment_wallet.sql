
CREATE OR REPLACE FUNCTION public.increment_wallet(
  p_user_id         uuid,
  p_amount          numeric,
  p_tx_type         text,
  p_description     text       DEFAULT NULL,
  p_idempotency_key text       DEFAULT NULL,
  p_cycle_id        uuid       DEFAULT NULL,
  p_commission_id   uuid       DEFAULT NULL,
  p_stripe_event_id text       DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet wallets%ROWTYPE;
  v_tx_id  uuid;
BEGIN
  -- Idempotência: se a chave já foi processada, retorna o resultado anterior
  IF p_idempotency_key IS NOT NULL THEN
    SELECT wt.id INTO v_tx_id
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    WHERE w.user_id = p_user_id
      AND wt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN json_build_object('success', true, 'idempotent', true, 'tx_id', v_tx_id);
    END IF;
  END IF;

  -- Crédito atômico na wallet
  UPDATE wallets
  SET balance      = balance + p_amount,
      total_earned = CASE WHEN p_amount > 0 THEN total_earned + p_amount ELSE total_earned END,
      updated_at   = NOW()
  WHERE user_id = p_user_id
  RETURNING * INTO v_wallet;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found'
      USING HINT = 'Wallet não encontrada para o usuário ' || p_user_id::text;
  END IF;

  -- Registra transação com rastreabilidade completa
  INSERT INTO wallet_transactions (
    wallet_id, type, amount, description,
    idempotency_key, cycle_id, commission_id, stripe_event_id
  ) VALUES (
    v_wallet.id, p_tx_type, p_amount, p_description,
    p_idempotency_key, p_cycle_id, p_commission_id, p_stripe_event_id
  )
  RETURNING id INTO v_tx_id;

  RETURN json_build_object(
    'success',     true,
    'idempotent',  false,
    'new_balance', v_wallet.balance,
    'tx_id',       v_tx_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.increment_wallet FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_wallet TO service_role;
;
