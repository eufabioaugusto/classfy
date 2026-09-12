-- Mensagens da Classy passam a ser registradas exclusivamente pela Edge Function.
-- O limite do estudo contabiliza somente as mensagens enviadas pelo estudante.

CREATE OR REPLACE FUNCTION public.increment_study_message_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'user' THEN
    UPDATE public.studies
    SET message_count = COALESCE(message_count, 0) + 1
    WHERE id = NEW.study_id;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.studies AS study
SET message_count = (
  SELECT COUNT(*)::integer
  FROM public.study_messages AS message
  WHERE message.study_id = study.id
    AND message.role = 'user'
);

DROP POLICY IF EXISTS "Users can create messages in own studies"
ON public.study_messages;

CREATE POLICY "Users can create user messages in own studies"
ON public.study_messages
FOR INSERT
WITH CHECK (
  role = 'user'
  AND EXISTS (
    SELECT 1
    FROM public.studies
    WHERE studies.id = study_messages.study_id
      AND studies.user_id = auth.uid()
  )
);
