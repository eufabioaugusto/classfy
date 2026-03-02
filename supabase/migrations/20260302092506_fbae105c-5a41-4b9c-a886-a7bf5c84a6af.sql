
-- Create RPC for atomic increment of cycle user points
CREATE OR REPLACE FUNCTION public.increment_cycle_user_points(
  p_cycle_id uuid,
  p_user_id uuid,
  p_points numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.economic_cycle_users (cycle_id, user_id, performance_points)
  VALUES (p_cycle_id, p_user_id, p_points)
  ON CONFLICT (cycle_id, user_id)
  DO UPDATE SET
    performance_points = economic_cycle_users.performance_points + p_points,
    updated_at = NOW();
END;
$$;

-- Fix PROFILE_COMPLETE points_creator to 0
UPDATE public.reward_actions_config
SET points_creator = 0, updated_at = NOW()
WHERE action_key = 'PROFILE_COMPLETE';
