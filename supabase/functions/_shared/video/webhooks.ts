import type { NormalizedVideoEvent } from './types.ts';

export function normalizeMuxEvent(payload: Record<string, any>): NormalizedVideoEvent | null {
  const data = payload.data ?? {};
  const mapping: Record<string, Pick<NormalizedVideoEvent, 'type' | 'status'>> = {
    'video.upload.asset_created': { type: 'media.processing', status: 'processing' },
    'video.asset.created': { type: 'media.processing', status: 'processing' },
    'video.asset.ready': { type: 'media.ready', status: 'ready' },
    'video.asset.errored': { type: 'media.failed', status: 'failed' },
    'video.asset.deleted': { type: 'media.deleted', status: 'deleted' },
  };
  const normalized = mapping[payload.type];
  if (!normalized) return null;
  const playback = Array.isArray(data.playback_ids) ? data.playback_ids[0] : undefined;
  return {
    id: payload.id,
    provider: 'mux',
    ...normalized,
    providerAssetId: data.asset_id ?? (payload.type.startsWith('video.asset.') ? data.id : undefined),
    providerUploadId: data.upload_id ?? (payload.type === 'video.upload.asset_created' ? data.id : undefined),
    providerPlaybackId: playback?.id,
    occurredAt: payload.created_at ?? new Date().toISOString(),
    durationSeconds: data.duration,
    width: data.max_stored_resolution === 'HD' ? 1920 : undefined,
    height: data.max_stored_resolution === 'HD' ? 1080 : undefined,
    metadata: { mux_status: data.status, errors: data.errors, aspect_ratio: data.aspect_ratio, playback_policy: playback?.policy },
  };
}

export async function verifyMuxWebhook(rawBody: string, signatureHeader: string | null, secret: string, toleranceSeconds = 300) {
  if (!signatureHeader) return false;
  const values = Object.fromEntries(signatureHeader.split(',').map(part => part.split('=', 2)));
  const timestamp = Number(values.t);
  if (!timestamp || !values.v1 || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${values.t}.${rawBody}`));
  const expected = Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, values.v1.toLowerCase());
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
