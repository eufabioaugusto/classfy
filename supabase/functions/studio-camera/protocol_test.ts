import { CameraError, configuration, generatePairingCode, metadata, pairingHash, publicError, storageEndpoint, validateRequest } from './protocol.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
function rejects(fn: () => unknown) { try { fn(); } catch (error) { assert(error instanceof CameraError); return; } throw new Error('accepted invalid request'); }
const id = '10000000-0000-4000-8000-000000000001';
const info = { bytes: 1234, mime: 'video/quicktime', width: 3840, height: 2160, fps: 29.97, duration: 3.5 };
Deno.test('persistent discovery and unpair require installation identifiers, never client ownership', () => {
  const discover = validateRequest({ action: 'discover', deviceId: id, controllerId: id, ownerId: 'untrusted' });
  assert(discover.params.deviceId === id && discover.params.controllerId === id && discover.params.ownerId === undefined);
  assert(validateRequest({ action: 'discover', deviceId: id }).params.controllerId === undefined);
  assert(validateRequest({ action: 'unpair', controllerId: id }).params.controllerId === id);
  rejects(() => validateRequest({ action: 'discover', controllerId: id }));
  rejects(() => validateRequest({ action: 'unpair', controllerId: 'bad' }));
});
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
Deno.test('audio selection accepts automatic routing or bounded native input UID only', () => {
  assert(configuration({ audioInputId: null }).audioInputId === null);
  const selected = configuration({ audioInputId: 'USB-Audio-Input-1' });
  assert(selected.audioInputId === 'USB-Audio-Input-1');
  for (const audioInputId of ['', ' ', 'x'.repeat(257), 12, false, {}, [], 'USB\n1']) rejects(() => configuration({ audioInputId }));
});
Deno.test('audio routes carry real device ports and confirmed selection without local file paths', () => {
  const usb = { id: 'USB-Audio-Input-1', name: 'Microfone USB', type: 'USBAudio' }, builtin = { id: 'BuiltInMic', name: 'Microfone do iPhone', type: 'MicrophoneBuiltIn' };
  const audio = { version: 1, available: [builtin, usb], preferredId: usb.id, current: usb, confirmed: true, selecting: false, warning: null };
  const route = validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { audioInput: audio,
    audioMonitor: { status: 'live', input: usb, channels: [{ averageDb: -30, peakDb: -12 }] } } }).params.state as Record<string, unknown>;
  assert(JSON.stringify(route.audioInput) === JSON.stringify(audio));
  assert(((route.audioMonitor as Record<string, unknown>).input as Record<string, unknown>).id === usb.id);
  const lost = validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { audioInput: { ...audio, available: [builtin], current: builtin, confirmed: false, warning: 'O microfone USB foi desconectado.' } } });
  assert(((lost.params.state as Record<string, unknown>).audioInput as Record<string, unknown>).confirmed === false);
  for (const patch of [{ version: 2 }, { available: [usb, usb] }, { available: [{ ...usb, id: '' }] }, { current: { ...usb, name: '' } }, { preferredId: 1 }, { confirmed: 'true' }, { selecting: null }, { warning: 'x'.repeat(501) }])
    rejects(() => validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { audioInput: { ...audio, ...patch } } }));
  rejects(() => validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { audioInput: { ...audio, current: { ...usb, token: 'private' } } } }));
});
Deno.test('audio levels are bounded and legacy input labels remain usable without selection support', () => {
  const monitor = { status: 'live', input: { name: 'Microfone do iPhone', type: 'MicrophoneBuiltIn' }, channels: [{ averageDb: -40, peakDb: -10 }] };
  const legacy = validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { audioMonitor: monitor } });
  assert(((legacy.params.state as Record<string, unknown>).audioMonitor as Record<string, unknown>).status === 'live');
  for (const patch of [{ status: 'fake' }, { channels: [{ averageDb: NaN, peakDb: -12 }] }, { channels: [{ averageDb: -200, peakDb: -12 }] }, { channels: Array.from({ length: 9 }, () => ({ averageDb: -30, peakDb: -12 })) }])
    rejects(() => validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { audioMonitor: { ...monitor, ...patch } } }));
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
Deno.test('paused original explains the real app recovery action without replacing its session', () => {
  const paused = publicError({ message: 'studio_camera_pending_upload' });
  assert(paused.status === 409 && paused.code === 'studio_camera_pending_upload');
  assert(paused.message === 'Há um envio pausado no iPhone. Retome o envio no app antes de abrir uma nova sessão.');
});
Deno.test('TUS uses direct storage host in production and retains local origins', () => {
  assert(storageEndpoint('https://abcd.supabase.co') === 'https://abcd.storage.supabase.co/storage/v1/upload/resumable/sign');
  assert(storageEndpoint('http://127.0.0.1:54321') === 'http://127.0.0.1:54321/storage/v1/upload/resumable/sign');
});
Deno.test('multipart requests keep original metadata and restrict recovery to a paired device identity', () => {
  const request = validateRequest({ action: 'upload-start', sessionId: id, takeId: id, partIndex: 3, metadata: { ...info, bytes: 30_000_000 }, recovered: true, deviceId: id });
  assert(request.params.partIndex === 3 && request.params.deviceId === id && request.params.recovered === true);
  assert((request.params.metadata as Record<string, unknown>).bytes === 30_000_000);
  rejects(() => validateRequest({ action: 'upload-start', sessionId: id, takeId: id, metadata: info, recovered: true }));
  rejects(() => validateRequest({ action: 'download', sessionId: id, takeId: id, partCount: 101 }));
});
Deno.test('resume-upload requires the original take and preserves a bounded fresh transfer receipt', () => {
  const request = validateRequest({ action: 'command', sessionId: id, commandId: id, type: 'resume_upload', payload: { takeId: id, path: 'forged-original' } });
  assert(JSON.stringify(request.params.payload) === JSON.stringify({ takeId: id }));
  rejects(() => validateRequest({ action: 'command', sessionId: id, commandId: id, type: 'resume_upload', payload: {} }));
  const receipt = { ok: true, takeId: id, uploadState: 'uploading', uploadProgressBytes: 0, uploadTotalBytes: 1234, uploadResumedAtServerMs: 123456,
    uploadTakeId: id, uploadError: null, uploading: false, state: { uploadTakeId: id, uploadResumedAtServerMs: 123456, uploadState: 'uploading', uploadError: null } };
  const ack = validateRequest({ action: 'ack', sessionId: id, deviceId: id, commandId: id, result: receipt });
  const result = ack.params.result as Record<string, unknown>; assert(result.uploadResumedAtServerMs === 123456 && result.uploadTotalBytes === 1234 && result.uploadProgressBytes === 0 && result.uploading === false);
  for (const patch of [{ uploadState: 'fake' }, { uploadProgressBytes: -1 }, { uploadProgressBytes: 1235 }, { uploadTotalBytes: Infinity }, { uploadResumedAtServerMs: '123456' }, { uploadResumedAtServerMs: 0 }, { uploadTakeId: 'another-original' }, { uploading: 'true' }]) {
    rejects(() => validateRequest({ action: 'ack', sessionId: id, deviceId: id, commandId: id, result: { ...receipt, ...patch } }));
  }
  rejects(() => validateRequest({ action: 'heartbeat', sessionId: id, role: 'device', clientId: id, state: { uploadProgressBytes: -1 } }));
});

Deno.test('image look and focus point validate exact bounded sensor-independent intent', () => {
  const grade = {preset:'cinematic',intensity:.8,exposure:.5,contrast:.2,saturation:-.1,temperature:.3};
  assert(JSON.stringify(configuration({imageGrade:grade}).imageGrade) === JSON.stringify(grade));
  assert(JSON.stringify(configuration({pro:{focusPoint:{x:.3,y:.4,locked:false}}}).pro) === JSON.stringify({focusPoint:{x:.3,y:.4,locked:false}}));
  for (const patch of [{preset:'fake'},{intensity:2},{exposure:NaN},{contrast:-2},{temperature:Infinity},{saturation:'0'},{uri:'file:///private'}]) rejects(() => configuration({imageGrade:{...grade,...patch}}));
  for (const point of [{x:-.1,y:.5,locked:false},{x:.5,y:1.1,locked:false},{x:.5,y:.5,locked:'true'},{x:.5,y:.5,locked:false,z:1}]) rejects(() => configuration({pro:{focusPoint:point}}));
});
