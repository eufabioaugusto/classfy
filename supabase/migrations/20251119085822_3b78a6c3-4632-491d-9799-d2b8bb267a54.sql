-- Create table for study quizzes
CREATE TABLE IF NOT EXISTS public.study_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  content_id UUID REFERENCES public.contents(id) ON DELETE SET NULL,
  questions JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB
);

-- Create table for quiz attempts
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.study_quizzes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  time_spent_seconds INTEGER
);

-- Enable RLS
ALTER TABLE public.study_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for study_quizzes
CREATE POLICY "Users can view quizzes from their studies"
  ON public.study_quizzes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.studies
      WHERE studies.id = study_quizzes.study_id
      AND studies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create quizzes for their studies"
  ON public.study_quizzes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.studies
      WHERE studies.id = study_quizzes.study_id
      AND studies.user_id = auth.uid()
    )
  );

-- RLS Policies for quiz_attempts
CREATE POLICY "Users can view their own quiz attempts"
  ON public.quiz_attempts
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own quiz attempts"
  ON public.quiz_attempts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_study_quizzes_study_id ON public.study_quizzes(study_id);
CREATE INDEX IF NOT EXISTS idx_study_quizzes_content_id ON public.study_quizzes(content_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON public.quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON public.quiz_attempts(user_id);