-- Create a helper function to fully delete a conversation when a user chooses to excluir
CREATE OR REPLACE FUNCTION public.delete_conversation_for_user(p_conversation_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_is_participant boolean;
BEGIN
  -- Only allow if the caller is a participant of the conversation
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id
  ) INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'User % is not a participant of conversation %', p_user_id, p_conversation_id;
  END IF;

  -- Delete all messages of this conversation
  DELETE FROM messages
  WHERE conversation_id = p_conversation_id;

  -- Delete all participants rows
  DELETE FROM conversation_participants
  WHERE conversation_id = p_conversation_id;

  -- Finally delete the conversation itself
  DELETE FROM conversations
  WHERE id = p_conversation_id;
END;
$$;