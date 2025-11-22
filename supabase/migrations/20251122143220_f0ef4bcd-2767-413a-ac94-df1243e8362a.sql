-- Create content_views table for tracking unique views per user
CREATE TABLE IF NOT EXISTS public.content_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  content_id UUID NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  view_date DATE NOT NULL DEFAULT CURRENT_DATE,
  view_count INTEGER DEFAULT 1,
  first_viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  total_watch_time_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint: one record per user per content per day
  UNIQUE(user_id, content_id, view_date)
);

-- Enable RLS
ALTER TABLE public.content_views ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own view history"
  ON public.content_views
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert views"
  ON public.content_views
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update views"
  ON public.content_views
  FOR UPDATE
  USING (true);

CREATE POLICY "Admins can view all views"
  ON public.content_views
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Create index for performance
CREATE INDEX idx_content_views_user_content ON public.content_views(user_id, content_id);
CREATE INDEX idx_content_views_content_date ON public.content_views(content_id, view_date);
CREATE INDEX idx_content_views_date ON public.content_views(view_date);

-- Create function to safely increment content views
CREATE OR REPLACE FUNCTION public.increment_content_view(
  p_user_id UUID,
  p_content_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_new_view BOOLEAN := FALSE;
  v_today DATE := CURRENT_DATE;
  v_existing_view RECORD;
BEGIN
  -- Check if user already viewed this content today
  SELECT * INTO v_existing_view
  FROM content_views
  WHERE user_id = p_user_id
    AND content_id = p_content_id
    AND view_date = v_today;
  
  IF v_existing_view.id IS NULL THEN
    -- First view today - insert new record
    INSERT INTO content_views (user_id, content_id, view_date, view_count)
    VALUES (p_user_id, p_content_id, v_today, 1);
    
    v_is_new_view := TRUE;
    
    -- Increment global views_count only on first view per user per day
    UPDATE contents
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = p_content_id;
  ELSE
    -- Update existing record (for analytics, but don't increment global count)
    UPDATE content_views
    SET 
      view_count = view_count + 1,
      last_viewed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_existing_view.id;
    
    v_is_new_view := FALSE;
  END IF;
  
  RETURN jsonb_build_object(
    'is_new_view', v_is_new_view,
    'message', CASE 
      WHEN v_is_new_view THEN 'View registered successfully'
      ELSE 'View already counted today'
    END
  );
END;
$$;

COMMENT ON FUNCTION public.increment_content_view IS 'Safely increments content views, counting only one view per user per day';
COMMENT ON TABLE public.content_views IS 'Tracks unique content views per user per day to prevent view count inflation';