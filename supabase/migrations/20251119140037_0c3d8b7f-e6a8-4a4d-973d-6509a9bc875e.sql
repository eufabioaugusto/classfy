-- Create study_playlists table to persist saved playlist state per user/study/message
CREATE TABLE public.study_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_id uuid NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.study_messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);

-- Enable RLS
ALTER TABLE public.study_playlists ENABLE ROW LEVEL SECURITY;

-- Users can manage own playlists
CREATE POLICY "Users can manage own playlists"
ON public.study_playlists
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can view own playlists
CREATE POLICY "Users can view own playlists"
ON public.study_playlists
FOR SELECT
USING (auth.uid() = user_id);
