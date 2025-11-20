-- Create purchased_contents table for paid content purchases
CREATE TABLE IF NOT EXISTS public.purchased_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  price_paid NUMERIC NOT NULL,
  discount_applied NUMERIC DEFAULT 0,
  purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, content_id)
);

-- Enable RLS
ALTER TABLE public.purchased_contents ENABLE ROW LEVEL SECURITY;

-- Users can view their own purchases
CREATE POLICY "Users can view own purchases"
ON public.purchased_contents
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own purchases
CREATE POLICY "Users can create own purchases"
ON public.purchased_contents
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Admins can view all purchases
CREATE POLICY "Admins can view all purchases"
ON public.purchased_contents
FOR SELECT
USING (has_role(auth.uid(), 'admin'));

-- Create index for faster lookups
CREATE INDEX idx_purchased_contents_user_id ON public.purchased_contents(user_id);
CREATE INDEX idx_purchased_contents_content_id ON public.purchased_contents(content_id);