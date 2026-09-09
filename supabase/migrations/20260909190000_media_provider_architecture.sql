-- Provider-neutral VOD model. Legacy Bunny columns remain untouched for rollback.
CREATE TYPE public.media_asset_status AS ENUM
  ('created', 'uploading', 'processing', 'ready', 'failed', 'deleted', 'missing');

CREATE TYPE public.media_ingest_mode AS ENUM ('direct_provider', 'master_first');

CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID UNIQUE REFERENCES public.contents(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video')),
  status public.media_asset_status NOT NULL DEFAULT 'created',
  ingest_mode public.media_ingest_mode NOT NULL DEFAULT 'direct_provider',
  duration_seconds NUMERIC,
  width INTEGER,
  height INTEGER,
  aspect_ratio TEXT,
  master_storage_provider TEXT,
  master_storage_key TEXT,
  active_provider_binding_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_master_pair CHECK (
    (master_storage_provider IS NULL) = (master_storage_key IS NULL)
  )
);

CREATE TABLE public.media_provider_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('mux', 'bunny', 'mock', 'classfy')),
  provider_asset_id TEXT,
  provider_upload_id TEXT,
  provider_playback_id TEXT,
  playback_policy TEXT NOT NULL DEFAULT 'signed' CHECK (playback_policy IN ('signed', 'public')),
  status public.media_asset_status NOT NULL DEFAULT 'created',
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_event_at TIMESTAMPTZ,
  last_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (media_asset_id, provider),
  UNIQUE (provider, provider_asset_id),
  UNIQUE (provider, provider_upload_id)
);

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_active_binding_fkey
  FOREIGN KEY (active_provider_binding_id)
  REFERENCES public.media_provider_assets(id) ON DELETE SET NULL;

ALTER TABLE public.contents
  ADD COLUMN IF NOT EXISTS media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contents_media_asset_id
  ON public.contents(media_asset_id) WHERE media_asset_id IS NOT NULL;
CREATE INDEX idx_media_provider_assets_lookup
  ON public.media_provider_assets(media_asset_id, provider, status);
CREATE INDEX idx_media_provider_assets_event
  ON public.media_provider_assets(provider, last_event_id) WHERE last_event_id IS NOT NULL;

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_provider_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and admins can view media assets"
ON public.media_assets FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Owners and admins can view provider bindings"
ON public.media_provider_assets FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.media_assets ma
  WHERE ma.id = media_asset_id
    AND (ma.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
));

-- Existing Bunny VODs become canonical assets without removing compatibility fields.
INSERT INTO public.media_assets (content_id, owner_id, status, duration_seconds)
SELECT c.id, c.creator_id,
  CASE COALESCE(c.bunny_status, '')
    WHEN 'ready' THEN 'ready'::public.media_asset_status
    WHEN 'failed' THEN 'failed'::public.media_asset_status
    ELSE 'processing'::public.media_asset_status
  END,
  c.duration_seconds
FROM public.contents c
WHERE c.bunny_video_id IS NOT NULL
ON CONFLICT (content_id) DO NOTHING;

INSERT INTO public.media_provider_assets (
  media_asset_id, provider, provider_asset_id, provider_playback_id,
  playback_policy, status, provider_metadata
)
SELECT ma.id, 'bunny', c.bunny_video_id, c.bunny_video_id, 'public',
  CASE COALESCE(c.bunny_status, '')
    WHEN 'ready' THEN 'ready'::public.media_asset_status
    WHEN 'failed' THEN 'failed'::public.media_asset_status
    ELSE 'processing'::public.media_asset_status
  END,
  jsonb_strip_nulls(jsonb_build_object(
    'library_id', c.bunny_library_id,
    'hls_url', c.bunny_hls_url,
    'thumbnail_url', c.bunny_thumbnail_url,
    'legacy_backfill', true
  ))
FROM public.contents c
JOIN public.media_assets ma ON ma.content_id = c.id
WHERE c.bunny_video_id IS NOT NULL
ON CONFLICT (media_asset_id, provider) DO NOTHING;

UPDATE public.media_assets ma
SET active_provider_binding_id = mpa.id
FROM public.media_provider_assets mpa
WHERE mpa.media_asset_id = ma.id AND mpa.provider = 'bunny'
  AND ma.active_provider_binding_id IS NULL;

UPDATE public.contents c
SET media_asset_id = ma.id
FROM public.media_assets ma
WHERE ma.content_id = c.id AND c.media_asset_id IS NULL;

COMMENT ON TABLE public.media_assets IS 'Canonical Classfy media identity; independent from streaming providers.';
COMMENT ON TABLE public.media_provider_assets IS 'Replaceable provider bindings; supports parallel migrations and atomic cutover.';
COMMENT ON COLUMN public.media_assets.master_storage_key IS 'Reserved for future independent master storage; null in direct-provider mode.';

CREATE OR REPLACE FUNCTION public.attach_content_media_asset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.media_asset_id IS NOT NULL THEN
    UPDATE public.media_assets
    SET content_id = NEW.id, updated_at = now()
    WHERE id = NEW.media_asset_id AND owner_id = NEW.creator_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or unauthorized media asset';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contents_attach_media_asset
AFTER INSERT OR UPDATE OF media_asset_id ON public.contents
FOR EACH ROW EXECUTE FUNCTION public.attach_content_media_asset();
