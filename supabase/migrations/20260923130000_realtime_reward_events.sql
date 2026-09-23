-- Atualiza o card e a animação quando a recompensa é concedida pelo servidor
-- (inclusive Creator Points recebidos por interações de outros usuários).
-- As políticas RLS de SELECT em reward_events limitam a transmissão ao dono
-- do evento e aos administradores.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reward_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reward_events;
  END IF;
END;
$$;
