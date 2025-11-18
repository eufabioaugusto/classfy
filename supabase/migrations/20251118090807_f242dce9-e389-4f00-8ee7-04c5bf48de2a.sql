-- Create fraud prevention table
CREATE TABLE IF NOT EXISTS public.reward_action_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id UUID REFERENCES public.contents(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  metadata JSONB
);

-- Create indexes for performance
CREATE INDEX idx_reward_tracking_user_action ON public.reward_action_tracking(user_id, action_key);
CREATE INDEX idx_reward_tracking_content ON public.reward_action_tracking(content_id);
CREATE INDEX idx_reward_tracking_created ON public.reward_action_tracking(created_at);

-- Create unique constraint for actions that should be once ever per content
CREATE UNIQUE INDEX idx_reward_tracking_content_unique ON public.reward_action_tracking(user_id, content_id, action_key)
WHERE action_key IN ('LIKE_CONTENT', 'SAVE_CONTENT', 'FAVORITE_CONTENT', 'WATCH_50', 'WATCH_100', 'COMPLETE_COURSE', 'COMMENT_CONTENT');

-- Enable RLS
ALTER TABLE public.reward_action_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own tracking"
  ON public.reward_action_tracking
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert tracking"
  ON public.reward_action_tracking
  FOR INSERT
  WITH CHECK (true);

-- Create table for user login streaks
CREATE TABLE IF NOT EXISTS public.user_login_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_login_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_login_streaks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own streaks"
  ON public.user_login_streaks
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own streaks"
  ON public.user_login_streaks
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streaks"
  ON public.user_login_streaks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create trigger to update updated_at
CREATE TRIGGER update_user_login_streaks_updated_at
  BEFORE UPDATE ON public.user_login_streaks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert config for the 7 base actions if they don't exist
INSERT INTO public.reward_actions_config (action_key, description, points_user, value_user, points_creator, value_creator, active)
VALUES 
  ('LIKE_CONTENT', 'Curtiu um conteúdo', 5, 0.15, 10, 0.25, true),
  ('SAVE_CONTENT', 'Salvou um conteúdo', 3, 0.10, 5, 0.15, true),
  ('FAVORITE_CONTENT', 'Favoritou um conteúdo', 8, 0.20, 12, 0.30, true),
  ('COMMENT_CONTENT', 'Comentou em um conteúdo', 10, 0.30, 15, 0.40, true),
  ('SUBSCRIBE_CREATOR', 'Seguiu um creator', 15, 0.50, 25, 1.00, true),
  ('DAILY_LOGIN', 'Login diário', 5, 0.10, 0, 0, true),
  ('COMPLETE_COURSE', 'Completou um curso', 100, 3.00, 150, 5.00, true)
ON CONFLICT (action_key) DO NOTHING;