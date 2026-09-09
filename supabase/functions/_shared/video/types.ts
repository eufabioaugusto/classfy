export type VideoProviderName = 'mux' | 'bunny' | 'mock';
export type MediaStatus = 'created' | 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted' | 'missing';

export interface CreateUploadInput {
  mediaAssetId: string;
  title: string;
  corsOrigin: string;
}

export interface UploadTarget {
  provider: VideoProviderName;
  providerUploadId: string;
  providerAssetId?: string;
  uploadUrl: string;
  method: 'PUT' | 'TUS' | 'MOCK';
  headers?: Record<string, string>;
  expiresAt?: string;
}

export interface PlaybackSource {
  type: 'hls' | 'mp4';
  url: string;
  poster?: string;
  duration?: number;
  expiresAt?: string;
}

export interface NormalizedVideoEvent {
  id: string;
  provider: VideoProviderName;
  type: 'media.processing' | 'media.ready' | 'media.failed' | 'media.deleted';
  providerAssetId?: string;
  providerUploadId?: string;
  providerPlaybackId?: string;
  status: MediaStatus;
  occurredAt: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  metadata: Record<string, unknown>;
}

export interface VideoProvider {
  readonly name: VideoProviderName;
  createUpload(input: CreateUploadInput): Promise<UploadTarget>;
  getPlaybackSource(binding: Record<string, any>, asset: Record<string, any>): Promise<PlaybackSource>;
  deleteAsset(providerAssetId: string): Promise<void>;
}
