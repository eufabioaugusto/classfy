-- Contratos de consumo e recompensa da Economia Classfy V1.
--
-- Regras consolidadas nesta migration:
-- 1. Shorts sao publicos para descoberta, mas nunca geram recompensa.
-- 2. Progresso de curso e registrado por aula, no servidor, sem reutilizar
--    user_progress (que referencia exclusivamente public.contents).
-- 3. Aulas novas de curso podem usar o pipeline privado de media_assets.

ALTER TABLE public.course_lessons
  ADD COLUMN IF NOT EXISTS media_asset_id uuid
  REFERENCES public.media_assets(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS course_lessons_media_asset_unique
  ON public.course_lessons(media_asset_id)
  WHERE media_asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.course_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  watched_seconds integer NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  last_position_seconds integer NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS course_lesson_progress_user_course_idx
  ON public.course_lesson_progress(user_id, course_id);

ALTER TABLE public.course_lesson_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own course lesson progress" ON public.course_lesson_progress;
CREATE POLICY "Users view own course lesson progress"
  ON public.course_lesson_progress FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Escrita somente pela RPC abaixo: o cliente nao pode declarar conclusao.
REVOKE INSERT, UPDATE, DELETE ON public.course_lesson_progress FROM anon, authenticated;
GRANT SELECT ON public.course_lesson_progress TO authenticated;

CREATE TABLE IF NOT EXISTS public.content_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.contents(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('native', 'copy', 'direct_message')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(content_id, course_id) = 1)
);

CREATE INDEX IF NOT EXISTS content_shares_user_target_idx
  ON public.content_shares(user_id, content_id, course_id);

ALTER TABLE public.content_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users record own shares" ON public.content_shares;
CREATE POLICY "Users record own shares"
  ON public.content_shares FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users view own shares" ON public.content_shares;
CREATE POLICY "Users view own shares"
  ON public.content_shares FOR SELECT TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT, INSERT ON public.content_shares TO authenticated;

-- Progresso de conteudo passa a ser server-managed. O cliente envia somente
-- deltas curtos; o banco valida acesso, cadencia e calcula a porcentagem.
ALTER TABLE public.user_progress
  ADD COLUMN IF NOT EXISTS watched_seconds integer NOT NULL DEFAULT 0
  CHECK (watched_seconds >= 0);

ALTER TABLE public.content_views
  ADD COLUMN IF NOT EXISTS hidden_from_history_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_content_progress_v1(
  p_content_id uuid,
  p_watched_delta integer,
  p_last_position_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_content public.contents%ROWTYPE;
  v_plan text := 'free';
  v_has_access boolean := false;
  v_previous public.user_progress%ROWTYPE;
  v_previous_watched integer := 0;
  v_allowed_delta integer := 0;
  v_total_watched integer := 0;
  v_position integer := GREATEST(0, COALESCE(p_last_position_seconds, 0));
  v_progress integer := 0;
  v_new_view boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_content FROM public.contents WHERE id = p_content_id;
  IF NOT FOUND OR v_content.status <> 'approved' THEN RAISE EXCEPTION 'content_not_available'; END IF;
  IF v_content.content_type = 'short' THEN RAISE EXCEPTION 'shorts_do_not_track_economic_progress'; END IF;

  SELECT COALESCE(plan::text, 'free') INTO v_plan
  FROM public.profiles WHERE id = v_user_id;

  v_has_access :=
    v_content.creator_id = v_user_id
    OR public.has_role(v_user_id, 'admin'::public.app_role)
    OR v_content.visibility = 'free'
    OR (v_content.visibility = 'pro' AND v_plan IN ('pro', 'premium'))
    OR (v_content.visibility = 'premium' AND v_plan = 'premium')
    OR (
      v_content.visibility = 'paid'
      AND EXISTS (
        SELECT 1 FROM public.purchased_contents pc
        WHERE pc.content_id = v_content.id
          AND pc.user_id = v_user_id
          AND pc.status IN ('confirmed', 'legacy_confirmed')
      )
    );
  IF NOT v_has_access THEN RAISE EXCEPTION 'content_access_required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_content.id::text, 0));

  SELECT * INTO v_previous
  FROM public.user_progress
  WHERE user_id = v_user_id AND content_id = v_content.id
  FOR UPDATE;

  IF FOUND THEN
    v_previous_watched := GREATEST(0, COALESCE(v_previous.watched_seconds, 0));
    v_allowed_delta := LEAST(
      LEAST(10, GREATEST(0, COALESCE(p_watched_delta, 0))),
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(v_previous.updated_at, now()))))::integer
      )
    );
  ELSE
    v_allowed_delta := LEAST(8, GREATEST(0, COALESCE(p_watched_delta, 0)));
  END IF;

  v_total_watched := v_previous_watched + v_allowed_delta;
  IF COALESCE(v_content.duration_seconds, 0) > 0 THEN
    v_total_watched := LEAST(v_total_watched, v_content.duration_seconds);
    v_position := LEAST(v_position, v_content.duration_seconds);
    v_progress := LEAST(100, FLOOR(v_total_watched::numeric * 100 / v_content.duration_seconds)::integer);
    IF v_total_watched >= GREATEST(1, v_content.duration_seconds - 2) THEN
      v_progress := 100;
    END IF;
  END IF;

  INSERT INTO public.user_progress (
    user_id, content_id, watched_seconds, last_position_seconds, progress_percent,
    completed, completed_at, updated_at
  ) VALUES (
    v_user_id, v_content.id, v_total_watched, v_position, v_progress,
    v_progress = 100, CASE WHEN v_progress = 100 THEN now() ELSE NULL END, now()
  )
  ON CONFLICT (user_id, content_id) DO UPDATE SET
    watched_seconds = EXCLUDED.watched_seconds,
    last_position_seconds = EXCLUDED.last_position_seconds,
    progress_percent = GREATEST(user_progress.progress_percent, EXCLUDED.progress_percent),
    completed = user_progress.completed OR EXCLUDED.completed,
    completed_at = CASE
      WHEN user_progress.completed_at IS NOT NULL THEN user_progress.completed_at
      WHEN EXCLUDED.completed THEN now()
      ELSE NULL
    END,
    updated_at = now();

  INSERT INTO public.content_views (
    user_id, content_id, view_date, view_count, total_watch_time_seconds,
    first_viewed_at, last_viewed_at, updated_at
  ) VALUES (
    v_user_id, v_content.id, current_date, 1, v_allowed_delta,
    now(), now(), now()
  )
  ON CONFLICT (user_id, content_id, view_date) DO UPDATE SET
    total_watch_time_seconds = COALESCE(content_views.total_watch_time_seconds, 0) + EXCLUDED.total_watch_time_seconds,
    last_viewed_at = now(),
    hidden_from_history_at = NULL,
    updated_at = now()
  RETURNING (xmax = 0) INTO v_new_view;

  IF v_new_view AND v_user_id <> v_content.creator_id THEN
    UPDATE public.contents
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = v_content.id;
  END IF;

  RETURN jsonb_build_object(
    'content_id', v_content.id,
    'accepted_watched_delta', v_allowed_delta,
    'total_watched_seconds', v_total_watched,
    'progress_percent', v_progress,
    'completed', v_progress = 100
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_content_progress_v1(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_content_progress_v1(uuid, integer, integer)
  TO authenticated;

DROP POLICY IF EXISTS "Users can manage own progress" ON public.user_progress;
DROP POLICY IF EXISTS "Users can insert own progress" ON public.user_progress;
DROP POLICY IF EXISTS "Users can update own progress" ON public.user_progress;
REVOKE INSERT, UPDATE, DELETE ON public.user_progress FROM authenticated;

-- A evidencia de tempo nao pode ser escrita diretamente, senao o cliente
-- conseguiria fabricar VIEW_15S e os milestones de conclusao.
DROP POLICY IF EXISTS "System can insert views" ON public.content_views;
DROP POLICY IF EXISTS "System can update views" ON public.content_views;
DROP POLICY IF EXISTS "Users can update own content views" ON public.content_views;
REVOKE INSERT, UPDATE, DELETE ON public.content_views FROM anon, authenticated;

-- Abertura da pagina registra audiencia, mas nao pode ser usada para contar
-- views em nome de terceiros nem em conteudo ao qual o usuario nao tem acesso.
-- Shorts aprovados sao a excecao publica intencional.
CREATE OR REPLACE FUNCTION public.increment_content_view(
  p_user_id uuid,
  p_content_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_content public.contents%ROWTYPE;
  v_plan text := 'free';
  v_has_access boolean := false;
  v_is_new boolean := false;
BEGIN
  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'user_identity_mismatch';
  END IF;

  SELECT * INTO v_content FROM public.contents WHERE id = p_content_id;
  IF NOT FOUND OR v_content.status <> 'approved' THEN
    RAISE EXCEPTION 'content_not_available';
  END IF;

  IF auth.role() = 'service_role' OR v_content.content_type = 'short' THEN
    v_has_access := true;
  ELSE
    SELECT COALESCE(plan::text, 'free') INTO v_plan
    FROM public.profiles WHERE id = p_user_id;
    v_has_access :=
      v_content.creator_id = p_user_id
      OR public.has_role(p_user_id, 'admin'::public.app_role)
      OR v_content.visibility = 'free'
      OR (v_content.visibility = 'pro' AND v_plan IN ('pro', 'premium'))
      OR (v_content.visibility = 'premium' AND v_plan = 'premium')
      OR (
        v_content.visibility = 'paid'
        AND EXISTS (
          SELECT 1 FROM public.purchased_contents pc
          WHERE pc.content_id = v_content.id
            AND pc.user_id = p_user_id
            AND pc.status IN ('confirmed', 'legacy_confirmed')
        )
      );
  END IF;
  IF NOT v_has_access THEN RAISE EXCEPTION 'content_access_required'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_content.id::text || ':' || current_date::text, 0)
  );
  INSERT INTO public.content_views (user_id, content_id, view_date, view_count)
  VALUES (p_user_id, v_content.id, current_date, 1)
  ON CONFLICT (user_id, content_id, view_date) DO UPDATE SET
    view_count = content_views.view_count + 1,
    last_viewed_at = now(),
    hidden_from_history_at = NULL,
    updated_at = now()
  RETURNING (xmax = 0) INTO v_is_new;

  IF v_is_new AND p_user_id <> v_content.creator_id THEN
    UPDATE public.contents
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = v_content.id;
  END IF;

  RETURN jsonb_build_object(
    'is_new_view', v_is_new AND p_user_id <> v_content.creator_id,
    'reward_excluded', v_content.content_type = 'short'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.increment_content_view(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_content_view(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.increment_course_view(
  p_user_id uuid,
  p_course_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course public.courses%ROWTYPE;
  v_plan text := 'free';
  v_has_access boolean := false;
  v_is_new boolean := false;
BEGIN
  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'user_identity_mismatch';
  END IF;

  SELECT * INTO v_course FROM public.courses WHERE id = p_course_id;
  IF NOT FOUND OR v_course.status <> 'approved' THEN
    RAISE EXCEPTION 'course_not_available';
  END IF;

  IF auth.role() = 'service_role' THEN
    v_has_access := true;
  ELSE
    SELECT COALESCE(plan::text, 'free') INTO v_plan
    FROM public.profiles WHERE id = p_user_id;
    v_has_access :=
      v_course.creator_id = p_user_id
      OR public.has_role(p_user_id, 'admin'::public.app_role)
      OR v_course.visibility = 'free'
      OR (v_course.visibility = 'pro' AND v_plan IN ('pro', 'premium'))
      OR (v_course.visibility = 'premium' AND v_plan = 'premium')
      OR (
        v_course.visibility = 'paid'
        AND EXISTS (
          SELECT 1 FROM public.course_enrollments ce
          WHERE ce.course_id = v_course.id AND ce.user_id = p_user_id
        )
      );
  END IF;
  IF NOT v_has_access THEN RAISE EXCEPTION 'course_access_required'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_course.id::text || ':' || current_date::text, 0)
  );
  UPDATE public.content_views
  SET view_count = content_views.view_count + 1,
      last_viewed_at = now(),
      hidden_from_history_at = NULL,
      updated_at = now()
  WHERE user_id = p_user_id
    AND course_id = v_course.id
    AND view_date = current_date;

  IF NOT FOUND THEN
    INSERT INTO public.content_views (user_id, course_id, view_date, view_count)
    VALUES (p_user_id, v_course.id, current_date, 1);
    v_is_new := true;
  END IF;

  IF v_is_new AND p_user_id <> v_course.creator_id THEN
    UPDATE public.courses
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = v_course.id;
  END IF;

  RETURN jsonb_build_object(
    'is_new_view', v_is_new AND p_user_id <> v_course.creator_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.increment_course_view(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_course_view(uuid, uuid)
  TO authenticated, service_role;

-- Limpar o historico oculta a linha da experiencia do usuario sem apagar a
-- evidencia economica/analitica. O alvo e sempre derivado de auth.uid().
CREATE OR REPLACE FUNCTION public.delete_own_content_history_v1(
  p_view_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_deleted integer := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  UPDATE public.content_views
  SET hidden_from_history_at = now()
  WHERE user_id = v_user_id
    AND (p_view_id IS NULL OR id = p_view_id)
    AND hidden_from_history_at IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('hidden', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_content_history_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_content_history_v1(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.record_course_lesson_progress_v1(
  p_lesson_id uuid,
  p_watched_seconds integer,
  p_last_position_seconds integer,
  p_progress_percent integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_lesson public.course_lessons%ROWTYPE;
  v_course public.courses%ROWTYPE;
  v_plan text := 'free';
  v_has_access boolean := false;
  v_has_full_access boolean := false;
  v_progress integer := 0;
  v_watched_delta integer := LEAST(10, GREATEST(0, COALESCE(p_watched_seconds, 0)));
  v_watched integer := 0;
  v_position integer := GREATEST(0, COALESCE(p_last_position_seconds, 0));
  v_previous_watched integer := 0;
  v_previous_updated_at timestamptz;
  v_allowed_delta integer := 0;
  v_completed_ids uuid[] := ARRAY[]::uuid[];
  v_total_lessons integer := 0;
  v_course_percent integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  SELECT * INTO v_lesson FROM public.course_lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lesson_not_found'; END IF;

  SELECT * INTO v_course FROM public.courses WHERE id = v_lesson.course_id;
  IF NOT FOUND OR v_course.status <> 'approved' THEN
    RAISE EXCEPTION 'course_not_available';
  END IF;

  SELECT COALESCE(plan::text, 'free') INTO v_plan
  FROM public.profiles WHERE id = v_user_id;

  v_has_full_access :=
    v_course.creator_id = v_user_id
    OR public.has_role(v_user_id, 'admin'::public.app_role)
    OR v_course.visibility = 'free'
    OR (v_course.visibility = 'pro' AND v_plan IN ('pro', 'premium'))
    OR (v_course.visibility = 'premium' AND v_plan = 'premium')
    OR (
      v_course.visibility = 'paid'
      AND EXISTS (
        SELECT 1 FROM public.course_enrollments ce
        WHERE ce.course_id = v_course.id AND ce.user_id = v_user_id
      )
    );
  v_has_access := v_has_full_access OR v_lesson.is_preview = true;

  IF NOT v_has_access THEN RAISE EXCEPTION 'course_access_required'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_lesson.id::text, 0)
  );

  -- O cliente envia apenas o incremento realmente assistido desde o ultimo
  -- checkpoint. A porcentagem recebida nao e confiavel e e ignorada.
  SELECT watched_seconds, updated_at
  INTO v_previous_watched, v_previous_updated_at
  FROM public.course_lesson_progress
  WHERE user_id = v_user_id AND lesson_id = v_lesson.id
  FOR UPDATE;

  IF FOUND THEN
    v_allowed_delta := LEAST(
      v_watched_delta,
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(v_previous_updated_at, now()))))::integer
      )
    );
  ELSE
    -- Primeiro checkpoint do player acontece depois de alguns segundos.
    v_allowed_delta := LEAST(v_watched_delta, 8);
  END IF;

  v_watched := COALESCE(v_previous_watched, 0) + v_allowed_delta;
  IF COALESCE(v_lesson.duration_seconds, 0) > 0 THEN
    v_watched := LEAST(v_watched, v_lesson.duration_seconds);
    v_position := LEAST(v_position, v_lesson.duration_seconds);
    v_progress := LEAST(
      100,
      FLOOR(v_watched::numeric * 100 / v_lesson.duration_seconds)::integer
    );
    IF v_watched >= GREATEST(1, v_lesson.duration_seconds - 2) THEN
      v_progress := 100;
    END IF;
  END IF;

  INSERT INTO public.course_lesson_progress (
    user_id, course_id, lesson_id, watched_seconds, last_position_seconds, progress_percent,
    completed, completed_at
  ) VALUES (
    v_user_id, v_course.id, v_lesson.id, v_watched, v_position, v_progress,
    v_progress = 100, CASE WHEN v_progress = 100 THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    watched_seconds = EXCLUDED.watched_seconds,
    last_position_seconds = EXCLUDED.last_position_seconds,
    progress_percent = GREATEST(course_lesson_progress.progress_percent, EXCLUDED.progress_percent),
    completed = course_lesson_progress.completed OR EXCLUDED.completed,
    completed_at = CASE
      WHEN course_lesson_progress.completed_at IS NOT NULL THEN course_lesson_progress.completed_at
      WHEN EXCLUDED.completed THEN now()
      ELSE NULL
    END,
    updated_at = now();

  -- Uma aula de preview pode ser consumida, mas nunca cria a inscricao que
  -- desbloqueia o restante de um curso pago nem conclui o curso.
  IF NOT v_has_full_access THEN
    RETURN jsonb_build_object(
      'course_id', v_course.id,
      'lesson_id', v_lesson.id,
      'accepted_watched_delta', v_allowed_delta,
      'lesson_progress_percent', v_progress,
      'lesson_completed', v_progress = 100,
      'completed_lessons', 0,
      'total_lessons', 0,
      'course_progress_percent', 0,
      'course_completed', false,
      'preview_only', true
    );
  END IF;

  SELECT COALESCE(array_agg(clp.lesson_id ORDER BY clp.lesson_id), ARRAY[]::uuid[])
  INTO v_completed_ids
  FROM public.course_lesson_progress clp
  WHERE clp.user_id = v_user_id
    AND clp.course_id = v_course.id
    AND clp.completed = true;

  SELECT count(*) INTO v_total_lessons
  FROM public.course_lessons WHERE course_id = v_course.id;

  v_course_percent := CASE
    WHEN v_total_lessons = 0 THEN 0
    ELSE LEAST(100, floor(cardinality(v_completed_ids)::numeric * 100 / v_total_lessons)::integer)
  END;

  INSERT INTO public.course_enrollments (
    course_id, user_id, progress_percent, completed_lessons,
    last_lesson_id, completed_at
  ) VALUES (
    v_course.id, v_user_id, v_course_percent, v_completed_ids,
    v_lesson.id, CASE WHEN v_course_percent = 100 THEN now() ELSE NULL END
  )
  ON CONFLICT (course_id, user_id) DO UPDATE SET
    progress_percent = EXCLUDED.progress_percent,
    completed_lessons = EXCLUDED.completed_lessons,
    last_lesson_id = EXCLUDED.last_lesson_id,
    completed_at = CASE
      WHEN course_enrollments.completed_at IS NOT NULL THEN course_enrollments.completed_at
      WHEN EXCLUDED.progress_percent = 100 THEN now()
      ELSE NULL
    END;

  RETURN jsonb_build_object(
    'course_id', v_course.id,
    'lesson_id', v_lesson.id,
    'accepted_watched_delta', v_allowed_delta,
    'lesson_progress_percent', v_progress,
    'lesson_completed', v_progress = 100,
    'completed_lessons', cardinality(v_completed_ids),
    'total_lessons', v_total_lessons,
    'course_progress_percent', v_course_percent,
    'course_completed', v_course_percent = 100
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_course_lesson_progress_v1(uuid, integer, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_course_lesson_progress_v1(uuid, integer, integer, integer)
  TO authenticated;

-- course_enrollments tambem e estado de entitlement. Escrita direta permitiria
-- que um usuario se matriculasse sozinho em curso pago e liberasse as aulas.
DROP POLICY IF EXISTS "Users can enroll in courses" ON public.course_enrollments;
DROP POLICY IF EXISTS "Users can update own enrollments" ON public.course_enrollments;
REVOKE INSERT, UPDATE, DELETE ON public.course_enrollments FROM anon, authenticated;

-- Metadados publicos e estritamente limitados para a experiencia de Shorts.
-- A RPC evita reabrir a tabela profiles (que contem dados operacionais).
CREATE OR REPLACE FUNCTION public.get_public_shorts_v1(
  p_short_id uuid DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  video_url text,
  thumbnail_url text,
  file_url text,
  visibility public.content_visibility,
  price numeric,
  duration_seconds integer,
  views_count integer,
  likes_count integer,
  creator_id uuid,
  video_provider text,
  bunny_video_id text,
  bunny_library_id text,
  bunny_hls_url text,
  media_asset_id uuid,
  creator jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.title, c.description, c.video_url, c.thumbnail_url, c.file_url,
    c.visibility, c.price, c.duration_seconds, c.views_count, c.likes_count,
    c.creator_id, c.video_provider, c.bunny_video_id, c.bunny_library_id,
    c.bunny_hls_url, c.media_asset_id,
    jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'creator_channel_name', p.creator_channel_name
    ) AS creator
  FROM public.contents c
  JOIN public.profiles p ON p.id = c.creator_id
  WHERE c.content_type = 'short'
    AND c.status = 'approved'
  ORDER BY CASE WHEN c.id = p_short_id THEN 0 ELSE 1 END, c.views_count DESC, c.created_at DESC
  OFFSET GREATEST(0, p_offset)
  LIMIT LEAST(50, GREATEST(1, p_limit));
$$;

REVOKE ALL ON FUNCTION public.get_public_shorts_v1(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_shorts_v1(uuid, integer, integer) TO anon, authenticated;

-- Views anonimas de Shorts sao deduplicadas por dia e por identificador local
-- pseudonimizado. Elas alimentam descoberta, mas nunca criam eventos economicos.
CREATE TABLE IF NOT EXISTS public.anonymous_short_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  viewer_hash text NOT NULL,
  view_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, viewer_hash, view_date)
);

ALTER TABLE public.anonymous_short_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.anonymous_short_views FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_public_short_view_v1(
  p_content_id uuid,
  p_viewer_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_inserted boolean := false;
BEGIN
  IF p_viewer_token IS NULL OR length(p_viewer_token) < 20 OR length(p_viewer_token) > 200 THEN
    RAISE EXCEPTION 'invalid_viewer_token';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contents
    WHERE id = p_content_id AND content_type = 'short' AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'short_not_available';
  END IF;

  v_hash := md5(p_viewer_token);
  INSERT INTO public.anonymous_short_views (content_id, viewer_hash)
  VALUES (p_content_id, v_hash)
  ON CONFLICT (content_id, viewer_hash, view_date) DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE public.contents
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = p_content_id;
  END IF;

  RETURN jsonb_build_object('is_new_view', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_public_short_view_v1(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_public_short_view_v1(uuid, text)
  TO anon, authenticated;

-- Corrige o RLS das aulas: planos PRO/Premium nao dependem de uma inscricao
-- criada previamente, enquanto curso pago continua exigindo enrollment.
DROP POLICY IF EXISTS "Lessons viewable with purchase check" ON public.course_lessons;
DROP POLICY IF EXISTS "Lessons viewable with entitlement" ON public.course_lessons;
CREATE POLICY "Lessons viewable with entitlement"
  ON public.course_lessons FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.courses c
      LEFT JOIN public.profiles p ON p.id = auth.uid()
      WHERE c.id = course_lessons.course_id
        AND (
          c.creator_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR (
            c.status = 'approved'
            AND (
              c.visibility = 'free'
              OR course_lessons.is_preview = true
              OR (c.visibility = 'pro' AND p.plan::text IN ('pro', 'premium'))
              OR (c.visibility = 'premium' AND p.plan::text = 'premium')
              OR (
                c.visibility = 'paid'
                AND EXISTS (
                  SELECT 1 FROM public.course_enrollments ce
                  WHERE ce.course_id = c.id AND ce.user_id = auth.uid()
                )
              )
            )
          )
        )
    )
  );

-- A aprovacao continua sendo a fonte oficial das recompensas de publicacao,
-- mas Shorts nao entram nem em CONTENT_APPROVED nem em FIRST_UPLOAD.
CREATE OR REPLACE FUNCTION public.approve_content_v1(
  p_item_id uuid, p_item_type text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_creator uuid; v_title text; v_content_type text; v_old_status text;
  v_creator_status public.creator_status; v_has_role boolean; v_cycle uuid;
  v_cfg public.reward_actions_config%ROWTYPE; v_first_cfg public.reward_actions_config%ROWTYPE;
  v_approved_count integer; v_reward jsonb; v_first_reward jsonb;
  v_tracking_content uuid; v_rewards_enabled boolean := true;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_item_type NOT IN ('content','course') THEN RAISE EXCEPTION 'invalid_item_type'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_item_type='content' THEN
    SELECT creator_id,title,content_type,status INTO v_creator,v_title,v_content_type,v_old_status
    FROM public.contents WHERE id=p_item_id FOR UPDATE;
    v_tracking_content:=p_item_id;
  ELSE
    SELECT creator_id,title,NULL::text,status INTO v_creator,v_title,v_content_type,v_old_status
    FROM public.courses WHERE id=p_item_id FOR UPDATE;
    v_tracking_content:=NULL;
  END IF;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  SELECT creator_status INTO v_creator_status FROM public.profiles WHERE id=v_creator;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_creator AND role='creator') INTO v_has_role;
  IF v_creator_status<>'approved' OR NOT v_has_role THEN RAISE EXCEPTION 'approved_creator_required'; END IF;

  IF v_old_status='approved' THEN
    RETURN jsonb_build_object('success',true,'idempotent',true,'creator_id',v_creator,
      'title',v_title,'content_type',v_content_type,'points',0,'first_upload_points',0);
  END IF;
  IF p_item_type='content' THEN
    UPDATE public.contents SET status='approved',published_at=now() WHERE id=p_item_id;
  ELSE
    UPDATE public.courses SET status='approved',published_at=now() WHERE id=p_item_id;
  END IF;

  v_rewards_enabled := NOT (p_item_type='content' AND v_content_type='short');
  IF v_rewards_enabled THEN
    PERFORM set_config('classfy.authorized_reward_operation','on',true);
    SELECT public.get_or_create_current_cycle() INTO v_cycle;
    SELECT * INTO v_cfg FROM public.reward_actions_config WHERE action_key='CONTENT_APPROVED' AND active;
    IF FOUND THEN
      SELECT public.commit_reward_award(v_creator,'CONTENT_APPROVED_'||p_item_type||'_'||p_item_id::text,
        v_tracking_content,jsonb_build_object('source','admin_approval','item_type',p_item_type),v_cycle,
        jsonb_build_object('user_id',v_creator,'content_id',v_tracking_content,
          'action_key','CONTENT_APPROVED','points',v_cfg.points_creator,
          'cycle_points',v_cfg.points_creator,'point_type','creator',
          'metadata',jsonb_build_object('activation',true,'item_type',p_item_type,
            'item_id',p_item_id,'title',v_title)),NULL) INTO v_reward;
    END IF;

    SELECT count(*) INTO v_approved_count FROM (
      SELECT id FROM public.contents
      WHERE creator_id=v_creator AND status='approved' AND content_type<>'short'
      UNION ALL SELECT id FROM public.courses
      WHERE creator_id=v_creator AND status='approved'
    ) approved_items;
    IF v_approved_count=1 THEN
      SELECT * INTO v_first_cfg FROM public.reward_actions_config WHERE action_key='FIRST_UPLOAD' AND active;
      IF FOUND THEN
        SELECT public.commit_reward_award(v_creator,'FIRST_UPLOAD',NULL,
          jsonb_build_object('source','first_approved_upload'),v_cycle,
          jsonb_build_object('user_id',v_creator,'action_key','FIRST_UPLOAD',
            'points',v_first_cfg.points_creator,'cycle_points',v_first_cfg.points_creator,
            'point_type','creator','metadata',jsonb_build_object('activation',true,
              'item_type',p_item_type,'item_id',p_item_id,'title',v_title)),NULL) INTO v_first_reward;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.notifications(user_id,type,title,message,related_content_id)
  VALUES (v_creator,'admin',CASE WHEN p_item_type='course' THEN 'Curso aprovado!' ELSE 'Conteudo aprovado!' END,
    'Seu '||CASE WHEN p_item_type='course' THEN 'curso' ELSE 'conteudo' END||' "'||v_title||
    '" foi aprovado e publicado.',CASE WHEN p_item_type='content' THEN p_item_id ELSE NULL END);
  INSERT INTO public.economic_admin_audit(admin_id,action,entity_type,entity_id,reason,old_value,new_value)
  VALUES (auth.uid(),'approve',p_item_type,p_item_id::text,btrim(p_reason),
    jsonb_build_object('status',v_old_status),jsonb_build_object('status','approved','creator_id',v_creator,
      'economic_rewards_enabled',v_rewards_enabled,
      'content_reward',v_reward,'first_upload_reward',v_first_reward));
  RETURN jsonb_build_object('success',true,'idempotent',false,'creator_id',v_creator,
    'title',v_title,'content_type',v_content_type,
    'points',CASE WHEN NOT v_rewards_enabled OR COALESCE((v_reward->>'already_tracked')::boolean,false)
      THEN 0 ELSE COALESCE(v_cfg.points_creator,0) END,
    'first_upload_points',CASE WHEN NOT v_rewards_enabled OR COALESCE((v_first_reward->>'already_tracked')::boolean,false)
      THEN 0 ELSE COALESCE(v_first_cfg.points_creator,0) END,
    'reward_excluded',NOT v_rewards_enabled,
    'monthly_limit_reached',false);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_content_v1(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_v1(uuid,text,text) TO authenticated;

-- Reverter um like remove os pontos do ciclo aberto, mas preserva o tracking
-- como tombstone. Assim desfazer/refazer a mesma acao nao pode gerar Points em
-- loop. Cursos usam course_id nos metadados do ledger.
CREATE TABLE IF NOT EXISTS public.reward_event_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_reward_event_id uuid NOT NULL UNIQUE,
  affected_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  initiated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  reason text NOT NULL,
  event_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reward_event_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own reward reversals" ON public.reward_event_reversals;
CREATE POLICY "Users view own reward reversals"
  ON public.reward_event_reversals FOR SELECT TO authenticated
  USING (affected_user_id = auth.uid() OR initiated_by = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.reward_event_reversals FROM anon, authenticated;
GRANT SELECT ON public.reward_event_reversals TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_reward_award(
  p_user_id uuid,
  p_content_id uuid,
  p_action_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward public.reward_events%ROWTYPE;
  v_creator public.reward_events%ROWTYPE;
  v_tracking_key text := p_action_key || '_' || p_content_id::text;
  v_cycle_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;

  -- A retirada do like e a eventual reversao economica acontecem na mesma
  -- transacao. Isso evita o estado impossivel "Points removidos, like ativo".
  DELETE FROM public.actions
  WHERE user_id = p_user_id
    AND type = 'LIKE'
    AND (content_id = p_content_id OR course_id = p_content_id);

  SELECT * INTO v_reward
  FROM public.reward_events
  WHERE user_id = p_user_id
    AND action_key = p_action_key
    AND COALESCE(metadata->>'as_creator', 'false') <> 'true'
    AND (content_id = p_content_id OR metadata->>'course_id' = p_content_id::text)
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('reversed', false); END IF;
  SELECT status INTO v_cycle_status FROM public.economic_cycles WHERE id = v_reward.cycle_id;
  IF v_cycle_status IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object('reversed', false, 'cycle_closed', true);
  END IF;

  SELECT * INTO v_creator
  FROM public.reward_events
  WHERE related_user_id = p_user_id
    AND action_key = p_action_key
    AND metadata->>'as_creator' = 'true'
    AND metadata->>'tracking_key' = v_tracking_key
    AND (content_id = p_content_id OR metadata->>'course_id' = p_content_id::text)
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  DELETE FROM public.reward_events WHERE id = v_reward.id;
  UPDATE public.economic_cycle_users
  SET performance_points = GREATEST(0, performance_points - COALESCE(v_reward.performance_points, 0)),
      user_points = GREATEST(0, user_points - CASE WHEN v_reward.point_type='user'
        THEN COALESCE(v_reward.cycle_points, 0) ELSE 0 END),
      creator_points = GREATEST(0, creator_points - CASE WHEN v_reward.point_type='creator'
        THEN COALESCE(v_reward.cycle_points, 0) ELSE 0 END),
      cycle_points = GREATEST(0, cycle_points - COALESCE(v_reward.cycle_points, 0)),
      updated_at = now()
  WHERE cycle_id = v_reward.cycle_id AND user_id = v_reward.user_id;

  IF v_creator.id IS NOT NULL THEN
    INSERT INTO public.reward_event_reversals(
      original_reward_event_id, affected_user_id, initiated_by,
      action_key, reason, event_snapshot
    ) VALUES (
      v_creator.id, v_creator.user_id, p_user_id,
      p_action_key, 'source_action_reversed', to_jsonb(v_creator)
    ) ON CONFLICT (original_reward_event_id) DO NOTHING;

    DELETE FROM public.reward_events WHERE id = v_creator.id;
    UPDATE public.economic_cycle_users
    SET performance_points = GREATEST(0, performance_points - COALESCE(v_creator.performance_points, 0)),
        user_points = GREATEST(0, user_points - CASE WHEN v_creator.point_type='user'
          THEN COALESCE(v_creator.cycle_points, 0) ELSE 0 END),
        creator_points = GREATEST(0, creator_points - CASE WHEN v_creator.point_type='creator'
          THEN COALESCE(v_creator.cycle_points, 0) ELSE 0 END),
        cycle_points = GREATEST(0, cycle_points - COALESCE(v_creator.cycle_points, 0)),
        updated_at = now()
    WHERE cycle_id = v_creator.cycle_id AND user_id = v_creator.user_id;
  END IF;

  INSERT INTO public.reward_event_reversals(
    original_reward_event_id, affected_user_id, initiated_by,
    action_key, reason, event_snapshot
  ) VALUES (
    v_reward.id, v_reward.user_id, p_user_id,
    p_action_key, 'source_action_reversed', to_jsonb(v_reward)
  ) ON CONFLICT (original_reward_event_id) DO NOTHING;

  UPDATE public.reward_action_tracking
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'reversed', true,
    'reversed_at', now()
  )
  WHERE user_id = p_user_id AND action_key = v_tracking_key;

  RETURN jsonb_build_object(
    'reversed', true,
    'performance_points_reverted', COALESCE(v_reward.performance_points, 0),
    'creator_pp_reverted', COALESCE(v_creator.performance_points, 0),
    'points', COALESCE(v_reward.points, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_reward_award(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_reward_award(uuid, uuid, text) TO service_role;
