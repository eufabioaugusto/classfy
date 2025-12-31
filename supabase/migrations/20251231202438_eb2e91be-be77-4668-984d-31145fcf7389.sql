-- Add unique constraint to prevent duplicate reward tracking at database level
-- This ensures that even with race conditions, duplicates are prevented

-- First, clean up any existing duplicates (keep the oldest one)
DELETE FROM reward_action_tracking a
USING reward_action_tracking b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.action_key = b.action_key;

-- Create unique index on user_id + action_key combination
-- This prevents the same action from being tracked twice for the same user
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_tracking_unique 
ON reward_action_tracking (user_id, action_key);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_reward_tracking_user_action 
ON reward_action_tracking (user_id, action_key, created_at);

-- Also add a function to safely get the tracking key for daily actions
-- This can be used in the future for more complex tracking logic
CREATE OR REPLACE FUNCTION public.get_daily_tracking_key(p_action_key TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT p_action_key || '_' || CURRENT_DATE::TEXT
$$;