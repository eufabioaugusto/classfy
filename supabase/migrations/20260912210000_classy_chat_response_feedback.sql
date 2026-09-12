ALTER TABLE public.study_ai_events
DROP CONSTRAINT IF EXISTS study_ai_events_event_key_check;

ALTER TABLE public.study_ai_events
ADD CONSTRAINT study_ai_events_event_key_check
CHECK (
  event_key IN (
    'assistant_response',
    'suggestion_clicked',
    'citation_clicked',
    'content_opened',
    'checkpoint_impression',
    'celebration_impression',
    'learning_plan_impression',
    'followup_used',
    'quiz_improved_after_guidance',
    'response_copied',
    'response_feedback'
  )
);
