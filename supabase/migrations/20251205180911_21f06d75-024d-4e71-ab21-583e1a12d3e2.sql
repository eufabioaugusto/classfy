-- Fix 1: Restrict message_settings visibility with a secure function
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Users can view others settings for privacy check" ON public.message_settings;

-- Create a secure function to check if a user can message another user
CREATE OR REPLACE FUNCTION public.check_can_message(target_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      WHEN ms.privacy_mode IS NULL THEN 'open'
      ELSE ms.privacy_mode
    END
  FROM message_settings ms
  WHERE ms.user_id = target_user_id
  UNION ALL
  SELECT 'open'
  LIMIT 1
$$;