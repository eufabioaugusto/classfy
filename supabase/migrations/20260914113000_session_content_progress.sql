-- Progresso economico por sessao.
--
-- A versao anterior limitava cada checkpoint pelo FLOOR do tempo decorrido
-- desde user_progress.updated_at. Como o timestamp era renovado em toda
-- chamada, fracoes validas eram descartadas e o ultimo checkpoint podia
-- terminar abaixo de 100%, mesmo quando a midia chegava ao fim.
--
-- A sessao abaixo mantem um saldo fracionario de tempo entre checkpoints e
-- recebe um total cumulativo. Isso torna retries idempotentes e permite somar
-- reproducoes legitimas realizadas em momentos diferentes.

CREATE TABLE IF NOT EXISTS public.content_watch_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  reported_watched_seconds integer NOT NULL DEFAULT 0,
  accepted_watched_seconds integer NOT NULL DEFAULT 0,
  available_seconds numeric(12, 3) NOT NULL DEFAULT 8,
  last_position_seconds integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_checkpoint_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_watch_sessions_reported_nonnegative
    CHECK (reported_watched_seconds >= 0),
  CONSTRAINT content_watch_sessions_accepted_nonnegative
    CHECK (accepted_watched_seconds >= 0),
  CONSTRAINT content_watch_sessions_accepted_not_above_reported
    CHECK (accepted_watched_seconds <= reported_watched_seconds),
  CONSTRAINT content_watch_sessions_available_nonnegative
    CHECK (available_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS idx_content_watch_sessions_user_content
  ON public.content_watch_sessions(user_id, content_id, started_at DESC);

ALTER TABLE public.content_watch_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.content_watch_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_content_progress_v2(
  p_content_id uuid,
  p_session_id uuid,
  p_session_watched_seconds integer,
  p_last_position_seconds integer,
  p_is_ended boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_content public.contents%ROWTYPE;
  v_plan text := 'free';
  v_has_access boolean := false;
  v_session public.content_watch_sessions%ROWTYPE;
  v_previous public.user_progress%ROWTYPE;
  v_previous_watched integer := 0;
  v_reported integer := GREATEST(0, COALESCE(p_session_watched_seconds, 0));
  v_session_accepted integer := 0;
  v_pending integer := 0;
  v_allowed_delta integer := 0;
  v_elapsed numeric := 0;
  v_budget numeric := 8;
  v_total_watched integer := 0;
  v_position integer := GREATEST(0, COALESCE(p_last_position_seconds, 0));
  v_progress integer := 0;
  v_completed boolean := false;
  v_natural_end boolean := false;
  v_new_view boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_session_id IS NULL THEN RAISE EXCEPTION 'watch_session_required'; END IF;

  SELECT * INTO v_content
  FROM public.contents
  WHERE id = p_content_id;

  IF NOT FOUND OR v_content.status <> 'approved' THEN
    RAISE EXCEPTION 'content_not_available';
  END IF;
  IF v_content.content_type = 'short' THEN
    RAISE EXCEPTION 'shorts_do_not_track_economic_progress';
  END IF;

  SELECT COALESCE(plan::text, 'free') INTO v_plan
  FROM public.profiles
  WHERE id = v_user_id;

  v_has_access :=
    v_content.creator_id = v_user_id
    OR public.has_role(v_user_id, 'admin'::public.app_role)
    OR v_content.visibility = 'free'
    OR (v_content.visibility = 'pro' AND v_plan IN ('pro', 'premium'))
    OR (v_content.visibility = 'premium' AND v_plan = 'premium')
    OR (
      v_content.visibility = 'paid'
      AND EXISTS (
        SELECT 1
        FROM public.purchased_contents pc
        WHERE pc.content_id = v_content.id
          AND pc.user_id = v_user_id
          AND pc.status IN ('confirmed', 'legacy_confirmed')
      )
    );
  IF NOT v_has_access THEN RAISE EXCEPTION 'content_access_required'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_content.id::text, 0)
  );

  SELECT * INTO v_session
  FROM public.content_watch_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_session.user_id <> v_user_id OR v_session.content_id <> v_content.id THEN
      RAISE EXCEPTION 'watch_session_mismatch';
    END IF;

    -- Uma chamada final repetida deve ser segura, mas uma sessao encerrada nao
    -- pode continuar acumulando novos segundos.
    IF v_session.ended_at IS NOT NULL
       AND v_reported > v_session.reported_watched_seconds THEN
      RAISE EXCEPTION 'watch_session_closed';
    END IF;

    v_reported := GREATEST(v_session.reported_watched_seconds, v_reported);
    v_session_accepted := v_session.accepted_watched_seconds;
    v_elapsed := LEAST(
      15::numeric,
      GREATEST(
        0::numeric,
        EXTRACT(EPOCH FROM (v_now - v_session.last_checkpoint_at))::numeric
      )
    );
    -- O saldo nao utilizado e as fracoes atravessam checkpoints. O teto evita
    -- que uma pausa longa crie credito de tempo ilimitado na sessao.
    v_budget := LEAST(15::numeric, v_session.available_seconds + v_elapsed);
  END IF;

  v_pending := GREATEST(0, v_reported - v_session_accepted);
  v_allowed_delta := LEAST(
    10,
    v_pending,
    GREATEST(0, FLOOR(v_budget)::integer)
  );

  IF COALESCE(v_content.duration_seconds, 0) > 0 THEN
    v_position := LEAST(v_position, v_content.duration_seconds);
    v_natural_end := COALESCE(p_is_ended, false)
      AND v_position >= GREATEST(1, v_content.duration_seconds - 2);
  END IF;

  -- O evento ended pode acontecer uma fracao antes do proximo segundo cheio.
  -- A tolerancia terminal e limitada a dois segundos e exige posicao final.
  IF v_natural_end
     AND v_pending - v_allowed_delta BETWEEN 1 AND 2 THEN
    v_allowed_delta := v_allowed_delta + (v_pending - v_allowed_delta);
  END IF;

  v_session_accepted := v_session_accepted + v_allowed_delta;
  v_budget := GREATEST(0::numeric, v_budget - v_allowed_delta);

  IF FOUND THEN
    UPDATE public.content_watch_sessions
    SET reported_watched_seconds = v_reported,
        accepted_watched_seconds = v_session_accepted,
        available_seconds = v_budget,
        last_position_seconds = v_position,
        last_checkpoint_at = v_now,
        ended_at = CASE
          WHEN COALESCE(p_is_ended, false) THEN COALESCE(ended_at, v_now)
          ELSE ended_at
        END,
        updated_at = v_now
    WHERE id = p_session_id;
  ELSE
    INSERT INTO public.content_watch_sessions (
      id, user_id, content_id, reported_watched_seconds,
      accepted_watched_seconds, available_seconds, last_position_seconds,
      started_at, last_checkpoint_at, ended_at, created_at, updated_at
    ) VALUES (
      p_session_id, v_user_id, v_content.id, v_reported,
      v_session_accepted, v_budget, v_position,
      v_now, v_now,
      CASE WHEN COALESCE(p_is_ended, false) THEN v_now ELSE NULL END,
      v_now, v_now
    );
  END IF;

  SELECT * INTO v_previous
  FROM public.user_progress
  WHERE user_id = v_user_id
    AND content_id = v_content.id
  FOR UPDATE;

  IF FOUND THEN
    v_previous_watched := GREATEST(0, COALESCE(v_previous.watched_seconds, 0));
  END IF;

  v_total_watched := v_previous_watched + v_allowed_delta;
  IF COALESCE(v_content.duration_seconds, 0) > 0 THEN
    v_total_watched := LEAST(v_total_watched, v_content.duration_seconds);
    v_progress := LEAST(
      100,
      FLOOR(v_total_watched::numeric * 100 / v_content.duration_seconds)::integer
    );
    IF v_total_watched >= GREATEST(1, v_content.duration_seconds - 2) THEN
      v_progress := 100;
    END IF;
  END IF;

  IF FOUND THEN
    v_progress := GREATEST(v_progress, COALESCE(v_previous.progress_percent, 0));
    v_completed := COALESCE(v_previous.completed, false) OR v_progress = 100;
  ELSE
    v_completed := v_progress = 100;
  END IF;

  INSERT INTO public.user_progress (
    user_id, content_id, watched_seconds, last_position_seconds,
    progress_percent, completed, completed_at, updated_at
  ) VALUES (
    v_user_id, v_content.id, v_total_watched, v_position,
    v_progress, v_completed,
    CASE WHEN v_completed THEN v_now ELSE NULL END,
    v_now
  )
  ON CONFLICT (user_id, content_id) DO UPDATE SET
    watched_seconds = EXCLUDED.watched_seconds,
    last_position_seconds = EXCLUDED.last_position_seconds,
    progress_percent = GREATEST(user_progress.progress_percent, EXCLUDED.progress_percent),
    completed = user_progress.completed OR EXCLUDED.completed,
    completed_at = CASE
      WHEN user_progress.completed_at IS NOT NULL THEN user_progress.completed_at
      WHEN EXCLUDED.completed THEN v_now
      ELSE NULL
    END,
    updated_at = v_now;

  INSERT INTO public.content_views (
    user_id, content_id, view_date, view_count, total_watch_time_seconds,
    first_viewed_at, last_viewed_at, updated_at
  ) VALUES (
    v_user_id, v_content.id, current_date, 1, v_allowed_delta,
    v_now, v_now, v_now
  )
  ON CONFLICT (user_id, content_id, view_date) DO UPDATE SET
    total_watch_time_seconds = COALESCE(content_views.total_watch_time_seconds, 0)
      + EXCLUDED.total_watch_time_seconds,
    last_viewed_at = v_now,
    hidden_from_history_at = NULL,
    updated_at = v_now
  RETURNING (xmax = 0) INTO v_new_view;

  IF v_new_view AND v_user_id <> v_content.creator_id THEN
    UPDATE public.contents
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = v_content.id;
  END IF;

  RETURN jsonb_build_object(
    'content_id', v_content.id,
    'session_id', p_session_id,
    'accepted_watched_delta', v_allowed_delta,
    'session_accepted_watched_seconds', v_session_accepted,
    'total_watched_seconds', v_total_watched,
    'progress_percent', v_progress,
    'completed', v_completed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_content_progress_v2(
  uuid, uuid, integer, integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_content_progress_v2(
  uuid, uuid, integer, integer, boolean
) TO authenticated;
