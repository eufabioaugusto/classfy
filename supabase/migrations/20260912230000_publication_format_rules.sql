-- Catálogo único de requisitos por formato. O editor lê estes valores e o
-- banco os aplica novamente no momento imutável da submissão.

CREATE TABLE IF NOT EXISTS public.publication_format_rules (
  kind TEXT PRIMARY KEY CHECK (kind IN ('aula', 'podcast', 'short', 'curso')),
  media_type TEXT CHECK (media_type IS NULL OR media_type IN ('video', 'audio')),
  allowed_mime_types TEXT[] NOT NULL DEFAULT '{}',
  max_duration_seconds INTEGER CHECK (max_duration_seconds IS NULL OR max_duration_seconds > 0),
  cover_ratio TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.publication_format_rules (kind, media_type, allowed_mime_types, max_duration_seconds, cover_ratio)
VALUES
  ('aula', 'video', ARRAY['video/mp4','video/webm','video/quicktime'], NULL, '16:9'),
  ('podcast', 'audio', ARRAY['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/ogg'], NULL, '1:1 ou 16:9'),
  ('short', 'video', ARRAY['video/mp4','video/webm','video/quicktime'], 180, '9:16'),
  ('curso', NULL, ARRAY['video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/ogg'], NULL, '16:9')
ON CONFLICT (kind) DO UPDATE SET
  media_type = EXCLUDED.media_type,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  max_duration_seconds = EXCLUDED.max_duration_seconds,
  cover_ratio = EXCLUDED.cover_ratio,
  updated_at = now();

ALTER TABLE public.publication_format_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read publication format rules"
ON public.publication_format_rules FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins manage publication format rules"
ON public.publication_format_rules FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.validate_publication_submission_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.publication_format_rules;
  v_asset_type TEXT;
BEGIN
  SELECT * INTO v_rule FROM public.publication_format_rules WHERE kind = NEW.kind;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication_rule_not_found'; END IF;

  IF NEW.kind <> 'curso' THEN
    IF v_rule.max_duration_seconds IS NOT NULL
      AND COALESCE((NEW.snapshot->>'duration')::integer, 0) > v_rule.max_duration_seconds THEN
      RAISE EXCEPTION 'media_too_long';
    END IF;

    SELECT media_type INTO v_asset_type
    FROM public.media_assets
    WHERE id = (NEW.snapshot->>'mediaAssetId')::uuid AND owner_id = NEW.owner_id;
    IF v_asset_type IS DISTINCT FROM v_rule.media_type THEN
      RAISE EXCEPTION 'invalid_media_type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_submission_rules ON public.publication_submissions;
CREATE TRIGGER publication_submission_rules
BEFORE INSERT ON public.publication_submissions
FOR EACH ROW EXECUTE FUNCTION public.validate_publication_submission_rules();

COMMENT ON TABLE public.publication_format_rules IS 'Requisitos canônicos de mídia usados pelo Studio e pela validação de submissões.';
