-- Update increment_content_view function to not count creator's own views
CREATE OR REPLACE FUNCTION public.increment_content_view(p_user_id uuid, p_content_id uuid)
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
  -- Get the content creator
  SELECT creator_id INTO v_creator_id
  FROM contents
  WHERE id = p_content_id;
  
  -- If user is the creator, don't count the view globally (but still track for analytics)
  IF p_user_id = v_creator_id THEN
    -- Check if user already viewed today (for analytics)
    SELECT * INTO v_existing_view
    FROM content_views
    WHERE user_id = p_user_id
      AND content_id = p_content_id
      AND view_date = v_today;
    
    IF v_existing_view.id IS NULL THEN
      -- Insert new record but don't increment global views_count
      INSERT INTO content_views (user_id, content_id, view_date, view_count)
      VALUES (p_user_id, p_content_id, v_today, 1);
      
      RETURN jsonb_build_object(
        'is_new_view', false,
        'message', 'Creator view tracked for analytics only'
      );
    ELSE
      -- Update existing record
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
  
  -- Regular user view logic (not the creator)
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
    
    -- Increment global views_count only for non-creator views
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
$function$;