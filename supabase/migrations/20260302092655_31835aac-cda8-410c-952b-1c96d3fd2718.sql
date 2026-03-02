
-- Create RPC for atomic wallet balance increment
CREATE OR REPLACE FUNCTION public.increment_wallet_balance(
  p_user_id uuid,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.wallets
  SET
    balance = balance + p_amount,
    total_earned = total_earned + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;
