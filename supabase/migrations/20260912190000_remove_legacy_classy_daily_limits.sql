-- Classy uses get_study_limits as the single commercial source of truth.
-- This legacy daily configuration was not honored by the frontend and produced
-- contradictory limits in the API response.
DELETE FROM public.system_config
WHERE config_key = 'classy_chat_daily_limits';
