-- Rejeições devem voltar ao creator para correção. Os arquivos continuam
-- associados ao rascunho e só entram na limpeza após descarte ou inatividade.

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

  UPDATE public.publication_submissions
  SET status = 'rejected', review_reason = trim(p_reason), reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_submission_id AND status = 'pending'
  RETURNING * INTO v_submission;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission_not_found'; END IF;

  UPDATE public.publication_drafts
  SET state = 'draft', submitted_at = NULL, updated_at = now()
  WHERE id = v_submission.draft_id;

  RETURN jsonb_build_object('success', true, 'sourceId', v_submission.source_id, 'sourceType', v_submission.source_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_publication_submission_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_draft_ids UUID[];
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.publication_submissions
    SET status = NEW.status, reviewed_at = COALESCE(reviewed_at, now())
    WHERE source_id = NEW.id AND status = 'pending';

    SELECT ARRAY_AGG(draft_id) INTO v_draft_ids
    FROM public.publication_submissions
    WHERE source_id = NEW.id AND status = NEW.status AND draft_id IS NOT NULL;

    IF NEW.status = 'approved' THEN
      UPDATE public.media_assets
      SET publication_draft_id = NULL, updated_at = now()
      WHERE v_draft_ids IS NOT NULL AND publication_draft_id = ANY(v_draft_ids);
    ELSE
      UPDATE public.publication_drafts
      SET state = 'draft', submitted_at = NULL, updated_at = now()
      WHERE v_draft_ids IS NOT NULL AND id = ANY(v_draft_ids);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
