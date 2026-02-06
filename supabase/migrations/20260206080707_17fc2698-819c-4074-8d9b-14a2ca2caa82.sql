-- =====================================================
-- SISTEMA DE LIVES - MIGRAÇÕES
-- =====================================================

-- 1. Adicionar 'live' ao enum content_type
ALTER TYPE content_type ADD VALUE IF NOT EXISTS 'live';

-- 2. Enum para status da live
CREATE TYPE live_status AS ENUM ('scheduled', 'waiting', 'live', 'ended', 'cancelled');

-- 3. Enum para tipo de mensagem de chat
CREATE TYPE live_message_type AS ENUM ('text', 'gift', 'system', 'pinned');

-- =====================================================
-- TABELA: lives (Transmissões ao vivo)
-- =====================================================
CREATE TABLE public.lives (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  
  -- Status e timing
  status live_status NOT NULL DEFAULT 'waiting',
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  
  -- Streaming (para integração futura com Cloudflare)
  stream_key TEXT UNIQUE,
  playback_url TEXT,
  recording_url TEXT,
  
  -- Configurações de acesso
  visibility content_visibility NOT NULL DEFAULT 'free',
  price NUMERIC DEFAULT 0,
  
  -- Métricas
  viewer_count INTEGER DEFAULT 0,
  peak_viewers INTEGER DEFAULT 0,
  total_gifts_value NUMERIC DEFAULT 0,
  
  -- Recursos
  chat_enabled BOOLEAN DEFAULT true,
  gifts_enabled BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lives ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Lives públicas são visíveis para todos"
  ON public.lives FOR SELECT
  USING (status IN ('scheduled', 'live') OR creator_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Creators podem criar lives"
  ON public.lives FOR INSERT
  WITH CHECK (creator_id = auth.uid() AND has_role(auth.uid(), 'creator'));

CREATE POLICY "Creators podem atualizar próprias lives"
  ON public.lives FOR UPDATE
  USING (creator_id = auth.uid());

CREATE POLICY "Creators podem deletar próprias lives"
  ON public.lives FOR DELETE
  USING (creator_id = auth.uid());

CREATE POLICY "Admins podem gerenciar todas as lives"
  ON public.lives FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Trigger para updated_at
CREATE TRIGGER update_lives_updated_at
  BEFORE UPDATE ON public.lives
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- TABELA: live_gifts (Tipos de presentes disponíveis)
-- =====================================================
CREATE TABLE public.live_gifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL, -- emoji ou nome do ícone
  price NUMERIC NOT NULL,
  animation_type TEXT DEFAULT 'float', -- float, sparkle, explosion, rain
  color TEXT DEFAULT '#FFD700',
  active BOOLEAN DEFAULT true,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.live_gifts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Presentes são visíveis para todos"
  ON public.live_gifts FOR SELECT
  USING (active = true);

CREATE POLICY "Admins podem gerenciar presentes"
  ON public.live_gifts FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Inserir presentes padrão
INSERT INTO public.live_gifts (name, icon, price, animation_type, color, order_index) VALUES
  ('Coração', '❤️', 2.00, 'float', '#FF6B6B', 1),
  ('Estrela', '⭐', 5.00, 'sparkle', '#FFD700', 2),
  ('Foguete', '🚀', 10.00, 'fly', '#FF4500', 3),
  ('Diamante', '💎', 25.00, 'explosion', '#00BFFF', 4),
  ('Coroa', '👑', 50.00, 'rain', '#FFD700', 5),
  ('Super Live', '🏆', 100.00, 'fullscreen', '#FF6B6B', 6);

-- =====================================================
-- TABELA: live_messages (Chat da live)
-- =====================================================
CREATE TABLE public.live_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  live_id UUID NOT NULL REFERENCES public.lives(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type live_message_type NOT NULL DEFAULT 'text',
  gift_id UUID REFERENCES public.live_gifts(id),
  is_pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.live_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Mensagens visíveis para participantes da live"
  ON public.live_messages FOR SELECT
  USING (true); -- Qualquer um pode ler chat de lives públicas

CREATE POLICY "Usuários autenticados podem enviar mensagens"
  ON public.live_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuários podem deletar próprias mensagens"
  ON public.live_messages FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Creators podem moderar chat da própria live"
  ON public.live_messages FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.lives
    WHERE lives.id = live_messages.live_id
    AND lives.creator_id = auth.uid()
  ));

-- Habilitar Realtime para chat
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_messages;

-- =====================================================
-- TABELA: live_gift_transactions (Compras de presentes)
-- =====================================================
CREATE TABLE public.live_gift_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  live_id UUID NOT NULL REFERENCES public.lives(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id),
  creator_id UUID NOT NULL REFERENCES public.profiles(id),
  gift_id UUID NOT NULL REFERENCES public.live_gifts(id),
  amount NUMERIC NOT NULL,
  creator_share NUMERIC NOT NULL, -- 70%
  platform_share NUMERIC NOT NULL, -- 30%
  stripe_payment_id TEXT,
  status TEXT DEFAULT 'pending', -- pending, completed, refunded
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.live_gift_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Usuários podem ver próprias transações"
  ON public.live_gift_transactions FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = creator_id);

CREATE POLICY "Sistema pode inserir transações"
  ON public.live_gift_transactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins podem ver todas transações"
  ON public.live_gift_transactions FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- =====================================================
-- TABELA: live_viewers (Espectadores ativos)
-- =====================================================
CREATE TABLE public.live_viewers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  live_id UUID NOT NULL REFERENCES public.lives(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  
  UNIQUE(live_id, user_id)
);

-- Enable RLS
ALTER TABLE public.live_viewers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Viewers visíveis para creator da live"
  ON public.live_viewers FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.lives
      WHERE lives.id = live_viewers.live_id
      AND lives.creator_id = auth.uid()
    ) OR
    has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Usuários podem registrar presença"
  ON public.live_viewers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuários podem atualizar própria presença"
  ON public.live_viewers FOR UPDATE
  USING (auth.uid() = user_id);

-- Habilitar Realtime para contagem de viewers
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_viewers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lives;

-- =====================================================
-- FUNÇÃO: Atualizar contagem de viewers
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_live_viewer_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Count active viewers
  SELECT COUNT(*) INTO v_count
  FROM public.live_viewers
  WHERE live_id = COALESCE(NEW.live_id, OLD.live_id)
  AND is_active = true;
  
  -- Update lives table
  UPDATE public.lives
  SET 
    viewer_count = v_count,
    peak_viewers = GREATEST(peak_viewers, v_count)
  WHERE id = COALESCE(NEW.live_id, OLD.live_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger para atualizar contagem
CREATE TRIGGER update_viewer_count_on_change
  AFTER INSERT OR UPDATE OR DELETE ON public.live_viewers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_live_viewer_count();

-- =====================================================
-- ÍNDICES para performance
-- =====================================================
CREATE INDEX idx_lives_status ON public.lives(status);
CREATE INDEX idx_lives_creator ON public.lives(creator_id);
CREATE INDEX idx_live_messages_live ON public.live_messages(live_id);
CREATE INDEX idx_live_messages_created ON public.live_messages(created_at DESC);
CREATE INDEX idx_live_viewers_live ON public.live_viewers(live_id);
CREATE INDEX idx_live_viewers_active ON public.live_viewers(live_id, is_active) WHERE is_active = true;