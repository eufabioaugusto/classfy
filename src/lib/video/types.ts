export type MediaStatus = "created" | "uploading" | "processing" | "ready" | "failed" | "deleted" | "missing";

export interface PlaybackSource {
  type: "hls" | "mp4";
  url: string;
  poster?: string;
  duration?: number;
  expiresAt?: string;
}

export interface VideoUploadTarget {
  mediaAssetId: string;
  provider: "mux" | "bunny" | "mock";
  providerUploadId: string;
  providerAssetId?: string;
  uploadUrl: string;
  method: "PUT" | "TUS" | "MOCK";
  headers?: Record<string, string>;
  expiresAt?: string;
}

export interface VideoContentReference {
  media_asset_id?: string | null;
  file_url?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
}
