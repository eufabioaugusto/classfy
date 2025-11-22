-- Create enum for boost objective
CREATE TYPE boost_objective AS ENUM ('profile', 'content');

-- Create enum for audience type
CREATE TYPE audience_type AS ENUM ('automatic', 'segmented');

-- Create enum for boost status
CREATE TYPE boost_status AS ENUM ('pending_payment', 'active', 'paused', 'completed', 'cancelled');

-- Create boosts table
CREATE TABLE IF NOT EXISTS public.boosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  content_id UUID,
  objective boost_objective NOT NULL,
  audience_type audience_type NOT NULL DEFAULT 'automatic',
  audience_filters JSONB DEFAULT '{}'::jsonb,
  daily_budget NUMERIC NOT NULL CHECK (daily_budget >= 1 AND daily_budget <= 1000),
  duration_days INTEGER NOT NULL CHECK (duration_days >= 1 AND duration_days <= 30),
  total_budget NUMERIC GENERATED ALWAYS AS (daily_budget * duration_days) STORED,
  status boost_status NOT NULL DEFAULT 'pending_payment',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  stripe_payment_intent_id TEXT,
  impressions_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key constraints
ALTER TABLE public.boosts
  ADD CONSTRAINT boosts_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public.boosts
  ADD CONSTRAINT boosts_content_id_fkey 
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE;

-- Create indexes for better query performance
CREATE INDEX idx_boosts_user_id ON public.boosts(user_id);
CREATE INDEX idx_boosts_content_id ON public.boosts(content_id);
CREATE INDEX idx_boosts_status ON public.boosts(status);
CREATE INDEX idx_boosts_dates ON public.boosts(start_date, end_date) WHERE status = 'active';

-- Enable RLS
ALTER TABLE public.boosts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own boosts"
  ON public.boosts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create boosts"
  ON public.boosts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own boosts"
  ON public.boosts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own boosts"
  ON public.boosts FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_boosts_updated_at
  BEFORE UPDATE ON public.boosts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to check if content is currently boosted
CREATE OR REPLACE FUNCTION public.is_content_boosted(p_content_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.boosts
    WHERE content_id = p_content_id
      AND status = 'active'
      AND start_date <= NOW()
      AND end_date >= NOW()
  )
$$;