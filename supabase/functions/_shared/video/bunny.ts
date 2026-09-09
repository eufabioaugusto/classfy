import type { CreateUploadInput, PlaybackSource, UploadTarget, VideoProvider } from './types.ts';

export class BunnyVideoProvider implements VideoProvider {
  readonly name = 'bunny' as const;

  async createUpload(input: CreateUploadInput): Promise<UploadTarget> {
    const libraryId = Deno.env.get('BUNNY_STREAM_LIBRARY_ID');
    const apiKey = Deno.env.get('BUNNY_STREAM_API_KEY');
    if (!libraryId || !apiKey) throw new Error('Bunny credentials are not configured');
    const response = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
      method: 'POST', headers: { AccessKey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title }),
    });
    if (!response.ok) throw new Error(`Bunny API ${response.status}: ${await response.text()}`);
    const video = await response.json();
    const expiration = Math.floor(Date.now() / 1000) + 7200;
    const signature = await sha256(`${libraryId}${apiKey}${expiration}${video.guid}`);
    return {
      provider: this.name, providerUploadId: video.guid, providerAssetId: video.guid,
      uploadUrl: 'https://video.bunnycdn.com/tusupload', method: 'TUS',
      headers: { AuthorizationSignature: signature, AuthorizationExpire: String(expiration), LibraryId: libraryId, VideoId: video.guid },
      expiresAt: new Date(expiration * 1000).toISOString(),
    };
  }

  async getPlaybackSource(binding: Record<string, any>, asset: Record<string, any>): Promise<PlaybackSource> {
    const metadata = binding.provider_metadata ?? {};
    const url = metadata.hls_url;
    if (!url) throw new Error('Video is not ready for playback');
    return { type: 'hls', url, poster: metadata.thumbnail_url, duration: asset.duration_seconds ?? undefined };
  }

  async deleteAsset(providerAssetId: string) {
    const libraryId = Deno.env.get('BUNNY_STREAM_LIBRARY_ID');
    const apiKey = Deno.env.get('BUNNY_STREAM_API_KEY');
    if (!libraryId || !apiKey) throw new Error('Bunny credentials are not configured');
    const response = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos/${providerAssetId}`, { method: 'DELETE', headers: { AccessKey: apiKey } });
    if (!response.ok && response.status !== 404) throw new Error(`Bunny API ${response.status}`);
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
