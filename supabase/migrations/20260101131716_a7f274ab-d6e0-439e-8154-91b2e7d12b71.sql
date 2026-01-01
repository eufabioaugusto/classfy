-- First, remove duplicate likes keeping only the oldest one per user/content combination
DELETE FROM actions a1
USING actions a2
WHERE a1.id > a2.id
  AND a1.user_id = a2.user_id
  AND a1.type = a2.type
  AND (
    (a1.content_id IS NOT NULL AND a1.content_id = a2.content_id)
    OR (a1.course_id IS NOT NULL AND a1.course_id = a2.course_id)
  );

-- Create unique index to prevent duplicate likes per user/content
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_unique_like_content 
ON actions (user_id, type, content_id) 
WHERE content_id IS NOT NULL;

-- Create unique index to prevent duplicate likes per user/course  
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_unique_like_course 
ON actions (user_id, type, course_id) 
WHERE course_id IS NOT NULL;

-- Create a function to sync likes_count on contents table
CREATE OR REPLACE FUNCTION sync_content_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.content_id IS NOT NULL AND NEW.type = 'LIKE' THEN
      UPDATE contents SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.content_id;
    END IF;
    IF NEW.course_id IS NOT NULL AND NEW.type = 'LIKE' THEN
      UPDATE courses SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.course_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.content_id IS NOT NULL AND OLD.type = 'LIKE' THEN
      UPDATE contents SET likes_count = GREATEST(0, COALESCE(likes_count, 0) - 1) WHERE id = OLD.content_id;
    END IF;
    IF OLD.course_id IS NOT NULL AND OLD.type = 'LIKE' THEN
      UPDATE courses SET likes_count = GREATEST(0, COALESCE(likes_count, 0) - 1) WHERE id = OLD.course_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_action_like_change ON actions;

-- Create trigger to sync likes count
CREATE TRIGGER on_action_like_change
AFTER INSERT OR DELETE ON actions
FOR EACH ROW
EXECUTE FUNCTION sync_content_likes_count();

-- Sync current likes_count for all contents based on actual likes in actions table
UPDATE contents c
SET likes_count = (
  SELECT COUNT(*) FROM actions a 
  WHERE a.content_id = c.id AND a.type = 'LIKE'
);

-- Sync current likes_count for all courses
UPDATE courses co
SET likes_count = (
  SELECT COUNT(*) FROM actions a 
  WHERE a.course_id = co.id AND a.type = 'LIKE'
);