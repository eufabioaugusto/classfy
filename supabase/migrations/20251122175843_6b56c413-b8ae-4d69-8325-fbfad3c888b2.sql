-- Add minimum withdrawal amount configuration
INSERT INTO public.system_config (config_key, config_value, description)
VALUES (
  'minimum_withdrawal_amount',
  '{"amount": 10}'::jsonb,
  'Valor mínimo para solicitar saques (em reais)'
)
ON CONFLICT (config_key) DO NOTHING;