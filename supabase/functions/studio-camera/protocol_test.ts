import { CameraError, configuration, generatePairingCode, metadata, pairingHash, publicError, storageEndpoint, validateRequest } from './protocol.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
function rejects(fn: () => unknown) { try { fn(); } catch (error) { assert(error instanceof CameraError); return; } throw new Error('accepted invalid request'); }
const id = '10000000-0000-4000-8000-000000000001';
const info = { bytes: 1234, mime: 'video/quicktime', width: 3840, height: 2160, fps: 29.97, duration: 3.5 };
Deno.test('pairing uses 256 random bits and only a SHA-256 digest reaches the database', async () => {
  const codes = Array.from({ length: 50 }, generatePairingCode);
  assert(new Set(codes).size === 50); assert(codes.every(code => /^[A-Za-z0-9_-]{43}$/.test(code)));
  const hash = await pairingHash(codes[0]); assert(/^[a-f0-9]{64}$/.test(hash)); assert(hash !== codes[0]);
  assert(await pairingHash(codes[0]) === hash);
});
Deno.test('metadata rejects invented/missing geometry, unsafe sizes and unrelated mime', () => {
  assert(metadata(info).bytes === 1234);
  for (const patch of [{ bytes: 0 }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { bytes: '1234' }, { mime: 'image/png' },
    { width: NaN }, { width: 0 }, { height: 7681 }, { fps: 121 }, { duration: 0 }, { duration: undefined }]) rejects(() => metadata({ ...info, ...patch }));
});
Deno.test('configure accepts capability-driven Pro but validates quality and keys', () => {
  assert(configuration({ resolution: '4k', fps: 24, cameraFacing: 'back', pro: { iso: 100 } }).fps === 24);
  for (const patch of [{ resolution: '8k' }, { fps: '60' }, { cameraFacing: 'usb' }, { ownerId: id }, {}, { pro: { text: 'x'.repeat(9000) } }]) rejects(() => configuration(patch));
});
Deno.test('the request boundary removes ownership/storage/provider fields supplied by clients', () => {
  const request = validateRequest({ action: 'upload-start', sessionId: id, takeId: id, ownerId: id,
    bucket: 'public', path: '../other-user', metadata: { ...info, secret: 'never retained' } });
  assert(request.params.ownerId === undefined && request.params.path === undefined && request.params.bucket === undefined);
  assert((request.params.metadata as Record<string, unknown>).secret === undefined);
  rejects(() => validateRequest({ action: 'connect', sessionId: id, role: 'admin', clientId: id }));
  rejects(() => validateRequest({ action: 'ack', sessionId: id, deviceId: id, commandId: id, result: { ok: 'yes' } }));
  rejects(() => validateRequest({ action: 'status', sessionId: id, afterSequence: -1 }));
  rejects(() => validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { connection: { token: 'do not persist' } } }));
});
Deno.test('command has stable IDs and acknowledgements carry confirmed take timing', () => {
  const start = validateRequest({ action: 'command', sessionId: id, commandId: id, type: 'start', payload: { takeId: id, unsafe: true } });
  assert(JSON.stringify(start.params.payload) === JSON.stringify({ takeId: id }));
  const ack = validateRequest({ action: 'ack', sessionId: id, deviceId: id, commandId: id,
    result: { ok: true, takeId: id, startedAtServerMs: 123456, metadata: info, state: { recording: true } } });
  assert((ack.params.result as Record<string, unknown>).startedAtServerMs === 123456);
});
Deno.test('provider errors cannot expose a token or URL; auth failure remains 401', () => {
  const provider = publicError(new Error('https://provider/private?token=secret'));
  assert(provider.code === 'studio_camera_operation_failed'); assert(!JSON.stringify(provider).includes('secret'));
  assert(publicError(new CameraError('unauthorized', 401)).status === 401);
  assert(publicError({ message: 'studio_camera_premium_required' }).status === 403);
});
Deno.test('TUS uses direct storage host in production and retains local origins', () => {
  assert(storageEndpoint('https://abcd.supabase.co') === 'https://abcd.storage.supabase.co/storage/v1/upload/resumable');
  assert(storageEndpoint('http://127.0.0.1:54321') === 'http://127.0.0.1:54321/storage/v1/upload/resumable');
});
Deno.test('multipart requests keep original metadata and restrict recovery to a paired device identity', () => {
  const request = validateRequest({ action: 'upload-start', sessionId: id, takeId: id, partIndex: 3, metadata: { ...info, bytes: 30_000_000 }, recovered: true, deviceId: id });
  assert(request.params.partIndex === 3 && request.params.deviceId === id && request.params.recovered === true);
  assert((request.params.metadata as Record<string, unknown>).bytes === 30_000_000);
  rejects(() => validateRequest({ action: 'upload-start', sessionId: id, takeId: id, metadata: info, recovered: true }));
  rejects(() => validateRequest({ action: 'download', sessionId: id, takeId: id, partCount: 101 }));
});
