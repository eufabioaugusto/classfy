import { supabase } from "@/integrations/supabase/client";
import type { PlaybackSource, VideoUploadTarget } from "./types";

class VideoService {
  async createUpload(title: string): Promise<VideoUploadTarget> {
    const { data, error } = await supabase.functions.invoke("video-create-upload", {
      body: { title, corsOrigin: window.location.origin },
    });
    if (error || !data?.mediaAssetId) throw new Error(data?.error || error?.message || "Não foi possível preparar o upload");
    return data as VideoUploadTarget;
  }

  async getPlaybackSource(mediaAssetId: string): Promise<PlaybackSource> {
    const { data, error } = await supabase.functions.invoke("video-playback", { body: { mediaAssetId } });
    if (error || !data?.source) throw new Error(data?.error || error?.message || "Vídeo indisponível");
    return data.source as PlaybackSource;
  }
}

export const videoService = new VideoService();
