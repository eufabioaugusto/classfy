-- Create referral_links table
CREATE TABLE public.referral_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL UNIQUE,
  total_clicks INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  total_purchases INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create referral_conversions table
CREATE TABLE public.referral_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  converted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  first_purchase_at TIMESTAMP WITH TIME ZONE,
  commission_paid BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(referred_user_id)
);

-- Create referral_commissions table
CREATE TABLE public.referral_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversion_id UUID NOT NULL REFERENCES public.referral_conversions(id) ON DELETE CASCADE,
  purchase_type TEXT NOT NULL,
  purchase_amount NUMERIC NOT NULL,
  commission_rate NUMERIC NOT NULL,
  commission_amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending',
  stripe_charge_id TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.referral_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for referral_links
CREATE POLICY "Users can view own referral link"
  ON public.referral_links FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own referral link"
  ON public.referral_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update referral links"
  ON public.referral_links FOR UPDATE
  USING (true);

CREATE POLICY "Admins can view all referral links"
  ON public.referral_links FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for referral_conversions
CREATE POLICY "Users can view conversions they referred"
  ON public.referral_conversions FOR SELECT
  USING (auth.uid() = referrer_id);

CREATE POLICY "System can insert conversions"
  ON public.referral_conversions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update conversions"
  ON public.referral_conversions FOR UPDATE
  USING (true);

CREATE POLICY "Admins can view all conversions"
  ON public.referral_conversions FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for referral_commissions
CREATE POLICY "Users can view own commissions"
  ON public.referral_commissions FOR SELECT
  USING (auth.uid() = referrer_id);

CREATE POLICY "System can insert commissions"
  ON public.referral_commissions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update commissions"
  ON public.referral_commissions FOR UPDATE
  USING (true);

CREATE POLICY "Admins can view all commissions"
  ON public.referral_commissions FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Add system config for referral program
INSERT INTO public.system_config (config_key, config_value, description)
VALUES 
  ('referral_commission_rate', '0.10', 'Taxa de comissão para afiliados (10%)'),
  ('referral_minimum_payout', '50.00', 'Valor mínimo para saque de comissões'),
  ('referral_enabled', 'true', 'Programa de afiliados ativo'),
  ('referral_cookie_days', '30', 'Dias de validade do cookie de referral')
ON CONFLICT (config_key) DO NOTHING;

-- Trigger to update updated_at
CREATE TRIGGER update_referral_links_updated_at
  BEFORE UPDATE ON public.referral_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for performance
CREATE INDEX idx_referral_links_user_id ON public.referral_links(user_id);
CREATE INDEX idx_referral_links_code ON public.referral_links(referral_code);
CREATE INDEX idx_referral_conversions_referrer ON public.referral_conversions(referrer_id);
CREATE INDEX idx_referral_conversions_referred ON public.referral_conversions(referred_user_id);
CREATE INDEX idx_referral_conversions_code ON public.referral_conversions(referral_code);
CREATE INDEX idx_referral_commissions_referrer ON public.referral_commissions(referrer_id);
CREATE INDEX idx_referral_commissions_status ON public.referral_commissions(status);