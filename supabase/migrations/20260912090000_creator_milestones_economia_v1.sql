-- Conquistas de creator integradas a Economia Classfy V1.
-- O historico anterior e preservado apenas como reconhecimento, sem retroativo.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Remove duplicidades e o modelo financeiro legado
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE milestone_duplicates ON COMMIT DROP AS
SELECT id AS duplicate_id, canonical_id
FROM (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY milestone_type, milestone_value
      ORDER BY created_at, id
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY milestone_type, milestone_value
      ORDER BY created_at, id
    ) AS row_number
  FROM public.creator_milestones
) ranked
WHERE row_number > 1;

INSERT INTO public.creator_milestone_progress (
  creator_id, milestone_id, current_value, completed_at, claimed, claimed_at,
  created_at, updated_at
)
SELECT
  progress.creator_id,
  duplicates.canonical_id,
  max(progress.current_value),
  min(progress.completed_at),
  bool_or(progress.claimed),
  max(progress.claimed_at),
  min(progress.created_at),
  max(progress.updated_at)
FROM public.creator_milestone_progress progress
JOIN milestone_duplicates duplicates
  ON duplicates.duplicate_id = progress.milestone_id
GROUP BY progress.creator_id, duplicates.canonical_id
ON CONFLICT (creator_id, milestone_id) DO UPDATE SET
  current_value = GREATEST(
    public.creator_milestone_progress.current_value,
    EXCLUDED.current_value
  ),
  completed_at = COALESCE(
    LEAST(public.creator_milestone_progress.completed_at, EXCLUDED.completed_at),
    public.creator_milestone_progress.completed_at,
    EXCLUDED.completed_at
  ),
  claimed = public.creator_milestone_progress.claimed OR EXCLUDED.claimed,
  claimed_at = COALESCE(
    GREATEST(public.creator_milestone_progress.claimed_at, EXCLUDED.claimed_at),
    public.creator_milestone_progress.claimed_at,
    EXCLUDED.claimed_at
  ),
  updated_at = now();

DELETE FROM public.creator_milestone_progress progress
USING milestone_duplicates duplicates
WHERE progress.milestone_id = duplicates.duplicate_id;

DELETE FROM public.creator_milestones milestone
USING milestone_duplicates duplicates
WHERE milestone.id = duplicates.duplicate_id;

-- As duas metas de engajamento prometiam uma janela de 30 dias que nunca foi
-- comprovada pelo backend. Elas saem antes de qualquer premio economico novo.
DELETE FROM public.creator_milestones
WHERE milestone_type = 'engagement';

CREATE UNIQUE INDEX IF NOT EXISTS creator_milestones_type_value_unique
  ON public.creator_milestones (milestone_type, milestone_value);

ALTER TABLE public.creator_milestones
  ADD COLUMN IF NOT EXISTS reward_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rewards_started_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.creator_milestones
  DROP CONSTRAINT IF EXISTS creator_milestones_reward_points_nonnegative;
ALTER TABLE public.creator_milestones
  ADD CONSTRAINT creator_milestones_reward_points_nonnegative
  CHECK (reward_points >= 0);

-- Valores novos e proporcionais a Economia V1. Nenhum valor antigo e copiado.
UPDATE public.creator_milestones
SET reward_points = CASE
      WHEN milestone_type = 'contents' AND milestone_value = 10 THEN 20
      WHEN milestone_type = 'contents' AND milestone_value = 50 THEN 50
      WHEN milestone_type = 'contents' AND milestone_value = 100 THEN 100
      WHEN milestone_type = 'contents' AND milestone_value = 200 THEN 200
      WHEN milestone_type = 'contents' AND milestone_value = 500 THEN 500
      WHEN milestone_type = 'followers' AND milestone_value = 100 THEN 20
      WHEN milestone_type = 'followers' AND milestone_value = 500 THEN 50
      WHEN milestone_type = 'followers' AND milestone_value = 1000 THEN 100
      WHEN milestone_type = 'followers' AND milestone_value = 5000 THEN 250
      WHEN milestone_type = 'followers' AND milestone_value = 10000 THEN 500
      WHEN milestone_type = 'earnings' AND milestone_value = 500 THEN 20
      WHEN milestone_type = 'earnings' AND milestone_value = 2000 THEN 50
      WHEN milestone_type = 'earnings' AND milestone_value = 10000 THEN 100
      WHEN milestone_type = 'earnings' AND milestone_value = 50000 THEN 250
      WHEN milestone_type = 'earnings' AND milestone_value = 100000 THEN 500
      WHEN milestone_type = 'views' AND milestone_value = 1000 THEN 20
      WHEN milestone_type = 'views' AND milestone_value = 10000 THEN 75
      WHEN milestone_type = 'views' AND milestone_value = 100000 THEN 250
      WHEN milestone_type = 'views' AND milestone_value = 1000000 THEN 1000
      ELSE 0
    END,
    reward_enabled = true,
    rewards_started_at = now(),
    updated_at = now();

ALTER TABLE public.creator_milestone_progress
  ADD COLUMN IF NOT EXISTS reward_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reward_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_event_id uuid REFERENCES public.reward_events(id) ON DELETE SET NULL;

ALTER TABLE public.creator_milestone_progress
  DROP CONSTRAINT IF EXISTS creator_milestone_progress_reward_status_check;
ALTER TABLE public.creator_milestone_progress
  ADD CONSTRAINT creator_milestone_progress_reward_status_check
  CHECK (reward_status IN ('pending', 'awarded', 'legacy_ignored', 'disabled'));
ALTER TABLE public.creator_milestone_progress
  DROP CONSTRAINT IF EXISTS creator_milestone_progress_reward_points_nonnegative;
ALTER TABLE public.creator_milestone_progress
  ADD CONSTRAINT creator_milestone_progress_reward_points_nonnegative
  CHECK (reward_points >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS creator_milestone_progress_reward_event_unique
  ON public.creator_milestone_progress (reward_event_id)
  WHERE reward_event_id IS NOT NULL;

-- Remove todos os campos que pertenciam aos motores anteriores.
ALTER TABLE public.creator_milestones
  DROP COLUMN IF EXISTS legacy_points_reward,
  DROP COLUMN IF EXISTS legacy_value_reward,
  DROP COLUMN IF EXISTS points_reward,
  DROP COLUMN IF EXISTS value_reward,
  DROP COLUMN IF EXISTS awards_points;

DROP FUNCTION IF EXISTS public.check_view_milestones() CASCADE;

COMMENT ON TABLE public.creator_milestones IS
  'Metas oficiais de Creator. reward_points entra no ledger da Economia V1 uma unica vez quando a meta e alcancada.';
COMMENT ON COLUMN public.creator_milestones.milestone_value IS
  'Valor alvo da meta; nao representa Points.';
COMMENT ON COLUMN public.creator_milestones.reward_points IS
  'Creator Points concedidos pelo motor oficial da Economia V1.';

-- ---------------------------------------------------------------------------
-- 2. Fotografia inicial: tudo que ja aconteceu fica fora do novo pagamento
-- ---------------------------------------------------------------------------
WITH approved_creators AS (
  SELECT DISTINCT profiles.id AS creator_id
  FROM public.profiles profiles
  JOIN public.user_roles roles
    ON roles.user_id = profiles.id AND roles.role = 'creator'
  WHERE profiles.creator_status = 'approved'
), creator_stats AS (
  SELECT
    creators.creator_id,
    (
      SELECT count(*) FROM public.contents content
      WHERE content.creator_id = creators.creator_id
        AND content.status = 'approved'
        AND content.content_type <> 'short'
    ) + (
      SELECT count(*) FROM public.courses course
      WHERE course.creator_id = creators.creator_id
        AND course.status = 'approved'
    ) AS total_contents,
    (
      SELECT count(*) FROM public.follows follow_row
      WHERE follow_row.following_id = creators.creator_id
    ) AS total_followers,
    floor(COALESCE((
      SELECT wallet.total_earned FROM public.wallets wallet
      WHERE wallet.user_id = creators.creator_id
    ), 0))::integer AS total_earnings,
    floor(COALESCE((
      SELECT sum(COALESCE(content.views_count, 0))
      FROM public.contents content
      WHERE content.creator_id = creators.creator_id
        AND content.status = 'approved'
        AND content.content_type <> 'short'
    ), 0) + COALESCE((
      SELECT sum(COALESCE(course.views_count, 0))
      FROM public.courses course
      WHERE course.creator_id = creators.creator_id
        AND course.status = 'approved'
    ), 0))::integer AS total_views
  FROM approved_creators creators
), baseline AS (
  SELECT
    stats.creator_id,
    milestone.id AS milestone_id,
    CASE milestone.milestone_type
      WHEN 'contents' THEN stats.total_contents
      WHEN 'followers' THEN stats.total_followers
      WHEN 'earnings' THEN stats.total_earnings
      WHEN 'views' THEN stats.total_views
      ELSE 0
    END AS current_value,
    milestone.milestone_value
  FROM creator_stats stats
  CROSS JOIN public.creator_milestones milestone
  WHERE milestone.active
)
INSERT INTO public.creator_milestone_progress (
  creator_id, milestone_id, current_value, completed_at, claimed, claimed_at,
  reward_status, reward_points
)
SELECT
  creator_id,
  milestone_id,
  current_value,
  CASE WHEN current_value >= milestone_value THEN now() ELSE NULL END,
  current_value >= milestone_value,
  CASE WHEN current_value >= milestone_value THEN now() ELSE NULL END,
  CASE WHEN current_value >= milestone_value THEN 'legacy_ignored' ELSE 'pending' END,
  0
FROM baseline
ON CONFLICT (creator_id, milestone_id) DO UPDATE SET
  current_value = EXCLUDED.current_value,
  completed_at = CASE
    WHEN EXCLUDED.current_value >= (
      SELECT milestone_value FROM public.creator_milestones
      WHERE id = EXCLUDED.milestone_id
    ) THEN COALESCE(public.creator_milestone_progress.completed_at, now())
    ELSE public.creator_milestone_progress.completed_at
  END,
  claimed = public.creator_milestone_progress.claimed OR EXCLUDED.claimed,
  claimed_at = CASE
    WHEN public.creator_milestone_progress.claimed OR EXCLUDED.claimed
      THEN COALESCE(public.creator_milestone_progress.claimed_at, now())
    ELSE NULL
  END,
  reward_status = CASE
    WHEN public.creator_milestone_progress.completed_at IS NOT NULL OR EXCLUDED.claimed
      THEN 'legacy_ignored'
    ELSE 'pending'
  END,
  reward_points = 0,
  reward_event_id = NULL,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Avaliacao e premio atomicos no ledger oficial
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_creator_milestones_v1(
  p_creator_id uuid,
  p_types text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_contents integer := 0;
  v_total_followers integer := 0;
  v_total_earnings integer := 0;
  v_total_views integer := 0;
  v_current integer;
  v_cycle uuid;
  v_commit jsonb;
  v_event_id uuid;
  v_progress public.creator_milestone_progress%ROWTYPE;
  v_milestone public.creator_milestones%ROWTYPE;
  v_awarded jsonb := '[]'::jsonb;
  v_completed jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     AND current_setting('classfy.authorized_reward_operation', true) <> 'on'
     AND auth.uid() IS DISTINCT FROM p_creator_id THEN
    RAISE EXCEPTION 'creator_identity_mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    JOIN public.user_roles role_row
      ON role_row.user_id = profile.id AND role_row.role = 'creator'
    WHERE profile.id = p_creator_id AND profile.creator_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'approved_creator_required';
  END IF;

  SELECT
    (SELECT count(*) FROM public.contents content
      WHERE content.creator_id = p_creator_id
        AND content.status = 'approved'
        AND content.content_type <> 'short')
      +
    (SELECT count(*) FROM public.courses course
      WHERE course.creator_id = p_creator_id AND course.status = 'approved'),
    (SELECT count(*) FROM public.follows follow_row
      WHERE follow_row.following_id = p_creator_id),
    floor(COALESCE((SELECT wallet.total_earned FROM public.wallets wallet
      WHERE wallet.user_id = p_creator_id), 0))::integer,
    floor(COALESCE((SELECT sum(COALESCE(content.views_count, 0))
      FROM public.contents content
      WHERE content.creator_id = p_creator_id
        AND content.status = 'approved'
        AND content.content_type <> 'short'), 0)
      + COALESCE((SELECT sum(COALESCE(course.views_count, 0))
      FROM public.courses course
      WHERE course.creator_id = p_creator_id
        AND course.status = 'approved'), 0))::integer
  INTO v_total_contents, v_total_followers, v_total_earnings, v_total_views;

  FOR v_milestone IN
    SELECT * FROM public.creator_milestones milestone
    WHERE milestone.active
      AND (p_types IS NULL OR milestone.milestone_type = ANY(p_types))
    ORDER BY milestone.order_index, milestone.id
  LOOP
    v_current := CASE v_milestone.milestone_type
      WHEN 'contents' THEN v_total_contents
      WHEN 'followers' THEN v_total_followers
      WHEN 'earnings' THEN v_total_earnings
      WHEN 'views' THEN v_total_views
      ELSE 0
    END;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_creator_id::text || ':' || v_milestone.id::text, 0)
    );

    INSERT INTO public.creator_milestone_progress (
      creator_id, milestone_id, current_value, completed_at, claimed,
      reward_status, reward_points
    ) VALUES (
      p_creator_id, v_milestone.id, v_current,
      CASE WHEN v_current >= v_milestone.milestone_value THEN now() ELSE NULL END,
      false, 'pending', 0
    )
    ON CONFLICT (creator_id, milestone_id) DO UPDATE SET
      current_value = EXCLUDED.current_value,
      completed_at = CASE
        WHEN public.creator_milestone_progress.completed_at IS NOT NULL
          THEN public.creator_milestone_progress.completed_at
        WHEN EXCLUDED.current_value >= v_milestone.milestone_value THEN now()
        ELSE NULL
      END,
      updated_at = now()
    RETURNING * INTO v_progress;

    IF v_current < v_milestone.milestone_value OR v_progress.claimed THEN
      CONTINUE;
    END IF;

    IF NOT v_milestone.reward_enabled OR v_milestone.reward_points = 0 THEN
      UPDATE public.creator_milestone_progress
      SET claimed = true,
          claimed_at = now(),
          reward_status = 'disabled',
          reward_points = 0,
          updated_at = now()
      WHERE id = v_progress.id AND claimed = false;

      v_completed := v_completed || jsonb_build_array(jsonb_build_object(
        'milestone_id', v_milestone.id,
        'title', v_milestone.title,
        'points', 0
      ));
      CONTINUE;
    END IF;

    PERFORM set_config('classfy.authorized_reward_operation', 'on', true);
    SELECT public.get_or_create_current_cycle() INTO v_cycle;
    SELECT public.commit_reward_award(
      p_creator_id,
      'CREATOR_MILESTONE_' || v_milestone.id::text,
      NULL,
      jsonb_build_object(
        'source', 'creator_milestone',
        'milestone_id', v_milestone.id,
        'milestone_type', v_milestone.milestone_type,
        'milestone_value', v_milestone.milestone_value
      ),
      v_cycle,
      jsonb_build_object(
        'user_id', p_creator_id,
        'action_key', 'CREATOR_MILESTONE',
        'points', v_milestone.reward_points,
        'cycle_points', v_milestone.reward_points,
        'point_type', 'creator',
        'metadata', jsonb_build_object(
          'economy_version', 1,
          'source', 'creator_milestone',
          'milestone_id', v_milestone.id,
          'milestone_title', v_milestone.title,
          'milestone_type', v_milestone.milestone_type,
          'milestone_value', v_milestone.milestone_value
        )
      ),
      NULL
    ) INTO v_commit;

    IF COALESCE((v_commit->>'already_tracked')::boolean, false) THEN
      SELECT event.id INTO v_event_id
      FROM public.reward_events event
      WHERE event.user_id = p_creator_id
        AND event.action_key = 'CREATOR_MILESTONE'
        AND event.metadata->>'milestone_id' = v_milestone.id::text
      ORDER BY event.created_at
      LIMIT 1;
    ELSE
      v_event_id := NULLIF(v_commit->'rewards'->0->>'id', '')::uuid;
    END IF;

    UPDATE public.creator_milestone_progress
    SET claimed = true,
        claimed_at = now(),
        reward_status = 'awarded',
        reward_points = v_milestone.reward_points,
        reward_event_id = v_event_id,
        updated_at = now()
    WHERE id = v_progress.id AND claimed = false;

    INSERT INTO public.notifications (user_id, type, title, message, is_read)
    VALUES (
      p_creator_id,
      'milestone_completed',
      'Conquista desbloqueada',
      'Voce concluiu "' || v_milestone.title || '" e recebeu +' ||
        v_milestone.reward_points::text || ' Creator Points.',
      false
    );

    v_awarded := v_awarded || jsonb_build_array(jsonb_build_object(
      'milestone_id', v_milestone.id,
      'title', v_milestone.title,
      'points', v_milestone.reward_points,
      'reward_event_id', v_event_id
    ));
    v_completed := v_completed || jsonb_build_array(jsonb_build_object(
      'milestone_id', v_milestone.id,
      'title', v_milestone.title,
      'points', v_milestone.reward_points
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'creator_id', p_creator_id,
    'stats', jsonb_build_object(
      'totalContents', v_total_contents,
      'totalFollowers', v_total_followers,
      'totalEarnings', v_total_earnings,
      'totalViews', v_total_views
    ),
    'completed', v_completed,
    'awarded', v_awarded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_creator_milestones_v1(uuid, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_creator_milestones_v1(uuid, text[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_creator_milestone_v1(
  p_milestone_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id uuid := auth.uid();
  v_result jsonb;
  v_progress public.creator_milestone_progress%ROWTYPE;
BEGIN
  IF v_creator_id IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.creator_milestones
    WHERE id = p_milestone_id AND active
  ) THEN RAISE EXCEPTION 'milestone_not_found'; END IF;

  PERFORM set_config('classfy.authorized_reward_operation', 'on', true);
  SELECT public.evaluate_creator_milestones_v1(v_creator_id, NULL)
  INTO v_result;

  SELECT * INTO v_progress
  FROM public.creator_milestone_progress
  WHERE creator_id = v_creator_id AND milestone_id = p_milestone_id;

  IF NOT FOUND OR v_progress.completed_at IS NULL THEN
    RAISE EXCEPTION 'milestone_not_completed';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_claimed', v_progress.claimed,
    'reward_status', v_progress.reward_status,
    'points', v_progress.reward_points,
    'reward_event_id', v_progress.reward_event_id,
    'evaluation', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_creator_milestone_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_creator_milestone_v1(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Edicao administrativa auditada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_creator_milestone_v1(
  p_milestone_id uuid,
  p_title text,
  p_description text,
  p_reward_points integer,
  p_reward_enabled boolean,
  p_active boolean,
  p_reason text
)
RETURNS public.creator_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.creator_milestones%ROWTYPE;
  v_new public.creator_milestones%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL THEN RAISE EXCEPTION 'title_required'; END IF;
  IF p_reward_points < 0 THEN RAISE EXCEPTION 'negative_points'; END IF;
  IF p_reward_enabled AND p_reward_points = 0 THEN
    RAISE EXCEPTION 'enabled_reward_requires_points';
  END IF;

  SELECT * INTO v_old FROM public.creator_milestones
  WHERE id = p_milestone_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'milestone_not_found'; END IF;

  UPDATE public.creator_milestones
  SET title = btrim(p_title),
      description = NULLIF(btrim(p_description), ''),
      reward_points = p_reward_points,
      reward_enabled = p_reward_enabled,
      active = p_active,
      updated_at = now()
  WHERE id = p_milestone_id
  RETURNING * INTO v_new;

  INSERT INTO public.economic_admin_audit (
    admin_id, action, entity_type, entity_id, reason, old_value, new_value
  ) VALUES (
    auth.uid(), 'update', 'creator_milestone', p_milestone_id::text,
    btrim(p_reason), to_jsonb(v_old), to_jsonb(v_new)
  );

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.update_creator_milestone_v1(
  uuid, text, text, integer, boolean, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_creator_milestone_v1(
  uuid, text, text, integer, boolean, boolean, text
) TO authenticated;

DROP POLICY IF EXISTS "Admins can manage milestones" ON public.creator_milestones;
REVOKE INSERT, UPDATE, DELETE ON public.creator_milestones FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. Gatilhos oficiais. Shorts nao entram nas metricas economicas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_creator_milestone_evaluation_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id uuid;
  v_types text[];
BEGIN
  IF TG_TABLE_NAME = 'contents' THEN
    v_creator_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.creator_id ELSE NEW.creator_id END;
    IF TG_OP = 'UPDATE' AND NEW.views_count IS DISTINCT FROM OLD.views_count THEN
      IF NEW.content_type = 'short' THEN RETURN NEW; END IF;
      v_types := ARRAY['views'];
    ELSE
      v_types := ARRAY['contents'];
    END IF;
  ELSIF TG_TABLE_NAME = 'courses' THEN
    v_creator_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.creator_id ELSE NEW.creator_id END;
    IF TG_OP = 'UPDATE' AND NEW.views_count IS DISTINCT FROM OLD.views_count THEN
      v_types := ARRAY['views'];
    ELSE
      v_types := ARRAY['contents'];
    END IF;
  ELSIF TG_TABLE_NAME = 'follows' THEN
    v_creator_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.following_id ELSE NEW.following_id END;
    v_types := ARRAY['followers'];
  ELSIF TG_TABLE_NAME = 'wallets' THEN
    v_creator_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
    v_types := ARRAY['earnings'];
  ELSE
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_creator_id IS NOT NULL THEN
    PERFORM set_config('classfy.authorized_reward_operation', 'on', true);
    BEGIN
      PERFORM public.evaluate_creator_milestones_v1(v_creator_id, v_types);
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'approved_creator_required' THEN RAISE; END IF;
    END;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS contents_status_evaluate_creator_milestones_v1 ON public.contents;
CREATE TRIGGER contents_status_evaluate_creator_milestones_v1
AFTER INSERT OR UPDATE OF status ON public.contents
FOR EACH ROW
WHEN (
  NEW.status = 'approved'
  AND NEW.content_type <> 'short'
)
EXECUTE FUNCTION public.trigger_creator_milestone_evaluation_v1();

DROP TRIGGER IF EXISTS contents_views_evaluate_creator_milestones_v1 ON public.contents;
CREATE TRIGGER contents_views_evaluate_creator_milestones_v1
AFTER UPDATE OF views_count ON public.contents
FOR EACH ROW
WHEN (
  NEW.status = 'approved'
  AND NEW.content_type <> 'short'
  AND OLD.views_count IS DISTINCT FROM NEW.views_count
)
EXECUTE FUNCTION public.trigger_creator_milestone_evaluation_v1();

DROP TRIGGER IF EXISTS courses_status_evaluate_creator_milestones_v1 ON public.courses;
CREATE TRIGGER courses_status_evaluate_creator_milestones_v1
AFTER INSERT OR UPDATE OF status ON public.courses
FOR EACH ROW
WHEN (NEW.status = 'approved')
EXECUTE FUNCTION public.trigger_creator_milestone_evaluation_v1();

DROP TRIGGER IF EXISTS courses_views_evaluate_creator_milestones_v1 ON public.courses;
CREATE TRIGGER courses_views_evaluate_creator_milestones_v1
AFTER UPDATE OF views_count ON public.courses
FOR EACH ROW
WHEN (NEW.status = 'approved' AND OLD.views_count IS DISTINCT FROM NEW.views_count)
EXECUTE FUNCTION public.trigger_creator_milestone_evaluation_v1();

DROP TRIGGER IF EXISTS follows_evaluate_creator_milestones_v1 ON public.follows;
CREATE TRIGGER follows_evaluate_creator_milestones_v1
AFTER INSERT OR DELETE ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.trigger_creator_milestone_evaluation_v1();

DROP TRIGGER IF EXISTS wallets_evaluate_creator_milestones_v1 ON public.wallets;
CREATE TRIGGER wallets_evaluate_creator_milestones_v1
AFTER UPDATE OF total_earned ON public.wallets
FOR EACH ROW
WHEN (OLD.total_earned IS DISTINCT FROM NEW.total_earned)
EXECUTE FUNCTION public.trigger_creator_milestone_evaluation_v1();

COMMIT;
