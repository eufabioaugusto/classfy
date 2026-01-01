-- Fix linter: set immutable search_path on function
CREATE OR REPLACE FUNCTION public.is_content_boosted(p_content_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.boosts
    WHERE content_id = p_content_id
      AND status = 'active'
      AND start_date <= NOW()
      AND end_date >= NOW()
  )
$$;