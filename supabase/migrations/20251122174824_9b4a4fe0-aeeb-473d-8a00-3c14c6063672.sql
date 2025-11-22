-- Create system configuration table for maturation period
CREATE TABLE IF NOT EXISTS public.system_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can manage config
CREATE POLICY "Admins can manage system config"
ON public.system_config
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Policy: All authenticated users can view config
CREATE POLICY "All users can view system config"
ON public.system_config
FOR SELECT
USING (true);

-- Insert default maturation period (7 days)
INSERT INTO public.system_config (config_key, config_value, description)
VALUES (
  'earnings_maturation_days',
  '{"days": 7}'::jsonb,
  'Número de dias que os ganhos precisam maturar antes de poderem ser sacados'
)
ON CONFLICT (config_key) DO NOTHING;

-- Add maturation tracking to reward_events
ALTER TABLE public.reward_events
ADD COLUMN IF NOT EXISTS can_withdraw_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days');

-- Update existing reward_events to have withdrawal date
UPDATE public.reward_events
SET can_withdraw_at = created_at + INTERVAL '7 days'
WHERE can_withdraw_at IS NULL;