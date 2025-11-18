-- Create function to check view milestones
CREATE OR REPLACE FUNCTION check_view_milestones()
RETURNS TRIGGER AS $$
DECLARE
  milestone_config RECORD;
BEGIN
  -- Only process if views_count changed
  IF NEW.views_count <> OLD.views_count THEN
    -- Check each milestone (100, 500, 1000)
    FOR milestone_config IN 
      SELECT 
        CASE 
          WHEN views = 100 THEN 'MILESTONE_100_VIEWS'
          WHEN views = 500 THEN 'MILESTONE_500_VIEWS'
          WHEN views = 1000 THEN 'MILESTONE_1000_VIEWS'
        END as action_key,
        views
      FROM (VALUES (100), (500), (1000)) AS milestones(views)
    LOOP
      -- Check if milestone was just crossed
      IF OLD.views_count < milestone_config.views AND NEW.views_count >= milestone_config.views THEN
        -- Check if reward was already given
        IF NOT EXISTS (
          SELECT 1 FROM reward_action_tracking 
          WHERE user_id = NEW.creator_id 
          AND action_key = milestone_config.action_key
          AND content_id = NEW.id
        ) THEN
          -- Get reward config
          PERFORM pg_notify(
            'milestone_reached',
            json_build_object(
              'contentId', NEW.id,
              'creatorId', NEW.creator_id,
              'actionKey', milestone_config.action_key,
              'views', NEW.views_count
            )::text
          );
        END IF;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for view milestones
DROP TRIGGER IF EXISTS trigger_check_view_milestones ON contents;
CREATE TRIGGER trigger_check_view_milestones
  AFTER UPDATE OF views_count ON contents
  FOR EACH ROW
  EXECUTE FUNCTION check_view_milestones();