-- Add course_id column to content_views to support course views
ALTER TABLE public.content_views 
ADD COLUMN course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;

-- Make content_id nullable since we might have course views without content
ALTER TABLE public.content_views 
ALTER COLUMN content_id DROP NOT NULL;

-- Add check constraint to ensure either content_id or course_id is set
ALTER TABLE public.content_views 
ADD CONSTRAINT content_views_content_or_course_check 
CHECK (content_id IS NOT NULL OR course_id IS NOT NULL);

-- Add course_id column to actions table
ALTER TABLE public.actions 
ADD COLUMN course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;

-- Make content_id nullable in actions
ALTER TABLE public.actions 
ALTER COLUMN content_id DROP NOT NULL;

-- Add course_id column to favorites table  
ALTER TABLE public.favorites 
ADD COLUMN course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;

-- Make content_id nullable in favorites
ALTER TABLE public.favorites 
ALTER COLUMN content_id DROP NOT NULL;

-- Add check constraint to favorites
ALTER TABLE public.favorites 
ADD CONSTRAINT favorites_content_or_course_check 
CHECK (content_id IS NOT NULL OR course_id IS NOT NULL);

-- Add course_id column to saved_contents table
ALTER TABLE public.saved_contents 
ADD COLUMN course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;

-- Make content_id nullable in saved_contents
ALTER TABLE public.saved_contents 
ALTER COLUMN content_id DROP NOT NULL;

-- Add check constraint to saved_contents
ALTER TABLE public.saved_contents 
ADD CONSTRAINT saved_contents_content_or_course_check 
CHECK (content_id IS NOT NULL OR course_id IS NOT NULL);

-- Add likes_count column to courses table
ALTER TABLE public.courses 
ADD COLUMN likes_count integer DEFAULT 0;

-- Create function to increment course view (similar to increment_content_view)
CREATE OR REPLACE FUNCTION public.increment_course_view(p_user_id uuid, p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_new_view BOOLEAN := FALSE;
  v_today DATE := CURRENT_DATE;
  v_existing_view RECORD;
  v_creator_id UUID;
BEGIN
  -- Get the course creator
  SELECT creator_id INTO v_creator_id
  FROM courses
  WHERE id = p_course_id;
  
  -- If user is the creator, don't count the view globally (but still track for analytics)
  IF p_user_id = v_creator_id THEN
    SELECT * INTO v_existing_view
    FROM content_views
    WHERE user_id = p_user_id
      AND course_id = p_course_id
      AND view_date = v_today;
    
    IF v_existing_view.id IS NULL THEN
      INSERT INTO content_views (user_id, course_id, view_date, view_count)
      VALUES (p_user_id, p_course_id, v_today, 1);
      
      RETURN jsonb_build_object(
        'is_new_view', false,
        'message', 'Creator view tracked for analytics only'
      );
    ELSE
      UPDATE content_views
      SET 
        view_count = view_count + 1,
        last_viewed_at = NOW(),
        updated_at = NOW()
      WHERE id = v_existing_view.id;
      
      RETURN jsonb_build_object(
        'is_new_view', false,
        'message', 'Creator view already tracked today'
      );
    END IF;
  END IF;
  
  -- Regular user view logic
  SELECT * INTO v_existing_view
  FROM content_views
  WHERE user_id = p_user_id
    AND course_id = p_course_id
    AND view_date = v_today;
  
  IF v_existing_view.id IS NULL THEN
    INSERT INTO content_views (user_id, course_id, view_date, view_count)
    VALUES (p_user_id, p_course_id, v_today, 1);
    
    v_is_new_view := TRUE;
    
    -- Increment global views_count on courses table
    UPDATE courses
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = p_course_id;
  ELSE
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
$function$;

-- Create index for course_id in content_views for performance
CREATE INDEX IF NOT EXISTS idx_content_views_course_id ON content_views(course_id);
CREATE INDEX IF NOT EXISTS idx_actions_course_id ON actions(course_id);
CREATE INDEX IF NOT EXISTS idx_favorites_course_id ON favorites(course_id);
CREATE INDEX IF NOT EXISTS idx_saved_contents_course_id ON saved_contents(course_id);