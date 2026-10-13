import { AccessToken, TrackSource, RoomServiceClient } from 'npm:livekit-server-sdk@2.19.1';
import { corsHeaders, json, requireUser } from '../_shared/video/http.ts';
import { BUCKET, CHUNK_BYTES, CameraError, generatePairingCode, pairingHash, publicError, storageEndpoint, validateRequest, type JsonObject } from './protocol.ts';

function rtcConfig() {
  const url = Deno.env.get('LIVEKIT_URL'); const key = Deno.env.get('LIVEKIT_API_KEY'); const secret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!url || !key || !secret) throw new CameraError('studio_camera_provider_unavailable', 503);
  return { url, key, secret };
}
async function connection(session: JsonObject, role: string) {
  const { url, key, secret } = rtcConfig();
  const identity = `studio-${role}-${session.id}-${role === 'device' ? session.deviceId : session.controllerId}`;
  const token = new AccessToken(key, secret, { identity, ttl: '5m' });
  token.addGrant({ roomJoin: true, room: `classfy-studio-camera-${session.id}`, canPublish: role === 'device',
    canPublishSources: role === 'device' ? [TrackSource.CAMERA] : [], canSubscribe: role === 'controller', canPublishData: false });
  return { url, token: await token.toJwt(), identity, expiresAt: new Date(Date.now() + 300_000).toISOString() };
}

export async function handleCameraRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.', serverAt: new Date().toISOString() }, 405);
  try {
    const { user, client } = await requireUser(req).catch(() => { throw new CameraError('unauthorized', 401); });
    const input = await req.text();
    if (new TextEncoder().encode(input).byteLength > 32768) throw new CameraError('studio_camera_invalid_request', 413);
    let parsed: unknown; try { parsed = JSON.parse(input); } catch { throw new CameraError('studio_camera_invalid_request'); }
    const { action, params } = validateRequest(parsed);
    let code: string | undefined;
    if (action === 'create') { rtcConfig(); code = generatePairingCode(); params.pairingHash = await pairingHash(code); }
    if (action === 'join') { rtcConfig(); params.pairingHash = await pairingHash(String(params.code)); delete params.code; }
    if (action === 'connect') rtcConfig();
    const { data, error } = await client.rpc('studio_camera_action', { p_user: user.id, p_action: action, p_params: params });
    if (error) throw error;
    const response = data as JsonObject;
    const objectPath = response._objectPath;
    const roomsToClose = response._roomsToClose;
    const partIndex = response._partIndex; const partOffset = response._partOffset;
    const partBytes = response._partBytes; const totalParts = response._totalParts; const partMime = response._partMime;
    const partUploaded = response._partUploaded === true;
    for (const key of Object.keys(response)) if (key.startsWith('_')) delete response[key];
    const session = response.session as JsonObject;
    if (action === 'create' && !session.deviceId) response.pairing = { code, expiresAt: session.expiresAt };
    if (action === 'join' || action === 'connect') response.connection = await connection(session, action === 'join' ? 'device' : String(params.role));
    if (action === 'upload-start') {
      const take = (response.takes as JsonObject[]).find(item => item.id === params.takeId);
      if (take?.status !== 'uploaded') {
        const { data: bucket, error: bucketError } = await client.storage.getBucket(BUCKET);
        if (bucketError) throw new CameraError('studio_camera_provider_unavailable', 503);
        const limit = bucket?.file_size_limit;
        if (limit != null && Number(partBytes) > Number(limit)) throw new CameraError('studio_camera_upload_limit', 413);
        let token = '';
        if (!partUploaded) {
          const { data: signed, error: signError } = await client.storage.from(BUCKET).createSignedUploadUrl(String(objectPath), { upsert: false });
          if (signError || !signed) throw new CameraError('studio_camera_provider_unavailable', 503);
          token = signed.token;
        }
        response.upload = { endpoint: storageEndpoint(Deno.env.get('SUPABASE_URL')!), bucket: BUCKET, path: objectPath,
          token, chunkSize: CHUNK_BYTES, expiresAt: new Date(Date.now() + 7_200_000).toISOString(), maxBytes: limit ?? null,
          partIndex, partOffset, partBytes, totalParts, mime: partMime, uploaded: partUploaded };
      }
    }
    if (action === 'download') {
      const seconds = 600;
      const take = (response.takes as JsonObject[]).find(item => item.id === params.takeId)!;
      const original = take.metadata as JsonObject;
      const count = Math.ceil(Number(original.bytes) / CHUNK_BYTES);
      const start = Number(params.partStart); const end = Math.min(count, start + Number(params.partCount));
      if (start >= count) throw new CameraError('studio_camera_invalid_part');
      const paths = Array.from({ length: end - start }, (_, n) => count === 1 ? String(objectPath) : `${objectPath}/part-${String(start + n).padStart(6, '0')}.bin`);
      const { data: signed, error: signError } = await client.storage.from(BUCKET).createSignedUrls(paths, seconds);
      if (signError || !signed || signed.some(item => item.error || !item.signedUrl)) throw new CameraError('studio_camera_provider_unavailable', 503);
      const parts = signed.map((item, n) => ({ url: item.signedUrl, index: start + n, bytes: Math.min(CHUNK_BYTES, Number(original.bytes) - (start + n) * CHUNK_BYTES) }));
      response.download = { ...(count === 1 ? { url: parts[0].url } : {}), parts, bytes: original.bytes, mime: original.mime,
        totalParts: count, nextPartIndex: end < count ? end : null, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
    }
    if (action === 'close' || action === 'unpair') {
      // Connection and its preview room have no Mux stream, live, or egress.
      try {
        const { url, key, secret } = rtcConfig();
        const rooms = action === 'unpair' && Array.isArray(roomsToClose) ? roomsToClose : [session.id];
        const service = new RoomServiceClient(url.replace(/^ws/, 'http'), key, secret);
        await Promise.allSettled(rooms.map(id => service.deleteRoom(`classfy-studio-camera-${id}`)));
      } catch { /* The durable session is closed even if the provider is offline. */ }
    }
    response.serverAt = new Date().toISOString();
    return json(response);
  } catch (error) {
    // Do not log request bodies, QR codes, LiveKit JWTs or signed storage tokens.
    const result = publicError(error);
    return json({ error: result.message, code: result.code, serverAt: new Date().toISOString() }, result.status);
  }
}
if (import.meta.main) Deno.serve(handleCameraRequest);
