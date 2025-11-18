-- Sistema de Níveis e Badges
CREATE TABLE IF NOT EXISTS user_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  current_level INTEGER DEFAULT 1 CHECK (current_level > 0),
  total_points INTEGER DEFAULT 0 CHECK (total_points >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN ('points', 'action_count', 'milestone', 'streak')),
  requirement_value INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_levels_user_id ON user_levels(user_id);
CREATE INDEX IF NOT EXISTS idx_user_levels_total_points ON user_levels(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);

-- RLS Policies
ALTER TABLE user_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User levels viewable by all"
  ON user_levels FOR SELECT
  USING (true);

CREATE POLICY "Users can update own level"
  ON user_levels FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert levels"
  ON user_levels FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Badges viewable by all"
  ON badges FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage badges"
  ON badges FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "User badges viewable by all"
  ON user_badges FOR SELECT
  USING (true);

CREATE POLICY "System can insert user badges"
  ON user_badges FOR INSERT
  WITH CHECK (true);