-- Beta live diagnostics: media and chat timing only, without message content.
CREATE TABLE public.live_diagnostic_sessions (
  session_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  live_id uuid NOT NULL REFERENCES public.lives(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('host', 'viewer')),
  route text NOT NULL CHECK (route IN ('waiting', 'webrtc', 'hls', 'replay', 'ended')),
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX live_diagnostic_sessions_live_created_idx
  ON public.live_diagnostic_sessions (live_id, created_at DESC);

ALTER TABLE public.live_diagnostic_sessions ENABLE ROW LEVEL SECURITY;
-- No browser-facing policy: authenticated uploads are validated by live-control.
