-- Create featured_creators table
CREATE TABLE IF NOT EXISTS public.featured_creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  background_image_url TEXT NOT NULL,
  badge_text TEXT NOT NULL DEFAULT 'New',
  featured_image_url TEXT NOT NULL,
  description TEXT NOT NULL,
  link_url TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.featured_creators ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Featured creators viewable by all"
  ON public.featured_creators
  FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage featured creators"
  ON public.featured_creators
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for ordering
CREATE INDEX idx_featured_creators_order ON public.featured_creators(order_index);

-- Trigger for updated_at
CREATE TRIGGER update_featured_creators_updated_at
  BEFORE UPDATE ON public.featured_creators
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();