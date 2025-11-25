-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;

-- Create a security definer function to check if user is in conversation
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM conversation_participants
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id
  )
$$;

-- Recreate the policy using the function
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants
FOR SELECT
USING (
  public.is_conversation_participant(conversation_id, auth.uid())
);