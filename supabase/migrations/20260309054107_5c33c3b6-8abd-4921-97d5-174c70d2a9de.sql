
-- Function to count distinct active days for a user in a given cycle period
CREATE OR REPLACE FUNCTION public.get_user_active_days(p_user_id UUID, p_cycle_start DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    COUNT(DISTINCT DATE(created_at))::INTEGER,
    0
  )
  FROM reward_action_tracking
  WHERE user_id = p_user_id
    AND created_at >= p_cycle_start::timestamptz
    AND created_at < (p_cycle_start + INTERVAL '1 month')::timestamptz
$$;

-- Function to get consistency multiplier based on active days
CREATE OR REPLACE FUNCTION public.get_consistency_multiplier(p_active_days INTEGER)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_active_days >= 25 THEN 1.3
    WHEN p_active_days >= 20 THEN 1.2
    WHEN p_active_days >= 15 THEN 1.1
    ELSE 1.0
  END::NUMERIC
$$;
