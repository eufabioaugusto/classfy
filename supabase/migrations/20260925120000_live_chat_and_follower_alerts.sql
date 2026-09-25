-- Host chat control must also be enforced for direct database clients.
DROP POLICY IF EXISTS "Usuários autenticados podem enviar mensagens" ON public.live_messages;
CREATE POLICY "Participantes podem conversar enquanto o chat estiver ativo"
ON public.live_messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.lives
    WHERE id = live_id AND status IN ('waiting', 'live') AND chat_enabled IS TRUE
  )
);

ALTER TABLE public.lives ADD COLUMN IF NOT EXISTS followers_notified_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS related_live_id uuid REFERENCES public.lives(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.protect_live_follower_notice()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.followers_notified_at IS DISTINCT FROM OLD.followers_notified_at THEN
    RAISE EXCEPTION 'follower_notice_is_server_only';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_live_follower_notice
BEFORE UPDATE ON public.lives
FOR EACH ROW EXECUTE FUNCTION public.protect_live_follower_notice();

-- A row lock makes concurrent clicks a single notification batch.
CREATE OR REPLACE FUNCTION public.notify_live_followers(p_live_id uuid, p_creator_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live public.lives%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO v_live FROM public.lives WHERE id = p_live_id FOR UPDATE;
  IF NOT FOUND OR v_live.creator_id <> p_creator_id OR v_live.status <> 'live' THEN
    RAISE EXCEPTION 'Live unavailable';
  END IF;
  IF v_live.followers_notified_at IS NOT NULL THEN
    RETURN -1;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_live_id)
  SELECT f.follower_id, 'live', 'Live no ar', left(coalesce(p.display_name, 'Um creator que você segue') || ' está ao vivo: ' || v_live.title, 300), p_live_id
  FROM public.follows f
  LEFT JOIN public.profiles p ON p.id = p_creator_id
  WHERE f.following_id = p_creator_id AND f.follower_id <> p_creator_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.lives SET followers_notified_at = now() WHERE id = p_live_id;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_live_followers(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_live_followers(uuid, uuid) TO service_role;
