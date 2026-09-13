-- Durações capturadas pelo navegador podem conter frações de segundo.
-- Mantém as funções existentes e troca somente as conversões frágeis para INTEGER.
DO $migration$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_updated text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.replace_course_structure_v2(uuid,jsonb)'::regprocedure,
    'public.submit_standalone_publication(uuid)'::regprocedure,
    'public.submit_course_publication(uuid)'::regprocedure,
    'public.approve_publication_submission_v1(uuid,text)'::regprocedure
  ]
  LOOP
    v_definition := pg_get_functiondef(v_signature);
    v_updated := v_definition;

    -- O limite do short compara a duração exata antes do arredondamento.
    v_updated := replace(
      v_updated,
      'COALESCE((v_payload->>''duration'')::integer, 0) > 180',
      'COALESCE((v_payload->>''duration'')::numeric, 0) > 180'
    );
    v_updated := replace(
      v_updated,
      'COALESCE((v_payload->>''duration'')::integer, 0)',
      'COALESCE(ceil((v_payload->>''duration'')::numeric)::integer, 0)'
    );
    v_updated := replace(
      v_updated,
      'COALESCE((v_snapshot->>''duration'')::integer, 0)',
      'COALESCE(ceil((v_snapshot->>''duration'')::numeric)::integer, 0)'
    );
    v_updated := replace(
      v_updated,
      'COALESCE((lesson->>''duration'')::integer, 0)',
      'COALESCE(ceil((lesson->>''duration'')::numeric)::integer, 0)'
    );
    v_updated := replace(
      v_updated,
      'COALESCE((item->>''duration'')::integer, 0)',
      'COALESCE(ceil((item->>''duration'')::numeric)::integer, 0)'
    );

    IF v_updated IS DISTINCT FROM v_definition THEN
      EXECUTE v_updated;
    END IF;
  END LOOP;
END;
$migration$;
