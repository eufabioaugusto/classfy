-- Create creator_milestones table
CREATE TABLE public.creator_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_type TEXT NOT NULL CHECK (milestone_type IN ('contents', 'followers', 'earnings', 'engagement', 'views')),
  milestone_value INTEGER NOT NULL,
  points_reward INTEGER NOT NULL DEFAULT 0,
  value_reward NUMERIC NOT NULL DEFAULT 0,
  badge_id UUID REFERENCES public.badges(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'trophy',
  active BOOLEAN NOT NULL DEFAULT true,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create creator_milestone_progress table
CREATE TABLE public.creator_milestone_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES public.creator_milestones(id) ON DELETE CASCADE,
  current_value INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  claimed BOOLEAN NOT NULL DEFAULT false,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(creator_id, milestone_id)
);

-- Enable RLS
ALTER TABLE public.creator_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_milestone_progress ENABLE ROW LEVEL SECURITY;

-- RLS policies for creator_milestones
CREATE POLICY "Milestones viewable by all authenticated" 
ON public.creator_milestones 
FOR SELECT 
USING (true);

CREATE POLICY "Admins can manage milestones" 
ON public.creator_milestones 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for creator_milestone_progress
CREATE POLICY "Creators can view own progress" 
ON public.creator_milestone_progress 
FOR SELECT 
USING (auth.uid() = creator_id);

CREATE POLICY "System can insert progress" 
ON public.creator_milestone_progress 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "System can update progress" 
ON public.creator_milestone_progress 
FOR UPDATE 
USING (true);

CREATE POLICY "Admins can view all progress" 
ON public.creator_milestone_progress 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create indexes
CREATE INDEX idx_creator_milestones_type ON public.creator_milestones(milestone_type);
CREATE INDEX idx_creator_milestones_active ON public.creator_milestones(active);
CREATE INDEX idx_creator_milestone_progress_creator ON public.creator_milestone_progress(creator_id);
CREATE INDEX idx_creator_milestone_progress_milestone ON public.creator_milestone_progress(milestone_id);
CREATE INDEX idx_creator_milestone_progress_completed ON public.creator_milestone_progress(completed_at);

-- Insert seed data for milestones
INSERT INTO public.creator_milestones (milestone_type, milestone_value, points_reward, value_reward, title, description, icon, order_index) VALUES
-- Content milestones
('contents', 10, 50, 5, 'Publicador Iniciante', 'Publique 10 conteúdos na plataforma', 'video', 1),
('contents', 50, 200, 20, 'Publicador Bronze', 'Publique 50 conteúdos na plataforma', 'film', 2),
('contents', 100, 500, 50, 'Publicador Prata', 'Publique 100 conteúdos na plataforma', 'clapperboard', 3),
('contents', 200, 1000, 100, 'Publicador Ouro', 'Publique 200 conteúdos na plataforma', 'crown', 4),
('contents', 500, 2500, 250, 'Publicador Diamante', 'Publique 500 conteúdos na plataforma', 'gem', 5),

-- Follower milestones
('followers', 100, 100, 10, 'Influenciador Iniciante', 'Alcance 100 seguidores', 'users', 6),
('followers', 500, 300, 30, 'Influenciador Bronze', 'Alcance 500 seguidores', 'users-round', 7),
('followers', 1000, 750, 75, 'Influenciador Prata', 'Alcance 1.000 seguidores', 'user-check', 8),
('followers', 5000, 1500, 150, 'Influenciador Ouro', 'Alcance 5.000 seguidores', 'user-cog', 9),
('followers', 10000, 3000, 300, 'Influenciador Diamante', 'Alcance 10.000 seguidores', 'star', 10),

-- Earnings milestones
('earnings', 500, 200, 20, 'Monetizador Iniciante', 'Alcance R$ 500 em ganhos totais', 'wallet', 11),
('earnings', 2000, 500, 50, 'Monetizador Bronze', 'Alcance R$ 2.000 em ganhos totais', 'banknote', 12),
('earnings', 10000, 1500, 150, 'Monetizador Prata', 'Alcance R$ 10.000 em ganhos totais', 'piggy-bank', 13),
('earnings', 50000, 4000, 400, 'Monetizador Ouro', 'Alcance R$ 50.000 em ganhos totais', 'landmark', 14),
('earnings', 100000, 10000, 1000, 'Monetizador Diamante', 'Alcance R$ 100.000 em ganhos totais', 'trophy', 15),

-- Views milestones
('views', 1000, 100, 10, 'Visualizações Bronze', 'Alcance 1.000 visualizações totais', 'eye', 16),
('views', 10000, 400, 40, 'Visualizações Prata', 'Alcance 10.000 visualizações totais', 'eye', 17),
('views', 100000, 1500, 150, 'Visualizações Ouro', 'Alcance 100.000 visualizações totais', 'eye', 18),
('views', 1000000, 5000, 500, 'Visualizações Diamante', 'Alcance 1.000.000 visualizações totais', 'eye', 19),

-- Engagement milestones
('engagement', 50, 150, 15, 'Engajador Iniciante', 'Mantenha taxa de engajamento acima de 50% por 30 dias', 'heart-handshake', 20),
('engagement', 80, 500, 50, 'Engajador Expert', 'Mantenha taxa de engajamento acima de 80% por 30 dias', 'heart', 21);

-- Function to update updated_at
CREATE OR REPLACE FUNCTION update_creator_milestone_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_creator_milestones_updated_at
BEFORE UPDATE ON public.creator_milestones
FOR EACH ROW EXECUTE FUNCTION update_creator_milestone_updated_at();

CREATE TRIGGER update_creator_milestone_progress_updated_at
BEFORE UPDATE ON public.creator_milestone_progress
FOR EACH ROW EXECUTE FUNCTION update_creator_milestone_updated_at();