-- Add system configuration for classy chat daily limits
INSERT INTO public.system_config (config_key, config_value, description)
VALUES (
  'classy_chat_daily_limits',
  '{"free": 15, "pro": 50, "premium": 200}'::jsonb,
  'Limite diário de mensagens de chat por estudo para cada plano de usuário (Free, Pro, Premium)'
)
ON CONFLICT (config_key) DO UPDATE
SET config_value = EXCLUDED.config_value;
