INSERT INTO public.system_config (config_key, config_value, description)
VALUES (
  'direct_sale_platform_commission_rate',
  '{"percentage": 20, "rate": 0.20}'::jsonb,
  'Percentual que a Classfy retém nas vendas diretas de conteúdo'
)
ON CONFLICT (config_key) DO NOTHING;
