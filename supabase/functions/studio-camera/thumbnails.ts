import { CameraError, object, type JsonObject } from './protocol.ts';

export const THUMBNAIL_BUCKET = 'studio-camera-thumbnails';
export const THUMBNAIL_MAX_BYTES = 16 * 1024;
export const THUMBNAIL_MAX_SIDE = 320;
export type CameraThumbnail = { version: 1; bytes: number; mime: 'image/jpeg'; width: number; height: number; hash: string };

/** Inspect bounded JPEG headers; neither a MIME label nor a data URL is proof. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  const invalid = () => new CameraError('studio_camera_invalid_thumbnail');
  if (bytes.length < 16 || bytes.length > THUMBNAIL_MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw invalid();
  let offset = 2, dimensions: { width: number; height: number } | undefined;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9) throw invalid();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length - 2) throw invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (dimensions || length < 11 || bytes[offset + 2] !== 8) throw invalid();
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4], width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width < 1 || height < 1 || width > THUMBNAIL_MAX_SIDE || height > THUMBNAIL_MAX_SIDE) throw invalid();
      dimensions = { width, height };
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) throw invalid();
    if (marker === 0xda) { if (!dimensions || length < 6 || offset + length >= bytes.length - 2) throw invalid(); return dimensions; }
    offset += length;
  }
  throw invalid();
}

export async function decodeThumbnail(value: unknown): Promise<{ bytes: Uint8Array; descriptor: CameraThumbnail }> {
  const source = object(value), encoded = source.base64;
  if (source.version !== 1 || source.mime !== 'image/jpeg' || typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(THUMBNAIL_MAX_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new CameraError('studio_camera_invalid_thumbnail');
  let binary: string; try { binary = atob(encoded); } catch { throw new CameraError('studio_camera_invalid_thumbnail'); }
  if (btoa(binary) !== encoded) throw new CameraError('studio_camera_invalid_thumbnail');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)), dimensions = jpegDimensions(bytes);
  if (source.width !== dimensions.width || source.height !== dimensions.height) throw new CameraError('studio_camera_invalid_thumbnail');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  return { bytes, descriptor: { version: 1, bytes: bytes.length, mime: 'image/jpeg', ...dimensions, hash } };
}

type Result = { data: unknown; error: unknown };
type ThumbnailClient = {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<Result>;
  storage: { from(bucket: string): {
    upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean; cacheControl: string }): PromiseLike<{ error: unknown }>;
    download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
    createSignedUrl(path: string, seconds: number): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
  } };
};

/** A separate media side channel cannot change a take's REC/upload authority. */
export async function handleThumbnail(client: ThumbnailClient, owner: string, action: string, params: JsonObject): Promise<JsonObject> {
  const decoded = action === 'thumbnail_put' ? await decodeThumbnail(params.thumbnail) : undefined;
  const input = { sessionId: params.sessionId, takeId: params.takeId, role: params.role, clientId: params.clientId,
    ...(decoded ? { thumbnail: decoded.descriptor, confirmed: false } : {}) };
  const authorize = async (values: JsonObject) => {
    const result = await client.rpc('studio_camera_thumbnail_action', { p_user: owner, p_action: action, p_params: values });
    if (result.error) throw result.error;
    const response = object(result.data), path = response._objectPath;
    if (typeof path !== 'string' || path !== `${owner}/${params.sessionId}/${params.takeId}/v1.jpg`) throw new CameraError('studio_camera_provider_unavailable', 503);
    return { response, path };
  };
  let { response, path } = await authorize(input);
  const storage = client.storage.from(THUMBNAIL_BUCKET);
  if (decoded) {
    const uploaded = await storage.upload(path, decoded.bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '300' });
    if (uploaded.error) {
      // A lost PUT/commit response may leave this exact immutable object behind.
      const existing = await storage.download(path);
      if (existing.error || !existing.data || existing.data.size > THUMBNAIL_MAX_BYTES) throw new CameraError('studio_camera_provider_unavailable', 503);
      const actual = new Uint8Array(await existing.data.arrayBuffer());
      if (actual.length !== decoded.bytes.length || actual.some((byte, index) => byte !== decoded.bytes[index])) throw new CameraError('studio_camera_thumbnail_conflict', 409);
    }
    ({ response } = await authorize({ ...input, confirmed: true }));
  } else {
    const signed = await storage.createSignedUrl(path, 300);
    if (signed.error || !signed.data?.signedUrl) throw new CameraError('studio_camera_thumbnail_unavailable', 404);
    response.thumbnail = { ...object(response.thumbnail), url: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }
  for (const key of Object.keys(response)) if (key.startsWith('_')) delete response[key];
  response.serverAt = new Date().toISOString(); return response;
}
