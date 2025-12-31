-- Atualizar trigger para contar apenas mensagens do usuário (role = 'user')
CREATE OR REPLACE FUNCTION public.increment_study_message_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Só incrementa se for mensagem do usuário
  IF NEW.role = 'user' THEN
    UPDATE studies
    SET message_count = message_count + 1
    WHERE id = NEW.study_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- Atualizar a função get_study_limits com os novos valores
CREATE OR REPLACE FUNCTION public.get_study_limits(p_plan plan_type)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'max_studies', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 50
      ELSE 5
    END,
    'max_messages', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 30
      ELSE 5
    END,
    'max_deviations', CASE 
      WHEN p_plan = 'premium' THEN 999999
      WHEN p_plan = 'pro' THEN 20
      ELSE 3
    END
  )
$function$;