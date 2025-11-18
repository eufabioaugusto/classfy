-- Ajustar tabela contents para o novo sistema
ALTER TABLE contents 
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS file_url text;

-- Migrar dados existentes
UPDATE contents 
SET duration_seconds = duration_minutes * 60 
WHERE duration_minutes IS NOT NULL;

UPDATE contents 
SET file_url = video_url 
WHERE video_url IS NOT NULL;

-- Criar tipo enum para visibility
CREATE TYPE content_visibility AS ENUM ('free', 'pro', 'premium', 'paid');

-- Adicionar coluna visibility
ALTER TABLE contents 
  ADD COLUMN IF NOT EXISTS visibility content_visibility DEFAULT 'free';

-- Migrar dados de is_free e required_plan para visibility
UPDATE contents 
SET visibility = CASE 
  WHEN is_free = true THEN 'free'::content_visibility
  WHEN required_plan = 'pro' THEN 'pro'::content_visibility
  WHEN required_plan = 'premium' THEN 'premium'::content_visibility
  WHEN price > 0 THEN 'paid'::content_visibility
  ELSE 'free'::content_visibility
END;

-- Criar tabela de métricas de conteúdo
CREATE TABLE IF NOT EXISTS content_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid REFERENCES contents(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event text NOT NULL CHECK (event IN ('start', 'half', 'complete')),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Habilitar RLS na tabela content_metrics
ALTER TABLE content_metrics ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para content_metrics
CREATE POLICY "Users can insert own metrics"
  ON content_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own metrics"
  ON content_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all metrics"
  ON content_metrics FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Atualizar políticas RLS da tabela contents para incluir status
DROP POLICY IF EXISTS "Published content viewable by all" ON contents;

CREATE POLICY "Approved content viewable by all"
  ON contents FOR SELECT
  TO authenticated
  USING (status = 'approved' OR creator_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- Política para creators criarem conteúdo
DROP POLICY IF EXISTS "Creators can insert own content" ON contents;

CREATE POLICY "Approved creators can insert content"
  ON contents FOR INSERT
  TO authenticated
  WITH CHECK (
    creator_id = auth.uid() 
    AND has_role(auth.uid(), 'creator'::app_role)
    AND EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND creator_status = 'approved'
    )
  );

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_contents_status ON contents(status);
CREATE INDEX IF NOT EXISTS idx_contents_visibility ON contents(visibility);
CREATE INDEX IF NOT EXISTS idx_content_metrics_content ON content_metrics(content_id);
CREATE INDEX IF NOT EXISTS idx_content_metrics_user ON content_metrics(user_id);