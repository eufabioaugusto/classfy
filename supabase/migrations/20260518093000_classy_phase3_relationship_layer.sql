ALTER TABLE public.study_ai_state
ADD COLUMN IF NOT EXISTS live_plan_steps TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS last_celebration TEXT,
ADD COLUMN IF NOT EXISTS celebration_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.study_ai_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  study_id UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  assistant_message_id UUID NULL REFERENCES public.study_messages(id) ON DELETE SET NULL,
  event_key TEXT NOT NULL CHECK (
    event_key IN (
      'assistant_response',
      'suggestion_clicked',
      'citation_clicked',
      'content_opened',
      'checkpoint_impression',
      'celebration_impression',
      'learning_plan_impression',
      'followup_used',
      'quiz_improved_after_guidance'
    )
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.study_ai_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study ai events" ON public.study_ai_events;
CREATE POLICY "Users can view own study ai events"
ON public.study_ai_events
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own study ai events" ON public.study_ai_events;
CREATE POLICY "Users can create own study ai events"
ON public.study_ai_events
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_study_ai_events_study_id_created_at
ON public.study_ai_events(study_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_study_ai_events_user_id_event_key
ON public.study_ai_events(user_id, event_key, created_at DESC);
