import type { CreateUploadInput, PlaybackSource, PreviewOptions, PreviewSource, UploadTarget, VideoProvider } from './types.ts';

const apiBase = 'https://api.mux.com/video/v1';

function credentials() {
  const id = Deno.env.get('MUX_TOKEN_ID');
  const secret = Deno.env.get('MUX_TOKEN_SECRET');
  if (!id || !secret) throw new Error('Mux credentials are not configured');
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

async function muxRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: credentials(), 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`Mux API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : (await response.json()).data;
}

export class MuxVideoProvider implements VideoProvider {
  readonly name = 'mux' as const;

  async createUpload(input: CreateUploadInput): Promise<UploadTarget> {
    const data = await muxRequest('/uploads', {
      method: 'POST',
      body: JSON.stringify({
        cors_origin: input.corsOrigin,
        timeout: 7200,
        new_asset_settings: {
          passthrough: input.mediaAssetId,
          playback_policies: ['signed'],
          video_quality: 'basic',
          meta: { title: input.title, external_id: input.mediaAssetId },
        },
      }),
    });
    return {
      provider: this.name,
      providerUploadId: data.id,
      uploadUrl: data.url,
      method: 'PUT',
      expiresAt: new Date(Date.now() + Number(data.timeout ?? 7200) * 1000).toISOString(),
    };
  }

  async getPlaybackSource(binding: Record<string, any>, asset: Record<string, any>): Promise<PlaybackSource> {
    if (!binding.provider_playback_id) throw new Error('Video is not ready for playback');
    const token = await createMuxPlaybackToken(binding.provider_playback_id, asset.duration_seconds);
    return {
      type: 'hls',
      url: `https://stream.mux.com/${binding.provider_playback_id}.m3u8?token=${token}`,
      duration: asset.duration_seconds ?? undefined,
      expiresAt: new Date(Date.now() + tokenLifetime(asset.duration_seconds) * 1000).toISOString(),
    };
  }

  async getPreviewSource(binding: Record<string, any>, asset: Record<string, any>, options: PreviewOptions = {}): Promise<PreviewSource> {
    if (!binding.provider_playback_id) throw new Error('Video is not ready for preview');

    const start = Math.max(0, Math.floor(options.startSeconds ?? 0));
    const availableDuration = Math.max(1, Math.floor(Number(asset.duration_seconds ?? 10)) - start);
    const duration = Math.min(10, Math.max(1, Math.floor(options.durationSeconds ?? 10)), availableDuration);
    const end = start + duration;
    const fps = Math.min(10, Math.max(1, Math.floor(options.fps ?? 5)));
    const width = Math.min(640, Math.max(320, Math.floor(options.width ?? 640)));
    const expiresIn = 300;
    const params = {
      start: String(start),
      end: String(end),
      fps: String(fps),
      width: String(width),
    };
    const token = await createMuxSignedToken(binding.provider_playback_id, 'g', expiresIn, params);
    const query = new URLSearchParams({ ...params, token });

    return {
      type: 'animated-image',
      url: `https://image.mux.com/${binding.provider_playback_id}/animated.gif?${query}`,
      duration,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async deleteAsset(providerAssetId: string) {
    await muxRequest(`/assets/${providerAssetId}`, { method: 'DELETE' });
  }
}

function tokenLifetime(duration?: number) {
  return Math.max(3600, Math.ceil(Number(duration ?? 0)) + 900);
}

async function createMuxPlaybackToken(playbackId: string, duration?: number) {
  return createMuxSignedToken(playbackId, 'v', tokenLifetime(duration));
}

async function createMuxSignedToken(
  playbackId: string,
  audience: 'v' | 'g',
  lifetimeSeconds: number,
  params: Record<string, string> = {},
) {
  const keyId = Deno.env.get('MUX_SIGNING_KEY_ID');
  const encodedPrivateKey = Deno.env.get('MUX_SIGNING_PRIVATE_KEY');
  if (!keyId || !encodedPrivateKey) throw new Error('Mux playback signing key is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId }));
  const payload = base64url(JSON.stringify({ sub: playbackId, aud: audience, exp: now + lifetimeSeconds, iat: now, ...params }));
  const signingInput = `${header}.${payload}`;
  const pem = new TextDecoder().decode(Uint8Array.from(atob(encodedPrivateKey), c => c.charCodeAt(0)));
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const pkcs8 = pem.includes('BEGIN RSA PRIVATE KEY') ? wrapPkcs1AsPkcs8(der) : der;
  const key = await crypto.subtle.importKey('pkcs8', pkcs8.buffer as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

function base64url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Mux currently returns a base64-encoded PKCS#1 PEM. WebCrypto imports RSA
// private keys as PKCS#8, so wrap the unchanged PKCS#1 DER in PrivateKeyInfo.
function wrapPkcs1AsPkcs8(pkcs1: Uint8Array) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithmIdentifier = Uint8Array.of(
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  );
  const privateKey = derElement(0x04, pkcs1);
  return derElement(0x30, concat(version, rsaAlgorithmIdentifier, privateKey));
}

function derElement(tag: number, value: Uint8Array) {
  return concat(Uint8Array.of(tag), derLength(value.length), value);
}

function derLength(length: number) {
  if (length < 128) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let remaining = length; remaining > 0; remaining >>= 8) bytes.unshift(remaining & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function concat(...arrays: Uint8Array[]) {
  const result = new Uint8Array(arrays.reduce((total, item) => total + item.length, 0));
  let offset = 0;
  for (const item of arrays) {
    result.set(item, offset);
    offset += item.length;
  }
  return result;
}
