-- Arquivos comuns (como materiais de curso) também pertencem ao rascunho e
-- participam do mesmo ciclo de aprovação e limpeza das mídias processadas.

CREATE TABLE IF NOT EXISTS public.publication_draft_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.publication_drafts(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  object_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'committed', 'abandoned', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, bucket, object_path)
);

CREATE INDEX IF NOT EXISTS idx_publication_draft_files_cleanup
ON public.publication_draft_files(state, updated_at)
WHERE state = 'abandoned';

ALTER TABLE public.publication_draft_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators manage own publication draft files"
ON public.publication_draft_files FOR ALL TO authenticated
USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (
  owner_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.publication_drafts draft
    WHERE draft.id = draft_id AND draft.owner_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE OR REPLACE FUNCTION public.sync_publication_draft_file_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.publication_draft_files
    SET state = 'committed', updated_at = now()
    WHERE draft_id = NEW.draft_id AND state = 'draft';
  ELSIF NEW.status = 'rejected' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.publication_draft_files
    SET state = 'draft', updated_at = now()
    WHERE draft_id = NEW.draft_id AND state <> 'deleted';
  ELSIF NEW.status = 'superseded' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.publication_draft_files
    SET state = 'abandoned', updated_at = now()
    WHERE draft_id = NEW.draft_id AND state = 'draft';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_submission_file_state ON public.publication_submissions;
CREATE TRIGGER publication_submission_file_state
AFTER UPDATE OF status ON public.publication_submissions
FOR EACH ROW EXECUTE FUNCTION public.sync_publication_draft_file_state();

CREATE OR REPLACE FUNCTION public.sync_discarded_draft_files()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.state = 'discarded' AND NEW.state IS DISTINCT FROM OLD.state THEN
    UPDATE public.publication_draft_files
    SET state = 'abandoned', updated_at = now()
    WHERE draft_id = NEW.id AND state = 'draft';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_draft_file_discard ON public.publication_drafts;
CREATE TRIGGER publication_draft_file_discard
AFTER UPDATE OF state ON public.publication_drafts
FOR EACH ROW EXECUTE FUNCTION public.sync_discarded_draft_files();

COMMENT ON TABLE public.publication_draft_files IS 'Anexos comuns vinculados ao ciclo de vida de um rascunho do Studio.';
