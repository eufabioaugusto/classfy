import type { CreateUploadInput, PlaybackSource, UploadTarget, VideoProvider } from './types.ts';

export class MockVideoProvider implements VideoProvider {
  readonly name = 'mock' as const;
  async createUpload(input: CreateUploadInput): Promise<UploadTarget> {
    return { provider: this.name, providerUploadId: `upload-${input.mediaAssetId}`, providerAssetId: `asset-${input.mediaAssetId}`, uploadUrl: 'mock://upload', method: 'MOCK' };
  }
  async getPlaybackSource(binding: Record<string, any>, asset: Record<string, any>): Promise<PlaybackSource> {
    return { type: 'mp4', url: binding.provider_metadata?.playback_url ?? Deno.env.get('MOCK_VIDEO_URL') ?? '', duration: asset.duration_seconds ?? undefined };
  }
  async deleteAsset(_providerAssetId: string) {}
}
