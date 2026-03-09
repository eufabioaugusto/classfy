-- RPC para distribuir payout atomicamente (consolidado em uma transaction)
CREATE OR REPLACE FUNCTION public.distribute_cycle_payout(
  p_cycle_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_year_month text,
  p_user_pp numeric,
  p_total_pp numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_wallet_id uuid;
  v_percentage numeric;
BEGIN
  -- Get wallet ID
  SELECT id INTO v_wallet_id
  FROM wallets
  WHERE user_id = p_user_id;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
  END IF;

  -- Calculate percentage
  v_percentage := (p_user_pp / NULLIF(p_total_pp, 0)) * 100;

  -- Update cycle user record
  UPDATE economic_cycle_users
  SET
    calculated_share = p_amount,
    payout_status = 'paid',
    updated_at = NOW()
  WHERE cycle_id = p_cycle_id
    AND user_id = p_user_id;

  -- Increment wallet balance atomically
  UPDATE wallets
  SET
    balance = balance + p_amount,
    total_earned = total_earned + p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Insert wallet transaction
  INSERT INTO wallet_transactions (wallet_id, type, amount, description)
  VALUES (
    v_wallet_id,
    'pool_distribution',
    p_amount,
    'Distribuição do pool - ' || p_year_month
  );

  -- Insert notification
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (
    p_user_id,
    'reward',
    '💰 Recompensa Mensal!',
    'Você recebeu R$ ' || p_amount::text || ' referente ao pool de recompensas de ' || p_year_month || 
    '. Seus ' || FLOOR(p_user_pp)::text || ' pontos de performance representaram ' || 
    ROUND(v_percentage, 1)::text || '% do pool.'
  );
END;
$$;

-- RPC para carry-over de pontos não distribuídos
CREATE OR REPLACE FUNCTION public.carryover_cycle_points(
  p_from_cycle_id uuid,
  p_to_cycle_id uuid,
  p_min_payout numeric
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_user_record RECORD;
  v_count integer := 0;
BEGIN
  -- Transfer points for users below threshold
  FOR v_user_record IN
    SELECT user_id, performance_points
    FROM economic_cycle_users
    WHERE cycle_id = p_from_cycle_id
      AND performance_points > 0
      AND (calculated_share IS NULL OR calculated_share < p_min_payout)
  LOOP
    -- Add points to next cycle
    INSERT INTO economic_cycle_users (cycle_id, user_id, performance_points)
    VALUES (p_to_cycle_id, v_user_record.user_id, v_user_record.performance_points)
    ON CONFLICT (cycle_id, user_id)
    DO UPDATE SET
      performance_points = economic_cycle_users.performance_points + EXCLUDED.performance_points,
      updated_at = NOW();

    -- Mark as carried over in current cycle
    UPDATE economic_cycle_users
    SET
      payout_status = 'carried_over',
      updated_at = NOW()
    WHERE cycle_id = p_from_cycle_id
      AND user_id = v_user_record.user_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;