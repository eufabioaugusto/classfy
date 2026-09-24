-- Expose only provider-confirmed, free live sessions to the public home.
-- The function does not return ingest keys, playback IDs or private profile data.
CREATE OR REPLACE FUNCTION public.get_public_home_lives()
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  started_at TIMESTAMPTZ,
  viewer_count INTEGER,
  creator_name TEXT,
  creator_avatar_url TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.title, l.description, l.thumbnail_url, l.started_at,
         COALESCE(l.viewer_count, 0),
         COALESCE(p.creator_channel_name, p.display_name, 'Creator Classfy'),
         p.avatar_url
  FROM public.lives AS l
  JOIN public.profiles AS p ON p.id = l.creator_id
  WHERE l.status = 'live'
    AND l.visibility = 'free'
    AND l.mux_live_stream_id IS NOT NULL
    AND l.started_at IS NOT NULL
  ORDER BY l.started_at DESC
  LIMIT 12;
$$;

REVOKE ALL ON FUNCTION public.get_public_home_lives() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_home_lives() TO anon, authenticated;
