-- Executar como postgres em banco de QA ou em transação que será revertida.
-- Não deixa cursos, arquivos ou mídia de teste persistidos.
BEGIN;
\ir ../migrations/20261009120000_course_upload_background_processing.sql

DO $test$
DECLARE
  v_user uuid;
  v_asset uuid;
  v_draft uuid;
  v_payload jsonb;
  v_result jsonb;
  v_status public.media_asset_status;
BEGIN
  SELECT user_id INTO v_user FROM public.user_roles WHERE role = 'admin' LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'QA requer um usuário admin existente'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  INSERT INTO public.media_assets(owner_id, status) VALUES (v_user, 'processing') RETURNING id INTO v_asset;
  v_payload := jsonb_build_object(
    'title', 'QA envio de curso', 'description', 'Teste transacional',
    'thumbnailUrl', 'https://example.com/qa.jpg', 'visibility', 'free',
    'level', 'beginner', 'accessType', 'lifetime', 'accessDays', '365',
    'modules', jsonb_build_array(jsonb_build_object(
      'title', 'Módulo QA', 'lessons', jsonb_build_array(jsonb_build_object(
        'title', 'Aula QA', 'lessonType', 'video', 'mediaAssetId', v_asset,
        'fileUrl', 'media:' || v_asset::text, 'duration', 12.5, 'uploadState', 'processing'
      ))
    ))
  );
  INSERT INTO public.publication_drafts(owner_id, draft_key, kind, payload)
  VALUES (v_user, 'curso:new:qa-' || gen_random_uuid()::text, 'curso', v_payload) RETURNING id INTO v_draft;

  FOREACH v_status IN ARRAY ARRAY['created','uploading','failed','deleted','missing']::public.media_asset_status[] LOOP
    UPDATE public.media_assets SET status = v_status WHERE id = v_asset;
    BEGIN
      PERFORM public.submit_course_publication(v_draft);
      RAISE EXCEPTION 'QA aceitou status inválido: %', v_status;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'media_not_ready' THEN RAISE; END IF;
    END;
  END LOOP;

  UPDATE public.media_assets SET status = 'processing' WHERE id = v_asset;
  v_result := public.submit_course_publication(v_draft);
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = (v_result->>'courseId')::uuid AND status = 'pending')
    THEN RAISE EXCEPTION 'QA curso não entrou em análise'; END IF;
  BEGIN
    PERFORM public.approve_publication_submission_v1((v_result->>'submissionId')::uuid, 'QA');
    RAISE EXCEPTION 'QA aprovou mídia em processamento';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'As mídias do curso ainda estão sendo processadas ou precisam ser substituídas.' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.approve_content_v1((v_result->>'courseId')::uuid, 'course', 'QA');
    RAISE EXCEPTION 'QA aprovou mídia em processamento pelo caminho legado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'As mídias do curso ainda estão sendo processadas ou precisam ser substituídas.' THEN RAISE; END IF;
  END;

  UPDATE public.media_assets SET status = 'ready' WHERE id = v_asset;
  PERFORM public.approve_publication_submission_v1((v_result->>'submissionId')::uuid, 'QA');
  IF NOT EXISTS (SELECT 1 FROM public.publication_submissions WHERE id = (v_result->>'submissionId')::uuid AND status = 'approved')
    THEN RAISE EXCEPTION 'QA curso pronto não foi aprovado'; END IF;
  RAISE NOTICE 'QA: transferências inválidas bloqueadas, processamento aceito, aprovação somente após ready';
END;
$test$;

-- Verifica políticas reais como usuário autenticado, inclusive caminho legado.
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('courses', auth.uid()::text || '/covers/qa.jpg'),
  ('courses', 'covers/' || auth.uid()::text || '/qa.jpg'),
  ('courses', auth.uid()::text || '/materials/qa.pdf'),
  ('courses', 'materials/' || auth.uid()::text || '/qa.pdf');
DO $test$
BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
    VALUES ('courses', 'covers/00000000-0000-4000-8000-000000000000/qa.jpg');
    RAISE EXCEPTION 'QA permitiu upload para pasta de outro usuário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'QA: capas e materiais aceitos sem cast UUID, outro proprietário bloqueado';
END;
$test$;
ROLLBACK;
