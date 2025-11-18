-- Create reward_actions_config table
CREATE TABLE public.reward_actions_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key TEXT NOT NULL UNIQUE,
  description TEXT,
  points_user INTEGER NOT NULL DEFAULT 0,
  value_user NUMERIC NOT NULL DEFAULT 0,
  points_creator INTEGER NOT NULL DEFAULT 0,
  value_creator NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create reward_events table
CREATE TABLE public.reward_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  related_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content_id UUID REFERENCES public.contents(id) ON DELETE SET NULL,
  action_key TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  value NUMERIC NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_content_id UUID REFERENCES public.contents(id) ON DELETE SET NULL,
  related_reward_id UUID REFERENCES public.reward_events(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reward_actions_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for reward_actions_config
CREATE POLICY "Config viewable by all authenticated users"
ON public.reward_actions_config FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage config"
ON public.reward_actions_config FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for reward_events
CREATE POLICY "Users can view own reward events"
ON public.reward_events FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all reward events"
ON public.reward_events FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert reward events"
ON public.reward_events FOR INSERT
TO authenticated
WITH CHECK (true);

-- RLS Policies for notifications
CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
ON public.notifications FOR INSERT
TO authenticated
WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX idx_reward_events_user_id ON public.reward_events(user_id);
CREATE INDEX idx_reward_events_content_id ON public.reward_events(content_id);
CREATE INDEX idx_reward_events_action_key ON public.reward_events(action_key);
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_is_read ON public.notifications(is_read);

-- Trigger for updated_at
CREATE TRIGGER update_reward_actions_config_updated_at
BEFORE UPDATE ON public.reward_actions_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default reward actions config
INSERT INTO public.reward_actions_config (action_key, description, points_user, value_user, points_creator, value_creator) VALUES
('CONTENT_APPROVED', 'Conteúdo aprovado pela moderação', 0, 0, 50, 5.00),
('VIEW_15S', 'Visualização qualificada (15s+)', 0, 0, 2, 0.10),
('WATCH_50', 'Usuário assistiu 50% do conteúdo', 10, 0.50, 0, 0),
('WATCH_100', 'Usuário completou o conteúdo', 25, 1.00, 5, 0.50),
('LIKE_CONTENT', 'Curtida em conteúdo', 2, 0.10, 3, 0.20),
('SAVE_CONTENT', 'Conteúdo salvo', 2, 0.10, 2, 0.15),
('FAVORITE_CONTENT', 'Conteúdo favoritado', 3, 0.15, 4, 0.25),
('COMMENT_CONTENT', 'Comentário em conteúdo', 5, 0.25, 3, 0.20),
('COMPLETE_COURSE', 'Curso completo concluído', 100, 5.00, 20, 2.00),
('SUBSCRIBE_CREATOR', 'Seguir um creator', 5, 0.25, 10, 0.50),
('DAILY_LOGIN', 'Login diário', 5, 0.25, 0, 0);