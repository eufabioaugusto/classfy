-- Create study_notes table for timestamped annotations
CREATE TABLE IF NOT EXISTS public.study_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  content_id UUID REFERENCES public.contents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  note_text TEXT NOT NULL,
  timestamp_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.study_notes ENABLE ROW LEVEL SECURITY;

-- Users can view their own notes
CREATE POLICY "Users can view own notes"
ON public.study_notes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.studies
    WHERE studies.id = study_notes.study_id
    AND studies.user_id = auth.uid()
  )
);

-- Users can create notes in their studies
CREATE POLICY "Users can create notes in own studies"
ON public.study_notes
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.studies
    WHERE studies.id = study_notes.study_id
    AND studies.user_id = auth.uid()
  )
);

-- Users can update their own notes
CREATE POLICY "Users can update own notes"
ON public.study_notes
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.studies
    WHERE studies.id = study_notes.study_id
    AND studies.user_id = auth.uid()
  )
);

-- Users can delete their own notes
CREATE POLICY "Users can delete own notes"
ON public.study_notes
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.studies
    WHERE studies.id = study_notes.study_id
    AND studies.user_id = auth.uid()
  )
);

-- Create indexes for better performance
CREATE INDEX idx_study_notes_study_id ON public.study_notes(study_id);
CREATE INDEX idx_study_notes_content_id ON public.study_notes(content_id);
CREATE INDEX idx_study_notes_timestamp ON public.study_notes(timestamp_seconds);

-- Trigger to update updated_at
CREATE TRIGGER update_study_notes_updated_at
  BEFORE UPDATE ON public.study_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();