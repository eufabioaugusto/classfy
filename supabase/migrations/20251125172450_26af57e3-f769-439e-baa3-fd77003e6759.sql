-- Create helper function to create or get a direct message conversation between two users
CREATE OR REPLACE FUNCTION public.create_or_get_conversation(
  p_user1_id uuid,
  p_user2_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  -- First, try to find an existing conversation that already has both participants
  SELECT c.id
  INTO v_conversation_id
  FROM conversations c
  JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = p_user1_id
  JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = p_user2_id
  LIMIT 1;

  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  -- No existing conversation, create a new one
  INSERT INTO conversations DEFAULT VALUES
  RETURNING id INTO v_conversation_id;

  -- Add both participants to the conversation
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES
    (v_conversation_id, p_user1_id),
    (v_conversation_id, p_user2_id);

  RETURN v_conversation_id;
END;
$$;