-- Preserva os papéis e o proprietário; aceita caminhos novos e históricos.
-- Comparação textual evita tentar converter 'covers' ou 'materials' para UUID.
ALTER POLICY "Creators can upload course content" ON storage.objects
WITH CHECK (bucket_id = 'courses' AND (
  (storage.foldername(name))[1] = auth.uid()::text
  OR ((storage.foldername(name))[1] IN ('covers', 'materials')
      AND (storage.foldername(name))[2] = auth.uid()::text)
) AND (public.has_role(auth.uid(), 'creator'::public.app_role)
       OR public.has_role(auth.uid(), 'admin'::public.app_role)));

ALTER POLICY "Creators can view own course content" ON storage.objects
USING (bucket_id = 'courses' AND (
  (storage.foldername(name))[1] = auth.uid()::text
  OR ((storage.foldername(name))[1] IN ('covers', 'materials')
      AND (storage.foldername(name))[2] = auth.uid()::text)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
));

ALTER POLICY "Creators can update own course content" ON storage.objects
USING (bucket_id = 'courses' AND (
  (storage.foldername(name))[1] = auth.uid()::text
  OR ((storage.foldername(name))[1] IN ('covers', 'materials')
      AND (storage.foldername(name))[2] = auth.uid()::text)
))
WITH CHECK (bucket_id = 'courses' AND (
  (storage.foldername(name))[1] = auth.uid()::text
  OR ((storage.foldername(name))[1] IN ('covers', 'materials')
      AND (storage.foldername(name))[2] = auth.uid()::text)
));

ALTER POLICY "Creators can delete own course content" ON storage.objects
USING (bucket_id = 'courses' AND (
  (storage.foldername(name))[1] = auth.uid()::text
  OR ((storage.foldername(name))[1] IN ('covers', 'materials')
      AND (storage.foldername(name))[2] = auth.uid()::text)
));

-- Altera somente a validação de mídia das funções atuais, preservando
-- correções anteriores. O provedor deve ter recebido o arquivo completo.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  v_definition := pg_get_functiondef('public.submit_course_publication(uuid)'::regprocedure);
  v_updated := replace(v_definition,
    'asset.owner_id = auth.uid() AND asset.status = ''ready''',
    'asset.owner_id = auth.uid() AND asset.status IN (''processing'', ''ready'')');
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'course_media_validation_pattern_not_found';
  END IF;
  EXECUTE v_updated;

  -- A análise pode começar durante o processamento. A aprovação aguarda
  -- todos os assets prontos, inclusive em revisões de cursos publicados.
  v_definition := pg_get_functiondef('public.approve_publication_submission_v1(uuid,text)'::regprocedure);
  v_updated := replace(v_definition,
    'v_snapshot := v_submission.snapshot;',
    $guard$v_snapshot := v_submission.snapshot;
  IF v_submission.source_type = 'course' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_snapshot->'modules', '[]'::jsonb)) module
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(module->'lessons', '[]'::jsonb)) lesson
    WHERE lesson->>'lessonType' IN ('video', 'audio')
      AND NOT EXISTS (
        SELECT 1 FROM public.media_assets asset
        WHERE asset.id = (lesson->>'mediaAssetId')::uuid
          AND asset.owner_id = v_submission.owner_id AND asset.status = 'ready'
      )
  ) THEN RAISE EXCEPTION 'As mídias do curso ainda estão sendo processadas ou precisam ser substituídas.'; END IF;
$guard$);
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'course_approval_pattern_not_found';
  END IF;
  EXECUTE v_updated;

  -- Cursos novos também podem ser aprovados pelo caminho administrativo legado.
  v_definition := pg_get_functiondef('public.approve_content_v1(uuid,text,text)'::regprocedure);
  v_updated := replace(v_definition,
    'IF v_creator IS NULL THEN RAISE EXCEPTION ''item_not_found''; END IF;',
    $guard$IF v_creator IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF p_item_type = 'course' AND EXISTS (
    SELECT 1 FROM public.course_lessons lesson
    WHERE lesson.course_id = p_item_id AND lesson.lesson_type IN ('video', 'audio')
      AND NOT EXISTS (
        SELECT 1 FROM public.media_assets asset
        WHERE asset.id = lesson.media_asset_id AND asset.owner_id = v_creator AND asset.status = 'ready'
      )
  ) THEN RAISE EXCEPTION 'As mídias do curso ainda estão sendo processadas ou precisam ser substituídas.'; END IF;
$guard$);
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'course_legacy_approval_pattern_not_found';
  END IF;
  EXECUTE v_updated;
END;
$migration$;
