import { useEffect, useState } from "react";
import { videoService } from "@/lib/video/service";
import type { VideoContentReference } from "@/lib/video/types";

function playableFallback(url?: string | null) {
  return url?.startsWith("media:") ? "" : (url ?? "");
}

export function usePlaybackSource(content: VideoContentReference, enabled = true) {
  const [url, setUrl] = useState(playableFallback(content.file_url));
  const [resolvedMediaAssetId, setResolvedMediaAssetId] = useState<string | null>(null);
  const [poster, setPoster] = useState(content.thumbnail_url ?? "");
  const [loading, setLoading] = useState(Boolean(content.media_asset_id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    if (!enabled) {
      setUrl(content.media_asset_id ? "" : playableFallback(content.file_url));
      setResolvedMediaAssetId(null);
      setPoster(content.thumbnail_url ?? "");
      setLoading(false);
      return () => { active = false; };
    }
    if (!content.media_asset_id) {
      setUrl(playableFallback(content.file_url));
      setResolvedMediaAssetId(null);
      setPoster(content.thumbnail_url ?? "");
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    videoService.getPlaybackSource(content.media_asset_id)
      .then(source => {
        if (!active) return;
        setUrl(source.url);
        setResolvedMediaAssetId(content.media_asset_id ?? null);
        if (source.poster) setPoster(source.poster);
      })
      .catch(reason => active && setError(reason instanceof Error ? reason.message : "Vídeo indisponível"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [enabled, content.media_asset_id, content.file_url, content.thumbnail_url]);

  const resolvedUrl = content.media_asset_id && resolvedMediaAssetId !== content.media_asset_id ? "" : url;
  return { url: resolvedUrl, poster, loading, error };
}
