-- Fix security warning: set search_path for the function
DROP FUNCTION IF EXISTS public.get_daily_tracking_key(TEXT);

CREATE OR REPLACE FUNCTION public.get_daily_tracking_key(p_action_key TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p_action_key || '_' || CURRENT_DATE::TEXT
$$;