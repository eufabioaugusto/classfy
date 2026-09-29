-- Course videos have their own identity; keep existing content transcripts intact.
CREATE TABLE public.lesson_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL UNIQUE REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  text text NOT NULL,
  language text NOT NULL DEFAULT 'pt-BR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lesson_transcriptions ENABLE ROW LEVEL SECURITY;
-- Access is resolved by the tutor/transcription functions before service-role reads.
REVOKE ALL ON public.lesson_transcriptions FROM anon, authenticated;
GRANT ALL ON public.lesson_transcriptions TO service_role;
