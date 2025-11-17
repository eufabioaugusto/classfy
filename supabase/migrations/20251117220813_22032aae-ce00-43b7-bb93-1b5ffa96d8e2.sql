-- Create studies table
CREATE TABLE public.studies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  main_topic TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  plan_at_creation plan_type NOT NULL DEFAULT 'free',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create study_messages table
CREATE TABLE public.study_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  study_id UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for studies
CREATE POLICY "Users can view own studies"
ON public.studies
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own studies"
ON public.studies
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own studies"
ON public.studies
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own studies"
ON public.studies
FOR DELETE
USING (auth.uid() = user_id);

-- RLS Policies for study_messages
CREATE POLICY "Users can view messages from own studies"
ON public.study_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.studies
    WHERE studies.id = study_messages.study_id
    AND studies.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create messages in own studies"
ON public.study_messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.studies
    WHERE studies.id = study_messages.study_id
    AND studies.user_id = auth.uid()
  )
);

-- Create index for performance
CREATE INDEX idx_studies_user_id ON public.studies(user_id);
CREATE INDEX idx_studies_status ON public.studies(status);
CREATE INDEX idx_studies_last_activity ON public.studies(last_activity_at DESC);
CREATE INDEX idx_study_messages_study_id ON public.study_messages(study_id);

-- Create trigger to update last_activity_at
CREATE TRIGGER update_studies_last_activity
BEFORE UPDATE ON public.studies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to count active studies
CREATE OR REPLACE FUNCTION public.count_active_studies(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.studies
  WHERE user_id = p_user_id
  AND status = 'active'
$$;