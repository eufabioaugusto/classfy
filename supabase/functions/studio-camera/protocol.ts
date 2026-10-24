/** Validation at the edge boundary. No client owns entitlement or storage paths. */
export class CameraError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PAIRING_CODE = /^[A-Za-z0-9_-]{43}$/;
export const BUCKET = 'studio-camera-originals';
export const CHUNK_BYTES = 6 * 1024 * 1024;
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CameraError('studio_camera_invalid_request');
  return value as JsonObject;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CameraError('studio_camera_invalid_request');
  return value.toLowerCase();
}
function finite(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value)))
    throw new CameraError('studio_camera_invalid_metadata');
  return value;
}
export function metadata(value: unknown): JsonObject {
  const source = object(value);
  if (!['video/mp4', 'video/quicktime'].includes(String(source.mime))) throw new CameraError('studio_camera_invalid_metadata');
  return {
    bytes: finite(source.bytes, 1, Number.MAX_SAFE_INTEGER, true), mime: source.mime,
    width: finite(source.width, 1, 7680, true), height: finite(source.height, 1, 7680, true),
    fps: finite(source.fps, 1, 120), duration: finite(source.duration, 0.001, 86400),
    ...(source.startedAtServerMs === undefined ? {} : { startedAtServerMs: finite(source.startedAtServerMs, 0, Number.MAX_SAFE_INTEGER) }),
  };
}
function boundedObject(value: unknown, max = 8192): JsonObject {
  const result = object(value);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > max) throw new CameraError('studio_camera_invalid_request');
  // Connection credentials and local paths never belong in durable device state.
  const inspect = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (/^(token|accessToken|refreshToken|secret|password|authorization|code|pairingCode|uri|url)$/i.test(key))
        throw new CameraError('studio_camera_invalid_request');
      inspect(child);
    }
  };
  inspect(result);
  return result;
}
function transferReceipt(source: JsonObject): JsonObject {
  const result: JsonObject = {};
  if (source.uploadState !== undefined) {
    if (!['idle', 'uploading', 'paused', 'complete'].includes(String(source.uploadState))) throw new CameraError('studio_camera_invalid_request');
    result.uploadState = source.uploadState;
  }
  for (const key of ['uploadProgressBytes', 'uploadTotalBytes']) if (source[key] !== undefined) result[key] = finite(source[key], 0, Number.MAX_SAFE_INTEGER, true);
  if (source.uploadResumedAtServerMs !== undefined) result.uploadResumedAtServerMs = finite(source.uploadResumedAtServerMs, 1, Number.MAX_SAFE_INTEGER);
  if (source.uploadTakeId !== undefined) result.uploadTakeId = source.uploadTakeId === null ? null : uuid(source.uploadTakeId);
  if (source.uploading !== undefined) { if (typeof source.uploading !== 'boolean') throw new CameraError('studio_camera_invalid_request'); result.uploading = source.uploading; }
  if (source.uploadError !== undefined) { if (source.uploadError !== null && typeof source.uploadError !== 'string') throw new CameraError('studio_camera_invalid_request'); result.uploadError = source.uploadError === null ? null : String(source.uploadError).slice(0, 300); }
  if (typeof result.uploadProgressBytes === 'number' && typeof result.uploadTotalBytes === 'number' && result.uploadProgressBytes > result.uploadTotalBytes) throw new CameraError('studio_camera_invalid_metadata');
  return result;
}
function audioUID(value: unknown, code = 'studio_camera_invalid_request'): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new CameraError(code);
  return value;
}
function audioText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new CameraError('studio_camera_invalid_request');
  return value;
}
function audioPort(value: unknown, legacy = false): JsonObject {
  const port = object(value);
  return { ...(legacy && port.id === undefined ? {} : { id: audioUID(port.id) }), name: audioText(port.name, 256), type: audioText(port.type, 64) };
}
function audioInput(value: unknown): JsonObject {
  const state = object(value);
  if (state.version !== 1 || !Array.isArray(state.available) || state.available.length > 32 || typeof state.confirmed !== 'boolean' || typeof state.selecting !== 'boolean') throw new CameraError('studio_camera_invalid_request');
  const available = state.available.map(port => audioPort(port));
  if (new Set(available.map(port => port.id)).size !== available.length) throw new CameraError('studio_camera_invalid_request');
  if (state.warning !== null && (typeof state.warning !== 'string' || state.warning.length > 500)) throw new CameraError('studio_camera_invalid_request');
  return { version: 1, available, preferredId: state.preferredId === null ? null : audioUID(state.preferredId),
    current: state.current === null ? null : audioPort(state.current), confirmed: state.confirmed, selecting: state.selecting, warning: state.warning };
}
function audioMonitor(value: unknown): JsonObject {
  const monitor = object(value);
  if (!['waiting', 'live', 'unavailable', 'interrupted'].includes(String(monitor.status)) || !Array.isArray(monitor.channels) || monitor.channels.length > 8) throw new CameraError('studio_camera_invalid_request');
  if (monitor.message !== undefined && (typeof monitor.message !== 'string' || monitor.message.length > 500)) throw new CameraError('studio_camera_invalid_request');
  return { status: monitor.status, input: monitor.input === null ? null : audioPort(monitor.input, true), channels: monitor.channels.map(value => {
    const channel = object(value); return { averageDb: finite(channel.averageDb, -160, 24), peakDb: finite(channel.peakDb, -160, 24) };
  }), ...(monitor.message === undefined ? {} : { message: monitor.message }) };
}
function deviceState(value: unknown): JsonObject {
  const state = boundedObject(value, 12000); return { ...state, ...transferReceipt(state),
    ...(state.audioInput === undefined ? {} : { audioInput: audioInput(state.audioInput) }),
    ...(state.audioMonitor === undefined ? {} : { audioMonitor: audioMonitor(state.audioMonitor) }) };
}
export function configuration(value: unknown): JsonObject {
  const source = object(value); const result: JsonObject = {};
  for (const key of Object.keys(source)) if (!['resolution', 'fps', 'cameraFacing', 'pro', 'imageGrade', 'audioInputId'].includes(key)) throw new CameraError('studio_camera_invalid_configuration');
  if (source.resolution !== undefined) {
    if (!['720p', '1080p', '2k', '4k'].includes(String(source.resolution))) throw new CameraError('studio_camera_invalid_configuration');
    result.resolution = source.resolution;
  }
  if (source.fps !== undefined) {
    if (![24, 30, 60].includes(source.fps as number)) throw new CameraError('studio_camera_invalid_configuration');
    result.fps = source.fps;
  }
  if (source.cameraFacing !== undefined) {
    if (!['front', 'back'].includes(String(source.cameraFacing))) throw new CameraError('studio_camera_invalid_configuration');
    result.cameraFacing = source.cameraFacing;
  }
  if (source.audioInputId !== undefined) result.audioInputId = source.audioInputId === null ? null : audioUID(source.audioInputId, 'studio_camera_invalid_configuration');
  if (source.pro !== undefined) {
    const pro = boundedObject(source.pro);
    if (pro.focusPoint !== undefined) {
      const point = object(pro.focusPoint);
      if (Object.keys(point).some(key => !['x','y','locked'].includes(key)) || typeof point.locked !== 'boolean') throw new CameraError('studio_camera_invalid_configuration');
      pro.focusPoint = {x: finite(point.x,0,1), y: finite(point.y,0,1), locked: point.locked};
    }
    result.pro = pro;
  }
  if (source.imageGrade !== undefined) {
    const grade = object(source.imageGrade);
    if (Object.keys(grade).some(key => !['preset','intensity','exposure','contrast','saturation','temperature'].includes(key)) || !['natural','studio','cinematic'].includes(String(grade.preset))) throw new CameraError('studio_camera_invalid_configuration');
    result.imageGrade = {preset: grade.preset, intensity: finite(grade.intensity,0,1), exposure: finite(grade.exposure,-2,2),
      contrast: finite(grade.contrast,-1,1), saturation: finite(grade.saturation,-1,1), temperature: finite(grade.temperature,-1,1)};
  }
  if (!Object.keys(result).length) throw new CameraError('studio_camera_invalid_configuration');
  return result;
}
/** The mobile monitor carries display state only, never instructions or originals. */
export function monitorState(value: unknown): JsonObject {
  const state = object(value); const result: JsonObject = {};
  if (Object.keys(state).some(key => !['recording', 'elapsedSeconds', 'width', 'height', 'fps', 'cameraFacing'].includes(key)))
    throw new CameraError('studio_camera_invalid_request');
  if (state.recording !== undefined) {
    if (typeof state.recording !== 'boolean') throw new CameraError('studio_camera_invalid_request');
    result.recording = state.recording;
  }
  if (state.elapsedSeconds !== undefined) result.elapsedSeconds = finite(state.elapsedSeconds, 0, 86400);
  for (const dimension of ['width', 'height']) if (state[dimension] !== undefined) result[dimension] = finite(state[dimension], 1, 7680, true);
  if (state.fps !== undefined) result.fps = finite(state.fps, 1, 120);
  if (state.cameraFacing !== undefined) {
    if (!['front', 'back'].includes(String(state.cameraFacing))) throw new CameraError('studio_camera_invalid_request');
    result.cameraFacing = state.cameraFacing;
  }
  return result;
}
export function validateRequest(value: unknown): { action: string; params: JsonObject } {
  const source = object(value); const action = String(source.action ?? ''); const params: JsonObject = {};
  if (action === 'thumbnail_put' || action === 'thumbnail_get') {
    params.sessionId = uuid(source.sessionId); params.takeId = uuid(source.takeId); params.clientId = uuid(source.clientId);
    const role = action === 'thumbnail_put' ? 'device' : 'controller';
    if (source.role !== role) throw new CameraError('studio_camera_invalid_request');
    params.role = role;
    if (action === 'thumbnail_put') {
      const thumbnail = object(source.thumbnail);
      if (thumbnail.version !== 1 || thumbnail.mime !== 'image/jpeg' || typeof thumbnail.base64 !== 'string' || thumbnail.base64.length > 21848 ||
          !Number.isSafeInteger(thumbnail.width) || Number(thumbnail.width) < 1 || Number(thumbnail.width) > 320 ||
          !Number.isSafeInteger(thumbnail.height) || Number(thumbnail.height) < 1 || Number(thumbnail.height) > 320) throw new CameraError('studio_camera_invalid_thumbnail');
      params.thumbnail = { version: 1, mime: 'image/jpeg', width: thumbnail.width, height: thumbnail.height, base64: thumbnail.base64 };
    }
    return { action, params };
  }
  if (action.startsWith('monitor-')) {
    if (!['monitor-create', 'monitor-discover', 'monitor-connect', 'monitor-heartbeat', 'monitor-close'].includes(action))
      throw new CameraError('studio_camera_unknown_action');
    if (action === 'monitor-discover') return { action, params };
    params.sessionId = uuid(source.sessionId);
    if (action === 'monitor-create' || action === 'monitor-close') params.deviceId = uuid(source.deviceId);
    if (action === 'monitor-create') {
      if (!['aula', 'short'].includes(String(source.kind)) || source.title !== undefined && (typeof source.title !== 'string' || source.title.length > 150))
        throw new CameraError('studio_camera_invalid_request');
      params.kind = source.kind; params.title = source.title ?? '';
    }
    if (action === 'monitor-connect' || action === 'monitor-heartbeat') {
      if (!['viewer', 'device'].includes(String(source.role))) throw new CameraError('studio_camera_invalid_request');
      params.role = source.role; params.clientId = uuid(source.clientId);
      if (source.state !== undefined) {
        if (action !== 'monitor-heartbeat' || source.role !== 'device') throw new CameraError('studio_camera_invalid_request');
        params.state = monitorState(source.state);
      }
    }
    return { action, params };
  }
  if (!['create', 'join', 'discover', 'unpair', 'connect', 'status', 'command', 'ack', 'heartbeat', 'upload-start', 'upload-complete', 'download', 'close'].includes(action))
    throw new CameraError('studio_camera_unknown_action');
  if (action === 'create') {
    if (!['aula', 'short'].includes(String(source.kind))) throw new CameraError('studio_camera_invalid_request');
    params.kind = source.kind; params.controllerId = uuid(source.controllerId);
    if (source.projectId != null) params.projectId = uuid(source.projectId);
    if (source.title !== undefined && (typeof source.title !== 'string' || source.title.length > 150)) throw new CameraError('studio_camera_invalid_request');
    params.title = source.title ?? '';
  } else if (action === 'join') {
    if (typeof source.code !== 'string' || !PAIRING_CODE.test(source.code)) throw new CameraError('studio_camera_pairing_unavailable', 409);
    params.code = source.code; params.deviceId = uuid(source.deviceId);
  } else if (action === 'discover') {
    params.deviceId = uuid(source.deviceId);
    if (source.controllerId != null) params.controllerId = uuid(source.controllerId);
  } else if (action === 'unpair') {
    params.controllerId = uuid(source.controllerId);
  } else {
    params.sessionId = uuid(source.sessionId);
    if (action === 'status' || action === 'heartbeat') {
      if (source.afterSequence !== undefined) params.afterSequence = finite(source.afterSequence, 0, Number.MAX_SAFE_INTEGER, true);
    }
    if (action === 'connect' || action === 'heartbeat') {
      if (!['controller', 'device'].includes(String(source.role))) throw new CameraError('studio_camera_invalid_request');
      params.role = source.role; params.clientId = uuid(source.clientId);
    }
    if (action === 'heartbeat') params.state = source.state === undefined ? {} : deviceState(source.state);
    if (action === 'command') {
      params.commandId = uuid(source.commandId); params.type = source.type;
      if (!['configure', 'start', 'stop', 'resume_upload'].includes(String(source.type))) throw new CameraError('studio_camera_invalid_request');
      params.payload = source.type === 'configure' ? configuration(source.payload)
        : ['start', 'resume_upload'].includes(String(source.type)) ? { takeId: uuid(object(source.payload).takeId) } : {};
    }
    if (action === 'ack') {
      params.commandId = uuid(source.commandId); params.deviceId = uuid(source.deviceId);
      const result = object(source.result);
      if (typeof result.ok !== 'boolean') throw new CameraError('studio_camera_invalid_request');
      params.result = {
        ok: result.ok,
        ...(result.state === undefined ? {} : { state: deviceState(result.state) }),
        ...(result.takeId === undefined ? {} : { takeId: uuid(result.takeId) }),
        ...(result.startedAtServerMs === undefined ? {} : { startedAtServerMs: finite(result.startedAtServerMs, 0, Number.MAX_SAFE_INTEGER) }),
        ...(result.metadata === undefined ? {} : { metadata: metadata(result.metadata) }),
        ...(typeof result.error === 'string' ? { error: result.error.slice(0, 300) } : {}),
        ...transferReceipt(result),
      };
    }
    if (['upload-start', 'upload-complete', 'download'].includes(action)) params.takeId = uuid(source.takeId);
    if (action === 'upload-start') {
      params.metadata = metadata(source.metadata);
      params.partIndex = source.partIndex === undefined ? 0 : finite(source.partIndex, 0, 99999, true);
      if (Math.ceil(Number((params.metadata as JsonObject).bytes) / CHUNK_BYTES) > 100000) throw new CameraError('studio_camera_invalid_part');
      if (source.recovered === true) { params.recovered = true; params.deviceId = uuid(source.deviceId); }
      else if (source.recovered !== undefined && source.recovered !== false) throw new CameraError('studio_camera_invalid_request');
    }
    if (action === 'download') {
      params.partStart = source.partStart === undefined ? 0 : finite(source.partStart, 0, 99999, true);
      params.partCount = source.partCount === undefined ? 100 : finite(source.partCount, 1, 100, true);
    }
  }
  return { action, params };
}
export function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function pairingHash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function storageEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.storage.supabase.co')) url.hostname = url.hostname.replace('.supabase.co', '.storage.supabase.co');
  // Signed upload grants use the dedicated TUS route. The regular route
  // expects an Authorization JWT and rejects an x-signature-only request.
  url.pathname = '/storage/v1/upload/resumable/sign'; url.search = ''; url.hash = '';
  return url.toString();
}
export const errors: Record<string, { status: number; message: string }> = {
  studio_camera_invalid_thumbnail: { status: 400, message: 'A miniatura deste take não pôde ser validada.' },
  studio_camera_thumbnail_unavailable: { status: 404, message: 'A miniatura deste take ainda não está disponível.' },
  studio_camera_thumbnail_conflict: { status: 409, message: 'Este take já possui outra miniatura confirmada.' },
  studio_camera_premium_required: { status: 403, message: 'A câmera remota faz parte do Premium.' },
  studio_camera_creator_required: { status: 403, message: 'Este recurso está disponível para creators aprovados.' },
  studio_camera_not_found: { status: 404, message: 'Conexão não encontrada.' },
  studio_camera_take_not_found: { status: 404, message: 'Take não encontrado.' },
  studio_camera_pairing_unavailable: { status: 409, message: 'Código expirado, já utilizado ou de outra conta. Gere um novo no Studio.' },
  studio_camera_rate_limited: { status: 429, message: 'Aguarde antes de gerar outra conexão.' },
  studio_camera_device_offline: { status: 409, message: 'Reconecte o iPhone antes de gravar.' },
  studio_camera_busy: { status: 409, message: 'Aguarde a confirmação do iPhone.' },
  studio_camera_pending_upload: { status: 409, message: 'Há um envio pausado no iPhone. Retome o envio no app antes de abrir uma nova sessão.' },
  studio_camera_not_recording: { status: 409, message: 'Não há uma gravação em andamento.' },
  studio_camera_stop_required: { status: 409, message: 'Pare a gravação antes de encerrar a conexão.' },
  studio_camera_original_incomplete: { status: 409, message: 'O envio ainda não foi concluído. O original continua no iPhone.' },
  studio_camera_original_not_ready: { status: 409, message: 'O original ainda está sendo preparado no iPhone.' },
  studio_camera_upload_limit: { status: 413, message: 'Este original ultrapassa o limite de envio disponível. Preserve o arquivo no iPhone.' },
  studio_camera_provider_unavailable: { status: 503, message: 'A conexão da câmera está temporariamente indisponível.' },
  studio_camera_monitor_conflict: { status: 409, message: 'Encerre o monitor do iPhone antes de usar a câmera remota.' },
  studio_camera_monitor_busy: { status: 409, message: 'Já existe um monitor ativo. Encerre-o no iPhone antes de abrir outro.' },
  studio_camera_monitor_expired: { status: 409, message: 'O monitor ficou desconectado. Abra uma nova conexão pelo iPhone.' },
  studio_camera_monitor_premium_required: { status: 403, message: 'Visualizar a câmera do iPhone no computador faz parte do Premium.' },
};
export function publicError(error: unknown): { code: string; message: string; status: number } {
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error ? String((error as JsonObject).message ?? '') : '';
  const code = error instanceof CameraError ? error.code : raw.startsWith('studio_camera_') && /^[a-z_]+$/.test(raw) ? raw : 'studio_camera_operation_failed';
  const detail = errors[code];
  return { code, message: detail?.message ?? 'Não foi possível concluir esta ação. Retome a operação para continuar.', status: detail?.status ?? (error instanceof CameraError ? error.status : code === 'studio_camera_operation_failed' ? 502 : 409) };
}
