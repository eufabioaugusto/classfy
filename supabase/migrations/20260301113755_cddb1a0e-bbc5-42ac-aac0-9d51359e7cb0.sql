
-- =============================================
-- FASE 1: INFRAESTRUTURA DO POOL FIXO
-- =============================================

-- 1. PLATFORM_SETTINGS: Configurações globais da plataforma
CREATE TABLE public.platform_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage platform settings"
  ON public.platform_settings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can read platform settings"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (true);

-- 2. ECONOMIC_CYCLES: Ciclos mensais de distribuição
CREATE TABLE public.economic_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month text NOT NULL UNIQUE, -- formato: '2026-03'
  rbm numeric NOT NULL DEFAULT 0, -- Receita Bruta Mensal
  pool_percentage numeric NOT NULL DEFAULT 40, -- % do pool no momento do fechamento
  prm numeric NOT NULL DEFAULT 0, -- Pool de Recompensa Mensal (RBM * pool_percentage/100)
  total_performance_points numeric NOT NULL DEFAULT 0,
  distributed_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.economic_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage economic cycles"
  ON public.economic_cycles FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can read economic cycles"
  ON public.economic_cycles FOR SELECT
  TO authenticated
  USING (true);

-- 3. ECONOMIC_CYCLE_USERS: Performance points por usuário por ciclo
CREATE TABLE public.economic_cycle_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id uuid NOT NULL REFERENCES public.economic_cycles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  performance_points numeric NOT NULL DEFAULT 0,
  calculated_share numeric, -- valor calculado no fechamento
  payout_status text DEFAULT 'pending' CHECK (payout_status IN ('pending', 'paid', 'failed')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, user_id)
);

ALTER TABLE public.economic_cycle_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage cycle users"
  ON public.economic_cycle_users FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own cycle data"
  ON public.economic_cycle_users FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can upsert cycle users"
  ON public.economic_cycle_users FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update cycle users"
  ON public.economic_cycle_users FOR UPDATE
  USING (true);

-- 4. REVENUE_ENTRIES: Registro granular de cada receita
CREATE TABLE public.revenue_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month text NOT NULL, -- formato: '2026-03'
  revenue_type text NOT NULL CHECK (revenue_type IN (
    'subscription_pro', 'subscription_premium',
    'content_purchase', 'boost', 'withdraw_fee',
    'live_gift', 'other'
  )),
  amount numeric NOT NULL DEFAULT 0,
  source_id text, -- ID do recurso fonte (stripe payment intent, boost id, etc)
  user_id uuid, -- quem gerou a receita (opcional)
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.revenue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage revenue entries"
  ON public.revenue_entries FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert revenue entries"
  ON public.revenue_entries FOR INSERT
  WITH CHECK (true);

-- 5. ALTERAR reward_events: adicionar cycle_id e performance_points
ALTER TABLE public.reward_events 
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.economic_cycles(id),
  ADD COLUMN IF NOT EXISTS performance_points numeric DEFAULT 0;

-- 6. Índices para performance
CREATE INDEX idx_revenue_entries_year_month ON public.revenue_entries(year_month);
CREATE INDEX idx_economic_cycle_users_cycle_id ON public.economic_cycle_users(cycle_id);
CREATE INDEX idx_economic_cycle_users_user_id ON public.economic_cycle_users(user_id);
CREATE INDEX idx_reward_events_cycle_id ON public.reward_events(cycle_id);

-- 7. Trigger para updated_at
CREATE TRIGGER update_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_economic_cycles_updated_at
  BEFORE UPDATE ON public.economic_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_economic_cycle_users_updated_at
  BEFORE UPDATE ON public.economic_cycle_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Função helper para obter ou criar ciclo do mês atual
CREATE OR REPLACE FUNCTION public.get_or_create_current_cycle()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year_month text;
  v_cycle_id uuid;
  v_pool_pct numeric;
BEGIN
  v_year_month := TO_CHAR(NOW(), 'YYYY-MM');
  
  SELECT id INTO v_cycle_id
  FROM economic_cycles
  WHERE year_month = v_year_month;
  
  IF v_cycle_id IS NULL THEN
    -- Get pool percentage from settings
    SELECT (value->>'pool_percentage')::numeric INTO v_pool_pct
    FROM platform_settings
    WHERE key = 'economic';
    
    IF v_pool_pct IS NULL THEN
      v_pool_pct := 40;
    END IF;
    
    INSERT INTO economic_cycles (year_month, pool_percentage)
    VALUES (v_year_month, v_pool_pct)
    RETURNING id INTO v_cycle_id;
  END IF;
  
  RETURN v_cycle_id;
END;
$$;
