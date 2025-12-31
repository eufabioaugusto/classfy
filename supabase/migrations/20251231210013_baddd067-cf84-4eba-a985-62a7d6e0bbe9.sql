-- Fix search_path for get_study_limits function
CREATE OR REPLACE FUNCTION public.get_study_limits(p_plan plan_type)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = 'public'
AS $$
  SELECT jsonb_build_object(
    'max_studies', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 50
      ELSE 5
    END,
    'max_messages', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 200
      ELSE 30
    END,
    'max_deviations', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 20
      ELSE 3
    END
  )
$$;