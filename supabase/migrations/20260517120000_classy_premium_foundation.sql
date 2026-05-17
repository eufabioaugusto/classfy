-- Phase 1 foundation for Classy Premium

-- Persist structured assistant metadata on study messages
ALTER TABLE public.study_messages
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Persist tutoring state per study
CREATE TABLE IF NOT EXISTS public.study_ai_state (
  study_id UUID PRIMARY KEY REFERENCES public.studies(id) ON DELETE CASCADE,
  user_goal TEXT,
  current_focus TEXT,
  learner_level TEXT NOT NULL DEFAULT 'unknown'
    CHECK (learner_level IN ('beginner', 'intermediate', 'advanced', 'unknown')),
  active_mode TEXT NOT NULL DEFAULT 'onboard'
    CHECK (active_mode IN ('onboard', 'explain', 'recommend', 'practice', 'review', 'plan')),
  learning_style TEXT NOT NULL DEFAULT 'mixed'
    CHECK (learning_style IN ('direct', 'step_by_step', 'analogy', 'mixed')),
  session_summary TEXT,
  mastered_topics TEXT[] NOT NULL DEFAULT '{}'::text[],
  weak_topics TEXT[] NOT NULL DEFAULT '{}'::text[],
  open_questions TEXT[] NOT NULL DEFAULT '{}'::text[],
  next_best_action TEXT,
  last_active_content_id UUID REFERENCES public.contents(id) ON DELETE SET NULL,
  last_video_timestamp_seconds INTEGER,
  last_quiz_score NUMERIC,
  last_quiz_total INTEGER,
  last_checkpoint_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.study_ai_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study ai state" ON public.study_ai_state;
CREATE POLICY "Users can view own study ai state"
ON public.study_ai_state
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.studies
    WHERE studies.id = study_ai_state.study_id
      AND studies.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create own study ai state" ON public.study_ai_state;
CREATE POLICY "Users can create own study ai state"
ON public.study_ai_state
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.studies
    WHERE studies.id = study_ai_state.study_id
      AND studies.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update own study ai state" ON public.study_ai_state;
CREATE POLICY "Users can update own study ai state"
ON public.study_ai_state
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.studies
    WHERE studies.id = study_ai_state.study_id
      AND studies.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.studies
    WHERE studies.id = study_ai_state.study_id
      AND studies.user_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_study_ai_state_updated_at ON public.study_ai_state(updated_at DESC);

DROP TRIGGER IF EXISTS update_study_ai_state_updated_at ON public.study_ai_state;
CREATE TRIGGER update_study_ai_state_updated_at
  BEFORE UPDATE ON public.study_ai_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Count only user-authored messages for usage limits
CREATE OR REPLACE FUNCTION public.increment_study_message_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'user' THEN
    UPDATE public.studies
    SET message_count = message_count + 1
    WHERE id = NEW.study_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Recalculate existing counts to user-only messages
UPDATE public.studies s
SET message_count = COALESCE((
  SELECT COUNT(*)
  FROM public.study_messages sm
  WHERE sm.study_id = s.id
    AND sm.role = 'user'
), 0);

-- Unify limits in a single DB source of truth
CREATE OR REPLACE FUNCTION public.get_study_limits(p_plan plan_type)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'max_studies', CASE
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 50
      ELSE 5
    END,
    'max_messages', CASE
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 30
      ELSE 5
    END,
    'max_deviations', CASE
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 20
      ELSE 3
    END
  )
$$;
