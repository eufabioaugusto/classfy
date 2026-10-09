-- Administradores já podem enviar conteúdo. A aprovação deve aceitar esses
-- autores sem atribuir papel de creator ou alterar o perfil.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  v_definition := pg_get_functiondef('public.approve_content_v1(uuid,text,text)'::regprocedure);
  v_updated := replace(v_definition,
    'IF v_creator_status<>''approved'' OR NOT v_has_role THEN RAISE EXCEPTION ''approved_creator_required''; END IF;',
    'IF NOT public.has_role(v_creator, ''admin''::public.app_role)
        AND (v_creator_status IS DISTINCT FROM ''approved'' OR NOT v_has_role)
     THEN RAISE EXCEPTION ''approved_creator_required''; END IF;');
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'approval_creator_validation_pattern_not_found';
  END IF;
  EXECUTE v_updated;
END;
$migration$;
