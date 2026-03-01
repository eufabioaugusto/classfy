
-- Update check_view_milestones trigger to use Performance Points instead of wallet credits
CREATE OR REPLACE FUNCTION public.check_view_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  milestone_config RECORD;
  reward_config RECORD;
  user_profile RECORD;
  plan_mult NUMERIC;
  points_amt INTEGER;
  pp_amt NUMERIC;
  v_cycle_id UUID;
BEGIN
  -- Only process if views_count changed
  IF NEW.views_count <> OLD.views_count THEN
    -- Get or create current cycle
    SELECT get_or_create_current_cycle() INTO v_cycle_id;

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
            pp_amt := FLOOR(reward_config.points_creator * plan_mult);

            -- Insert reward event (value = 0, PP tracked in economic_cycle_users)
            INSERT INTO reward_events (
              action_key, user_id, content_id, points, value, performance_points, cycle_id, metadata
            ) VALUES (
              milestone_config.action_key,
              NEW.creator_id,
              NEW.id,
              points_amt,
              0,
              pp_amt,
              v_cycle_id,
              jsonb_build_object('views', NEW.views_count, 'milestone', milestone_config.views)
            );

            -- Accumulate PP in economic_cycle_users (NO wallet credit)
            INSERT INTO economic_cycle_users (cycle_id, user_id, performance_points)
            VALUES (v_cycle_id, NEW.creator_id, pp_amt)
            ON CONFLICT (cycle_id, user_id) 
            DO UPDATE SET 
              performance_points = economic_cycle_users.performance_points + EXCLUDED.performance_points,
              updated_at = NOW();

            -- Create notification (no R$ amount shown)
            INSERT INTO notifications (
              user_id, type, title, message, related_content_id
            ) VALUES (
              NEW.creator_id,
              'reward',
              '🎉 Marco Atingido!',
              'Seu conteúdo "' || NEW.title || '" atingiu ' || milestone_config.views || ' visualizações! Você ganhou ' || pp_amt || ' Performance Points!',
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
$function$;

-- Add unique constraint on economic_cycle_users if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'economic_cycle_users_cycle_user_unique'
  ) THEN
    ALTER TABLE public.economic_cycle_users 
    ADD CONSTRAINT economic_cycle_users_cycle_user_unique 
    UNIQUE (cycle_id, user_id);
  END IF;
END $$;
