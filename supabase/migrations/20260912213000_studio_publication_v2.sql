-- Studio publication V2: account drafts, immutable review submissions,
-- typed course settings and safe media ownership.

CREATE TABLE IF NOT EXISTS public.publication_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  draft_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('aula', 'podcast', 'short', 'curso')),
  source_type TEXT CHECK (source_type IN ('content', 'course')),
  source_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'discarded')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, draft_key)
);

CREATE TABLE IF NOT EXISTS public.publication_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES public.publication_drafts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('aula', 'podcast', 'short', 'curso')),
  source_type TEXT NOT NULL CHECK (source_type IN ('content', 'course')),
  source_id UUID,
  snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  review_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publication_draft_assets (
  draft_id UUID NOT NULL REFERENCES public.publication_drafts(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, media_asset_id),
  UNIQUE (draft_id, slot_key)
);

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS publication_draft_id UUID REFERENCES public.publication_drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ;

ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_media_type_check;
ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_media_type_check CHECK (media_type IN ('video', 'audio'));

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS issue_certificate BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_type TEXT NOT NULL DEFAULT 'lifetime' CHECK (access_type IN ('lifetime', 'limited')),
  ADD COLUMN IF NOT EXISTS access_days INTEGER CHECK (access_days IS NULL OR access_days > 0),
  ADD COLUMN IF NOT EXISTS lesson_order TEXT NOT NULL DEFAULT 'free' CHECK (lesson_order IN ('free', 'sequential')),
  ADD COLUMN IF NOT EXISTS allow_comments BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_reviews BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_downloads BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.course_lessons
  ADD COLUMN IF NOT EXISTS lesson_type TEXT NOT NULL DEFAULT 'video' CHECK (lesson_type IN ('video', 'audio', 'text')),
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_publication_drafts_owner_state
  ON public.publication_drafts(owner_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_publication_submissions_status
  ON public.publication_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publication_submissions_source
  ON public.publication_submissions(source_type, source_id, status);
CREATE INDEX IF NOT EXISTS idx_media_assets_abandoned
  ON public.media_assets(abandoned_at) WHERE abandoned_at IS NOT NULL;

ALTER TABLE public.publication_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_draft_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators manage own publication drafts"
ON public.publication_drafts FOR ALL TO authenticated
USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Creators read own publication submissions"
ON public.publication_submissions FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Creators create own publication submissions"
ON public.publication_submissions FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Admins review publication submissions"
ON public.publication_submissions FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Creators manage own draft assets"
ON public.publication_draft_assets FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.publication_drafts d
  WHERE d.id = draft_id AND (d.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.publication_drafts d
  WHERE d.id = draft_id AND (d.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
));

CREATE OR REPLACE FUNCTION public.save_publication_draft(
  p_draft_key TEXT,
  p_kind TEXT,
  p_payload JSONB,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL
)
RETURNS public.publication_drafts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_draft public.publication_drafts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_kind NOT IN ('aula', 'podcast', 'short', 'curso') THEN RAISE EXCEPTION 'invalid_publication_kind'; END IF;
  IF p_source_type IS NOT NULL AND p_source_type NOT IN ('content', 'course') THEN RAISE EXCEPTION 'invalid_source_type'; END IF;

  INSERT INTO public.publication_drafts (owner_id, draft_key, kind, source_type, source_id, payload)
  VALUES (auth.uid(), p_draft_key, p_kind, p_source_type, p_source_id, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (owner_id, draft_key) DO UPDATE SET
    kind = EXCLUDED.kind,
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    payload = EXCLUDED.payload,
    revision = public.publication_drafts.revision + 1,
    state = 'draft',
    submitted_at = NULL,
    updated_at = now()
  RETURNING * INTO v_draft;
  RETURN v_draft;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_course_structure_v2(p_course_id UUID, p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module JSONB;
  v_lesson JSONB;
  v_quiz JSONB;
  v_material JSONB;
  v_module_id UUID;
  v_position BIGINT;
BEGIN
  DELETE FROM public.course_materials WHERE course_id = p_course_id;
  DELETE FROM public.course_quizzes WHERE course_id = p_course_id;
  DELETE FROM public.course_lessons WHERE course_id = p_course_id;
  DELETE FROM public.course_modules WHERE course_id = p_course_id;

  FOR v_module, v_position IN
    SELECT value, ordinality FROM jsonb_array_elements(COALESCE(p_payload->'modules', '[]'::jsonb)) WITH ORDINALITY
  LOOP
    INSERT INTO public.course_modules (course_id, title, description, order_index)
    VALUES (p_course_id, trim(v_module->>'title'), NULLIF(trim(v_module->>'description'), ''), v_position - 1)
    RETURNING id INTO v_module_id;

    INSERT INTO public.course_lessons (
      module_id, course_id, title, description, lesson_type, body, video_url,
      media_asset_id, duration_seconds, order_index, is_preview
    )
    SELECT
      v_module_id, p_course_id, trim(item->>'title'), NULLIF(trim(item->>'description'), ''),
      COALESCE(NULLIF(item->>'lessonType', ''), 'video'), NULLIF(item->>'body', ''),
      NULLIF(item->>'fileUrl', ''), NULLIF(item->>'mediaAssetId', '')::uuid,
      COALESCE((item->>'duration')::integer, 0), ordinality - 1,
      COALESCE((item->>'isPreview')::boolean, false)
    FROM jsonb_array_elements(COALESCE(v_module->'lessons', '[]'::jsonb)) WITH ORDINALITY AS lesson_item(item, ordinality)
    WHERE trim(item->>'title') <> '';

    INSERT INTO public.course_quizzes (
      course_id, module_id, title, description, questions, passing_score, max_attempts, order_index
    )
    SELECT
      p_course_id, v_module_id, trim(item->>'title'), NULLIF(trim(item->>'description'), ''),
      COALESCE(item->'questions', '[]'::jsonb), COALESCE((item->>'passingScore')::integer, 70),
      COALESCE((item->>'maxAttempts')::integer, 3), ordinality - 1
    FROM jsonb_array_elements(COALESCE(v_module->'quizzes', '[]'::jsonb)) WITH ORDINALITY AS quiz_item(item, ordinality)
    WHERE trim(item->>'title') <> '' AND jsonb_array_length(COALESCE(item->'questions', '[]'::jsonb)) > 0;

    INSERT INTO public.course_materials (
      course_id, module_id, title, description, file_url, file_type, file_size
    )
    SELECT
      p_course_id, v_module_id, trim(item->>'title'), NULLIF(trim(item->>'description'), ''),
      item->>'fileUrl', COALESCE(NULLIF(item->>'fileType', ''), 'application/octet-stream'),
      NULLIF(item->>'fileSize', '')::integer
    FROM jsonb_array_elements(COALESCE(v_module->'materials', '[]'::jsonb)) WITH ORDINALITY AS material_item(item, ordinality)
    WHERE trim(item->>'title') <> '' AND COALESCE(item->>'fileUrl', '') <> '';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_standalone_publication(p_draft_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.publication_drafts;
  v_payload JSONB;
  v_content public.contents;
  v_submission public.publication_submissions;
  v_is_revision BOOLEAN := false;
BEGIN
  SELECT * INTO v_draft FROM public.publication_drafts
  WHERE id = p_draft_id AND owner_id = auth.uid() AND state = 'draft' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft_not_found'; END IF;
  IF v_draft.kind = 'curso' THEN RAISE EXCEPTION 'invalid_publication_kind'; END IF;
  v_payload := v_draft.payload;

  IF trim(COALESCE(v_payload->>'title', '')) = '' THEN RAISE EXCEPTION 'title_required'; END IF;
  IF COALESCE(v_payload->>'mediaAssetId', '') = '' THEN RAISE EXCEPTION 'media_required'; END IF;
  IF COALESCE(v_payload->>'thumbnailUrl', '') = '' THEN RAISE EXCEPTION 'thumbnail_required'; END IF;
  IF v_draft.kind = 'short' AND COALESCE((v_payload->>'duration')::integer, 0) > 180 THEN RAISE EXCEPTION 'short_too_long'; END IF;
  IF v_payload->>'visibility' = 'paid' AND COALESCE((v_payload->>'price')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'valid_price_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.media_assets WHERE id = (v_payload->>'mediaAssetId')::uuid AND owner_id = auth.uid() AND status = 'ready') THEN
    RAISE EXCEPTION 'media_not_ready';
  END IF;

  IF v_draft.source_id IS NOT NULL THEN
    SELECT * INTO v_content FROM public.contents WHERE id = v_draft.source_id AND creator_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'source_not_found'; END IF;
    v_is_revision := v_content.status = 'approved';
  END IF;

  IF NOT v_is_revision THEN
    IF v_draft.source_id IS NULL THEN
      INSERT INTO public.contents (
        creator_id, content_type, title, description, file_url, thumbnail_url,
        duration_seconds, visibility, is_free, price, discount, tags, media_asset_id,
        video_provider, status, views_count, likes_count
      ) VALUES (
        auth.uid(), v_draft.kind::public.content_type, trim(v_payload->>'title'), NULLIF(trim(v_payload->>'description'), ''),
        v_payload->>'fileUrl', v_payload->>'thumbnailUrl', COALESCE((v_payload->>'duration')::integer, 0),
        (v_payload->>'visibility')::public.content_visibility, v_payload->>'visibility' = 'free',
        CASE WHEN v_payload->>'visibility' = 'paid' THEN (v_payload->>'price')::numeric ELSE 0 END,
        CASE WHEN v_payload->>'visibility' = 'paid' THEN COALESCE((v_payload->>'discount')::numeric, 0) ELSE 0 END,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_payload->'tags', '[]'::jsonb))),
        (v_payload->>'mediaAssetId')::uuid, NULLIF(v_payload->>'videoProvider', ''), 'pending', 0, 0
      ) RETURNING * INTO v_content;
    ELSE
      UPDATE public.contents SET
        title = trim(v_payload->>'title'), description = NULLIF(trim(v_payload->>'description'), ''),
        file_url = v_payload->>'fileUrl', thumbnail_url = v_payload->>'thumbnailUrl',
        duration_seconds = COALESCE((v_payload->>'duration')::integer, 0),
        visibility = (v_payload->>'visibility')::public.content_visibility,
        is_free = v_payload->>'visibility' = 'free',
        price = CASE WHEN v_payload->>'visibility' = 'paid' THEN (v_payload->>'price')::numeric ELSE 0 END,
        discount = CASE WHEN v_payload->>'visibility' = 'paid' THEN COALESCE((v_payload->>'discount')::numeric, 0) ELSE 0 END,
        tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_payload->'tags', '[]'::jsonb))),
        media_asset_id = (v_payload->>'mediaAssetId')::uuid,
        video_provider = NULLIF(v_payload->>'videoProvider', ''), updated_at = now()
      WHERE id = v_draft.source_id RETURNING * INTO v_content;
    END IF;
  END IF;

  INSERT INTO public.publication_submissions (owner_id, draft_id, kind, source_type, source_id, snapshot)
  VALUES (auth.uid(), v_draft.id, v_draft.kind, 'content', COALESCE(v_content.id, v_draft.source_id), v_payload)
  RETURNING * INTO v_submission;

  -- Mantém o vínculo nos dois sentidos para auditoria e limpeza segura.
  IF NOT v_is_revision THEN
    UPDATE public.media_assets
    SET content_id = v_content.id, publication_draft_id = v_draft.id, abandoned_at = NULL, updated_at = now()
    WHERE id = (v_payload->>'mediaAssetId')::uuid AND owner_id = auth.uid();
  END IF;

  UPDATE public.publication_drafts SET state = 'submitted', submitted_at = now(), updated_at = now() WHERE id = v_draft.id;
  RETURN jsonb_build_object('submissionId', v_submission.id, 'contentId', COALESCE(v_content.id, v_draft.source_id), 'isRevision', v_is_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_course_publication(p_draft_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.publication_drafts;
  v_payload JSONB;
  v_course public.courses;
  v_submission public.publication_submissions;
  v_is_revision BOOLEAN := false;
  v_lesson_count INTEGER;
  v_duration INTEGER;
BEGIN
  SELECT * INTO v_draft FROM public.publication_drafts
  WHERE id = p_draft_id AND owner_id = auth.uid() AND state = 'draft' AND kind = 'curso' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft_not_found'; END IF;
  v_payload := v_draft.payload;
  IF trim(COALESCE(v_payload->>'title', '')) = '' OR trim(COALESCE(v_payload->>'description', '')) = '' THEN RAISE EXCEPTION 'course_details_required'; END IF;
  IF COALESCE(v_payload->>'thumbnailUrl', '') = '' THEN RAISE EXCEPTION 'thumbnail_required'; END IF;
  IF jsonb_array_length(COALESCE(v_payload->'modules', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'module_required'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_payload->'modules', '[]'::jsonb)) module
    WHERE trim(COALESCE(module->>'title', '')) = ''
  ) THEN RAISE EXCEPTION 'module_title_required'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_payload->'modules', '[]'::jsonb)) module
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(module->'lessons', '[]'::jsonb)) lesson
    WHERE trim(COALESCE(lesson->>'title', '')) = ''
      OR COALESCE(lesson->>'lessonType', '') NOT IN ('video', 'audio', 'text')
      OR (lesson->>'lessonType' = 'text' AND trim(COALESCE(lesson->>'body', '')) = '')
      OR (lesson->>'lessonType' IN ('video', 'audio') AND COALESCE(lesson->>'mediaAssetId', '') = '')
  ) THEN RAISE EXCEPTION 'incomplete_lesson'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_payload->'modules', '[]'::jsonb)) module
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(module->'quizzes', '[]'::jsonb)) quiz
    WHERE trim(COALESCE(quiz->>'title', '')) = '' OR jsonb_array_length(COALESCE(quiz->'questions', '[]'::jsonb)) = 0
  ) THEN RAISE EXCEPTION 'incomplete_quiz'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_payload->'modules', '[]'::jsonb)) module
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(module->'materials', '[]'::jsonb)) material
    WHERE trim(COALESCE(material->>'title', '')) = '' OR COALESCE(material->>'fileUrl', '') = ''
  ) THEN RAISE EXCEPTION 'incomplete_material'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_payload->'modules', '[]'::jsonb)) module
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(module->'lessons', '[]'::jsonb)) lesson
    WHERE lesson->>'lessonType' IN ('video', 'audio')
      AND NOT EXISTS (
        SELECT 1 FROM public.media_assets asset
        WHERE asset.id = (lesson->>'mediaAssetId')::uuid AND asset.owner_id = auth.uid() AND asset.status = 'ready'
      )
  ) THEN RAISE EXCEPTION 'media_not_ready'; END IF;
  SELECT COUNT(*), COALESCE(SUM(COALESCE((lesson->>'duration')::integer, 0)), 0)
  INTO v_lesson_count, v_duration
  FROM jsonb_array_elements(v_payload->'modules') module
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(module->'lessons', '[]'::jsonb)) lesson
  WHERE trim(COALESCE(lesson->>'title', '')) <> ''
    AND ((lesson->>'lessonType' = 'text' AND trim(COALESCE(lesson->>'body', '')) <> '')
      OR (lesson->>'lessonType' IN ('video', 'audio') AND COALESCE(lesson->>'mediaAssetId', '') <> ''));
  IF v_lesson_count < 1 THEN RAISE EXCEPTION 'valid_lesson_required'; END IF;
  IF v_payload->>'visibility' = 'paid' AND COALESCE((v_payload->>'price')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'valid_price_required'; END IF;
  IF v_payload->>'accessType' = 'limited' AND COALESCE((v_payload->>'accessDays')::integer, 0) < 1 THEN RAISE EXCEPTION 'valid_access_period_required'; END IF;

  IF v_draft.source_id IS NOT NULL THEN
    SELECT * INTO v_course FROM public.courses WHERE id = v_draft.source_id AND creator_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'source_not_found'; END IF;
    v_is_revision := v_course.status = 'approved';
  END IF;

  IF NOT v_is_revision THEN
    IF v_draft.source_id IS NULL THEN
      INSERT INTO public.courses (
        creator_id, title, description, thumbnail_url, status, visibility, price, discount, tags,
        level, requirements, what_you_learn, total_lessons, total_duration_seconds,
        issue_certificate, access_type, access_days, lesson_order, allow_comments, allow_reviews, allow_downloads
      ) VALUES (
        auth.uid(), trim(v_payload->>'title'), trim(v_payload->>'description'), v_payload->>'thumbnailUrl', 'pending',
        (v_payload->>'visibility')::public.content_visibility,
        CASE WHEN v_payload->>'visibility' = 'paid' THEN (v_payload->>'price')::numeric ELSE 0 END,
        CASE WHEN v_payload->>'visibility' = 'paid' THEN COALESCE((v_payload->>'discount')::numeric, 0) ELSE 0 END,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_payload->'tags', '[]'::jsonb))),
        v_payload->>'level', NULLIF(v_payload->>'requirements', ''), NULLIF(v_payload->>'whatYouLearn', ''),
        v_lesson_count, v_duration, COALESCE((v_payload->>'issueCertificate')::boolean, true),
        COALESCE(v_payload->>'accessType', 'lifetime'), NULLIF(v_payload->>'accessDays', '')::integer,
        COALESCE(v_payload->>'lessonOrder', 'free'), COALESCE((v_payload->>'allowComments')::boolean, true),
        COALESCE((v_payload->>'allowReviews')::boolean, true), COALESCE((v_payload->>'allowDownloads')::boolean, true)
      ) RETURNING * INTO v_course;
    ELSE
      UPDATE public.courses SET
        title = trim(v_payload->>'title'), description = trim(v_payload->>'description'), thumbnail_url = v_payload->>'thumbnailUrl',
        visibility = (v_payload->>'visibility')::public.content_visibility,
        price = CASE WHEN v_payload->>'visibility' = 'paid' THEN (v_payload->>'price')::numeric ELSE 0 END,
        discount = CASE WHEN v_payload->>'visibility' = 'paid' THEN COALESCE((v_payload->>'discount')::numeric, 0) ELSE 0 END,
        tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_payload->'tags', '[]'::jsonb))), level = v_payload->>'level',
        requirements = NULLIF(v_payload->>'requirements', ''), what_you_learn = NULLIF(v_payload->>'whatYouLearn', ''),
        total_lessons = v_lesson_count, total_duration_seconds = v_duration,
        issue_certificate = COALESCE((v_payload->>'issueCertificate')::boolean, true), access_type = COALESCE(v_payload->>'accessType', 'lifetime'),
        access_days = NULLIF(v_payload->>'accessDays', '')::integer, lesson_order = COALESCE(v_payload->>'lessonOrder', 'free'),
        allow_comments = COALESCE((v_payload->>'allowComments')::boolean, true), allow_reviews = COALESCE((v_payload->>'allowReviews')::boolean, true),
        allow_downloads = COALESCE((v_payload->>'allowDownloads')::boolean, true), updated_at = now()
      WHERE id = v_draft.source_id RETURNING * INTO v_course;
    END IF;
    PERFORM public.replace_course_structure_v2(v_course.id, v_payload);
  END IF;

  INSERT INTO public.publication_submissions (owner_id, draft_id, kind, source_type, source_id, snapshot)
  VALUES (auth.uid(), v_draft.id, 'curso', 'course', COALESCE(v_course.id, v_draft.source_id), v_payload)
  RETURNING * INTO v_submission;
  UPDATE public.publication_drafts SET state = 'submitted', submitted_at = now(), updated_at = now() WHERE id = v_draft.id;
  RETURN jsonb_build_object('submissionId', v_submission.id, 'courseId', COALESCE(v_course.id, v_draft.source_id), 'isRevision', v_is_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_publication_submission_v1(p_submission_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.publication_submissions;
  v_snapshot JSONB;
  v_previous_media_ids UUID[];
  v_previous_media_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF trim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_submission FROM public.publication_submissions WHERE id = p_submission_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission_not_found'; END IF;
  v_snapshot := v_submission.snapshot;

  IF v_submission.source_type = 'content' THEN
    SELECT media_asset_id INTO v_previous_media_id
    FROM public.contents
    WHERE id = v_submission.source_id
    FOR UPDATE;

    UPDATE public.contents SET
      title = trim(v_snapshot->>'title'), description = NULLIF(trim(v_snapshot->>'description'), ''), file_url = v_snapshot->>'fileUrl',
      thumbnail_url = v_snapshot->>'thumbnailUrl', duration_seconds = COALESCE((v_snapshot->>'duration')::integer, 0),
      visibility = (v_snapshot->>'visibility')::public.content_visibility, is_free = v_snapshot->>'visibility' = 'free',
      price = CASE WHEN v_snapshot->>'visibility' = 'paid' THEN (v_snapshot->>'price')::numeric ELSE 0 END,
      discount = CASE WHEN v_snapshot->>'visibility' = 'paid' THEN COALESCE((v_snapshot->>'discount')::numeric, 0) ELSE 0 END,
      tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_snapshot->'tags', '[]'::jsonb))),
      media_asset_id = (v_snapshot->>'mediaAssetId')::uuid, video_provider = NULLIF(v_snapshot->>'videoProvider', ''), updated_at = now()
    WHERE id = v_submission.source_id;

    UPDATE public.media_assets
    SET content_id = NULL, abandoned_at = now(), updated_at = now()
    WHERE id = v_previous_media_id
      AND v_previous_media_id IS DISTINCT FROM (v_snapshot->>'mediaAssetId')::uuid;

    UPDATE public.media_assets
    SET content_id = v_submission.source_id, publication_draft_id = NULL, abandoned_at = NULL, updated_at = now()
    WHERE id = (v_snapshot->>'mediaAssetId')::uuid;
  ELSE
    SELECT ARRAY_AGG(media_asset_id) INTO v_previous_media_ids
    FROM public.course_lessons
    WHERE course_id = v_submission.source_id AND media_asset_id IS NOT NULL;
    UPDATE public.courses SET
      title = trim(v_snapshot->>'title'), description = trim(v_snapshot->>'description'), thumbnail_url = v_snapshot->>'thumbnailUrl',
      visibility = (v_snapshot->>'visibility')::public.content_visibility,
      price = CASE WHEN v_snapshot->>'visibility' = 'paid' THEN (v_snapshot->>'price')::numeric ELSE 0 END,
      discount = CASE WHEN v_snapshot->>'visibility' = 'paid' THEN COALESCE((v_snapshot->>'discount')::numeric, 0) ELSE 0 END,
      tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_snapshot->'tags', '[]'::jsonb))), level = v_snapshot->>'level',
      requirements = NULLIF(v_snapshot->>'requirements', ''), what_you_learn = NULLIF(v_snapshot->>'whatYouLearn', ''),
      issue_certificate = COALESCE((v_snapshot->>'issueCertificate')::boolean, true), access_type = COALESCE(v_snapshot->>'accessType', 'lifetime'),
      access_days = NULLIF(v_snapshot->>'accessDays', '')::integer, lesson_order = COALESCE(v_snapshot->>'lessonOrder', 'free'),
      allow_comments = COALESCE((v_snapshot->>'allowComments')::boolean, true), allow_reviews = COALESCE((v_snapshot->>'allowReviews')::boolean, true),
      allow_downloads = COALESCE((v_snapshot->>'allowDownloads')::boolean, true), updated_at = now()
    WHERE id = v_submission.source_id;
    PERFORM public.replace_course_structure_v2(v_submission.source_id, v_snapshot);
    UPDATE public.media_assets asset SET abandoned_at = now(), updated_at = now()
    WHERE v_previous_media_ids IS NOT NULL AND asset.id = ANY(v_previous_media_ids)
      AND NOT EXISTS (SELECT 1 FROM public.course_lessons lesson WHERE lesson.media_asset_id = asset.id);
    UPDATE public.courses SET
      total_lessons = (SELECT COUNT(*) FROM public.course_lessons WHERE course_id = v_submission.source_id),
      total_duration_seconds = (SELECT COALESCE(SUM(duration_seconds), 0) FROM public.course_lessons WHERE course_id = v_submission.source_id)
    WHERE id = v_submission.source_id;
  END IF;
  UPDATE public.publication_submissions SET status = 'approved', review_reason = trim(p_reason), reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_submission_id;
  UPDATE public.publication_submissions SET status = 'superseded' WHERE source_type = v_submission.source_type AND source_id = v_submission.source_id AND status = 'pending' AND id <> p_submission_id;
  UPDATE public.media_assets SET publication_draft_id = NULL, updated_at = now() WHERE publication_draft_id = v_submission.draft_id;
  RETURN jsonb_build_object('success', true, 'sourceId', v_submission.source_id, 'sourceType', v_submission.source_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_publication_submission_v1(p_submission_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_submission public.publication_submissions;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF trim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.publication_submissions SET status = 'rejected', review_reason = trim(p_reason), reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_submission_id AND status = 'pending' RETURNING * INTO v_submission;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission_not_found'; END IF;
  UPDATE public.media_assets SET abandoned_at = now(), updated_at = now()
  WHERE publication_draft_id = v_submission.draft_id AND content_id IS NULL;
  RETURN jsonb_build_object('success', true, 'sourceId', v_submission.source_id, 'sourceType', v_submission.source_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_publication_draft(p_draft_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.publication_drafts
  SET state = 'discarded', updated_at = now()
  WHERE id = p_draft_id AND owner_id = auth.uid() AND state = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'draft_not_found'; END IF;
  UPDATE public.media_assets
  SET abandoned_at = now(), status = CASE WHEN status IN ('created', 'uploading') THEN 'failed'::public.media_asset_status ELSE status END, updated_at = now()
  WHERE publication_draft_id = p_draft_id AND content_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_media_asset(p_media_asset_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.media_assets
  SET abandoned_at = now(), publication_draft_id = NULL,
      status = CASE WHEN status IN ('created', 'uploading') THEN 'failed'::public.media_asset_status ELSE status END,
      updated_at = now()
  WHERE id = p_media_asset_id AND owner_id = auth.uid() AND content_id IS NULL AND publication_draft_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_asset_not_found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_publication_submission_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.publication_submissions SET
      status = NEW.status,
      reviewed_at = COALESCE(reviewed_at, now())
    WHERE source_id = NEW.id AND status = 'pending';
    IF NEW.status = 'approved' THEN
      UPDATE public.media_assets SET publication_draft_id = NULL, updated_at = now()
      WHERE publication_draft_id IN (
        SELECT draft_id FROM public.publication_submissions
        WHERE source_id = NEW.id AND status = 'approved' AND draft_id IS NOT NULL
      );
    ELSE
      UPDATE public.media_assets SET abandoned_at = now(), updated_at = now()
      WHERE content_id IS NULL AND publication_draft_id IN (
        SELECT draft_id FROM public.publication_submissions
        WHERE source_id = NEW.id AND status = 'rejected' AND draft_id IS NOT NULL
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contents_sync_publication_submission ON public.contents;
CREATE TRIGGER contents_sync_publication_submission AFTER UPDATE OF status ON public.contents
FOR EACH ROW EXECUTE FUNCTION public.sync_publication_submission_status();
DROP TRIGGER IF EXISTS courses_sync_publication_submission ON public.courses;
CREATE TRIGGER courses_sync_publication_submission AFTER UPDATE OF status ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.sync_publication_submission_status();

GRANT EXECUTE ON FUNCTION public.save_publication_draft(TEXT, TEXT, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_standalone_publication(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_course_publication(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_publication_submission_v1(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_publication_submission_v1(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_publication_draft(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_media_asset(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.replace_course_structure_v2(UUID, JSONB) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.publication_drafts IS 'Rascunhos persistentes do Studio, retomáveis por conta.';
COMMENT ON TABLE public.publication_submissions IS 'Snapshots imutáveis enviados para curadoria; revisões não derrubam a versão pública.';
