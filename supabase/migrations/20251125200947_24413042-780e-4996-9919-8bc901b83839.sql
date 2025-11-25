-- Function to let recipient approve or reject message requests, bypassing RLS on messages
CREATE OR REPLACE FUNCTION public.respond_message_request(
  p_conversation_id uuid,
  p_approved boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_recipient_id uuid := auth.uid();
  v_sender_id uuid;
  v_is_participant boolean;
BEGIN
  -- Ensure caller is participant of the conversation
  SELECT is_conversation_participant(p_conversation_id, v_recipient_id)
  INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'User % is not a participant of conversation %', v_recipient_id, p_conversation_id;
  END IF;

  -- Find the other participant (the original sender whose requests we're responding to)
  SELECT user_id INTO v_sender_id
  FROM conversation_participants
  WHERE conversation_id = p_conversation_id
    AND user_id <> v_recipient_id
  LIMIT 1;

  IF v_sender_id IS NULL THEN
    RETURN;
  END IF;

  IF p_approved THEN
    UPDATE messages
    SET request_status = 'approved'
    WHERE conversation_id = p_conversation_id
      AND sender_id = v_sender_id
      AND is_request = true;
  ELSE
    UPDATE messages
    SET request_status = 'rejected'
    WHERE conversation_id = p_conversation_id
      AND sender_id = v_sender_id
      AND is_request = true;
  END IF;
END;
$$;