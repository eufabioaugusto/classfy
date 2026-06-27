CREATE TABLE IF NOT EXISTS public.app_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT,
  user_id UUID,
  session_id TEXT,
  request_id TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS app_logs_created_at_idx ON public.app_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS app_logs_source_event_idx ON public.app_logs (source, event, created_at DESC);
CREATE INDEX IF NOT EXISTS app_logs_level_idx ON public.app_logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS app_logs_user_id_idx ON public.app_logs (user_id, created_at DESC) WHERE user_id IS NOT NULL;

ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage app logs"
ON public.app_logs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can view app logs"
ON public.app_logs
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.record_app_log(
  p_level TEXT,
  p_source TEXT,
  p_event TEXT,
  p_message TEXT DEFAULT NULL,
  p_context JSONB DEFAULT '{}'::jsonb,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_session_id TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
  v_level TEXT;
BEGIN
  v_level := CASE
    WHEN p_level IN ('debug', 'info', 'warn', 'error') THEN p_level
    ELSE 'info'
  END;

  INSERT INTO public.app_logs (
    level,
    source,
    event,
    message,
    user_id,
    session_id,
    request_id,
    context,
    metadata
  )
  VALUES (
    v_level,
    left(coalesce(nullif(p_source, ''), 'unknown'), 120),
    left(coalesce(nullif(p_event, ''), 'unknown'), 160),
    left(p_message, 1000),
    auth.uid(),
    left(p_session_id, 160),
    left(p_request_id, 160),
    coalesce(p_context, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_app_log(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_app_log(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT) TO anon, authenticated, service_role;
