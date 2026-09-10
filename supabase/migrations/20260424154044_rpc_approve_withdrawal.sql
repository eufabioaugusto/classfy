
CREATE OR REPLACE FUNCTION public.approve_withdrawal(
  p_request_id  uuid,
  p_admin_id    uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req    withdraw_requests%ROWTYPE;
  v_wallet wallets%ROWTYPE;
BEGIN
  -- 1. Atualiza o withdraw_request de 'pending' → 'approved' atomicamente.
  --    Se já foi aprovado/rejeitado, RETURNING não retorna nada → exception.
  UPDATE withdraw_requests
  SET status      = 'approved',
      approved_by = p_admin_id,
      approved_at = NOW(),
      admin_notes = p_admin_notes
  WHERE id = p_request_id
    AND status = 'pending'
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_already_processed'
      USING HINT = 'O saque já foi aprovado, rejeitado ou não existe.';
  END IF;

  -- 2. Débito atômico: UPDATE só executa se balance >= amount.
  --    O CHECK wallets_balance_nonneg é belt-and-suspenders adicional.
  UPDATE wallets
  SET balance          = balance - v_req.amount,
      total_withdrawn  = total_withdrawn + v_req.amount,
      updated_at       = NOW()
  WHERE user_id = v_req.user_id
    AND balance >= v_req.amount
  RETURNING * INTO v_wallet;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_balance'
      USING HINT = 'Saldo insuficiente na carteira do usuário.';
  END IF;

  -- 3. Registra transação com FK para o withdraw_request (rastreabilidade).
  INSERT INTO wallet_transactions (
    wallet_id, type, amount, description, withdraw_request_id
  ) VALUES (
    v_wallet.id,
    'withdraw',
    -v_req.amount,
    'Saque aprovado - R$ ' || v_req.amount::text,
    v_req.id
  );

  -- 4. Notificação para o usuário.
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (
    v_req.user_id,
    'withdraw',
    'Saque Aprovado!',
    'Seu saque de R$ ' || v_req.amount::text || ' foi aprovado. Chave Pix: ' || v_req.pix_key
  );

  RETURN json_build_object(
    'success',      true,
    'new_balance',  v_wallet.balance,
    'amount',       v_req.amount,
    'pix_key',      v_req.pix_key
  );
END;
$$;

-- Permissão: só admins e service_role podem chamar
REVOKE ALL ON FUNCTION public.approve_withdrawal FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal TO service_role;
;
