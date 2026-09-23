-- Estado da transmissao e do replay. Segredos de ingestao ficam fora de lives.
ALTER TABLE public.lives
  ADD COLUMN IF NOT EXISTS mux_live_stream_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS mux_live_playback_id TEXT,
  ADD COLUMN IF NOT EXISTS mux_recording_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS mux_recording_playback_id TEXT,
  ADD COLUMN IF NOT EXISTS livekit_egress_id TEXT,
  ADD COLUMN IF NOT EXISTS recording_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replay_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replay_content_id UUID REFERENCES public.contents(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.live_stream_secrets (
  live_id UUID PRIMARY KEY REFERENCES public.lives(id) ON DELETE CASCADE,
  mux_stream_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.live_stream_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_stream_secrets FROM anon, authenticated;

-- Uma live só é criada pelo backend depois que o Mux fornece a sala real.
DROP POLICY IF EXISTS "Creators podem criar lives" ON public.lives;
DROP POLICY IF EXISTS "Creators podem deletar próprias lives" ON public.lives;

-- O cliente pode editar metadados, mas somente o backend pode confirmar o estado
-- do provedor e o replay. O campo legado stream_key nunca recebe o segredo.
CREATE OR REPLACE FUNCTION public.protect_live_provider_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'waiting' OR NEW.stream_key IS NOT NULL
         OR NEW.mux_live_stream_id IS NOT NULL OR NEW.mux_live_playback_id IS NOT NULL
         OR NEW.mux_recording_asset_id IS NOT NULL OR NEW.mux_recording_playback_id IS NOT NULL
         OR NEW.livekit_egress_id IS NOT NULL OR NEW.recording_ready_at IS NOT NULL
         OR NEW.replay_published_at IS NOT NULL OR NEW.replay_content_id IS NOT NULL THEN
        RAISE EXCEPTION 'live_provider_state_is_server_only';
      END IF;
    ELSIF ROW(NEW.status, NEW.started_at, NEW.ended_at, NEW.stream_key,
              NEW.playback_url, NEW.recording_url, NEW.mux_live_stream_id,
              NEW.mux_live_playback_id, NEW.mux_recording_asset_id,
              NEW.mux_recording_playback_id, NEW.livekit_egress_id,
              NEW.recording_ready_at, NEW.replay_published_at, NEW.replay_content_id)
       IS DISTINCT FROM ROW(OLD.status, OLD.started_at, OLD.ended_at,
                            OLD.stream_key, OLD.playback_url, OLD.recording_url,
                            OLD.mux_live_stream_id, OLD.mux_live_playback_id,
                            OLD.mux_recording_asset_id, OLD.mux_recording_playback_id,
                            OLD.livekit_egress_id, OLD.recording_ready_at,
                            OLD.replay_published_at, OLD.replay_content_id) THEN
      RAISE EXCEPTION 'live_provider_state_is_server_only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_live_provider_state ON public.lives;
CREATE TRIGGER protect_live_provider_state
BEFORE INSERT OR UPDATE ON public.lives
FOR EACH ROW EXECUTE FUNCTION public.protect_live_provider_state();

CREATE INDEX IF NOT EXISTS lives_mux_recording_asset_id_idx
ON public.lives(mux_recording_asset_id)
WHERE mux_recording_asset_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_live_replay_publication()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_type = 'live' THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE public.lives SET replay_published_at = CASE WHEN NEW.status = 'approved' THEN now() ELSE NULL END
      WHERE replay_content_id = NEW.id;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      UPDATE public.lives SET replay_published_at = CASE WHEN NEW.status = 'approved' THEN now() ELSE NULL END
      WHERE replay_content_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_live_replay_publication ON public.contents;
CREATE TRIGGER sync_live_replay_publication
AFTER INSERT OR UPDATE OF status ON public.contents
FOR EACH ROW EXECUTE FUNCTION public.sync_live_replay_publication();

CREATE OR REPLACE FUNCTION public.submit_live_replay(p_live_id UUID, p_duration_seconds INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_live public.lives%ROWTYPE;
  v_asset_id UUID;
  v_binding_id UUID;
  v_content_id UUID;
BEGIN
  SELECT * INTO v_live FROM public.lives WHERE id = p_live_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'live_not_found'; END IF;
  IF v_live.replay_content_id IS NOT NULL THEN RETURN v_live.replay_content_id; END IF;
  IF v_live.status <> 'ended' OR v_live.recording_ready_at IS NULL
     OR v_live.mux_recording_asset_id IS NULL OR v_live.mux_recording_playback_id IS NULL THEN
    RAISE EXCEPTION 'recording_not_finalized';
  END IF;
  INSERT INTO public.media_assets(owner_id, media_type, status, duration_seconds)
  VALUES (v_live.creator_id, 'video', 'ready', GREATEST(p_duration_seconds, 0)) RETURNING id INTO v_asset_id;
  INSERT INTO public.media_provider_assets(media_asset_id, provider, provider_asset_id,
    provider_playback_id, playback_policy, status)
  VALUES (v_asset_id, 'mux', v_live.mux_recording_asset_id,
    v_live.mux_recording_playback_id, 'signed', 'ready') RETURNING id INTO v_binding_id;
  INSERT INTO public.contents(creator_id, content_type, title, description, thumbnail_url,
    file_url, duration_seconds, visibility, is_free, price, media_asset_id, video_provider, status)
  VALUES (v_live.creator_id, 'live', v_live.title, v_live.description, v_live.thumbnail_url,
    '', GREATEST(p_duration_seconds, 0), v_live.visibility, v_live.visibility = 'free',
    v_live.price, v_asset_id, 'mux', 'pending') RETURNING id INTO v_content_id;
  UPDATE public.media_assets SET active_provider_binding_id = v_binding_id,
    content_id = v_content_id WHERE id = v_asset_id;
  UPDATE public.lives SET replay_content_id = v_content_id WHERE id = p_live_id;
  RETURN v_content_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_live_replay(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_live_replay(UUID, INTEGER) TO service_role;
