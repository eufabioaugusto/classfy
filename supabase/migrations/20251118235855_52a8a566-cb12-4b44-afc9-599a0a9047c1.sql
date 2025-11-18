-- Fix search_path for check_view_milestones function
DROP FUNCTION IF EXISTS check_view_milestones() CASCADE;

CREATE OR REPLACE FUNCTION check_view_milestones()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  milestone_config RECORD;
  reward_config RECORD;
  user_profile RECORD;
  plan_mult NUMERIC;
  points_amt INTEGER;
  value_amt NUMERIC;
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
          SELECT * INTO reward_config
          FROM reward_actions_config
          WHERE action_key = milestone_config.action_key AND active = true;

          IF FOUND THEN
            -- Get creator profile for plan multiplier
            SELECT plan INTO user_profile
            FROM profiles
            WHERE id = NEW.creator_id;

            -- Calculate multiplier based on plan
            plan_mult := CASE 
              WHEN user_profile.plan = 'premium' THEN 1.25
              WHEN user_profile.plan = 'pro' THEN 1.1
              ELSE 1.0
            END;

            points_amt := FLOOR(reward_config.points_creator * plan_mult);
            value_amt := reward_config.value_creator * plan_mult;

            -- Insert reward event
            INSERT INTO reward_events (
              action_key, user_id, content_id, points, value, metadata
            ) VALUES (
              milestone_config.action_key,
              NEW.creator_id,
              NEW.id,
              points_amt,
              value_amt,
              jsonb_build_object('views', NEW.views_count, 'milestone', milestone_config.views)
            );

            -- Update wallet
            UPDATE wallets
            SET 
              balance = balance + value_amt,
              total_earned = total_earned + value_amt,
              updated_at = NOW()
            WHERE user_id = NEW.creator_id;

            -- Create notification
            INSERT INTO notifications (
              user_id, type, title, message, related_content_id
            ) VALUES (
              NEW.creator_id,
              'reward',
              '🎉 Marco Atingido!',
              'Seu conteúdo "' || NEW.title || '" atingiu ' || milestone_config.views || ' visualizações! Você ganhou ' || points_amt || ' pontos e R$ ' || value_amt::TEXT || '!',
              NEW.id
            );

            -- Track action
            INSERT INTO reward_action_tracking (
              action_key, user_id, content_id, metadata
            ) VALUES (
              milestone_config.action_key,
              NEW.creator_id,
              NEW.id,
              jsonb_build_object('views', NEW.views_count)
            );
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_check_view_milestones ON contents;
CREATE TRIGGER trigger_check_view_milestones
  AFTER UPDATE OF views_count ON contents
  FOR EACH ROW
  EXECUTE FUNCTION check_view_milestones();