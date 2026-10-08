import type * as LegacyFileSystem from 'expo-file-system/legacy';

export type StudioUploadTarget = {
  mediaAssetId: string;
  provider: 'mux' | 'bunny' | 'mock';
  uploadUrl: string;
  method: 'PUT' | 'TUS' | 'MOCK';
  headers?: Record<string, string>;
  expiresAt?: string;
};
export type StudioTransferRequest = {
  ownerId: string;
  projectId: string;
  uri: string;
  name: string;
  mimeType: string;
  fileSize: number;
  target: StudioUploadTarget;
  tusUrl?: string;
  onTusUrl: (url: string) => Promise<void>;
  onProgress?: (percent: number) => void;
  shouldContinue?: () => boolean;
};
type FileSystem = Pick<typeof LegacyFileSystem, 'createUploadTask' | 'readAsStringAsync' | 'FileSystemUploadType' | 'FileSystemSessionType' | 'EncodingType'>;
type TransferDependencies = { fileSystem?: FileSystem; fetch?: typeof fetch; chunkSize?: number };
type ActiveTransfer = { cancelled: boolean; abort: AbortController; task?: { cancelAsync(): Promise<void> } };
const activeTransfers = new Map<string, ActiveTransfer>();
const transferKey = (ownerId: string, projectId: string) => `${ownerId}:${projectId}`;
const defaultChunkSize = 2 * 1024 * 1024;

export class StudioUploadCancelledError extends Error {
  constructor() {
    super('Envio pausado. Seu projeto continua salvo neste dispositivo.');
    this.name = 'StudioUploadCancelledError';
  }
}
export class StudioUploadRestartError extends Error {
  constructor(message = 'O endereço de envio expirou. Prepare o envio novamente.') {
    super(message);
    this.name = 'StudioUploadRestartError';
  }
}

export function decodeBase64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function parseTusOffset(value: string | null, fileSize: number) {
  if (value === null || !/^\d+$/.test(value)) throw new Error('Não foi possível confirmar o ponto de retomada do envio.');
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > fileSize) throw new Error('O ponto de retomada não corresponde a este arquivo.');
  return offset;
}

export function isUploadTargetExpired(expiresAt?: string, now = Date.now()) {
  if (!expiresAt) return false;
  const expiration = Date.parse(expiresAt);
  return !Number.isFinite(expiration) || expiration <= now + 15_000;
}

export function resolveTusLocation(location: string | null, endpoint: string) {
  if (!location) throw new Error('O servidor não confirmou o endereço de retomada.');
  const resolved = new URL(location, endpoint);
  const origin = new URL(endpoint);
  // The provider's signed headers must never be forwarded to another origin.
  if (resolved.protocol !== 'https:' || resolved.origin !== origin.origin) throw new Error('O servidor retornou um endereço de envio inválido.');
  return resolved.toString();
}

function assertTarget(target: StudioUploadTarget) {
  if (target.method === 'MOCK' || target.provider === 'mock') throw new Error('O serviço de publicação não está disponível neste ambiente.');
  if (!target.mediaAssetId || !['PUT', 'TUS'].includes(target.method)) throw new Error('O serviço não preparou um envio válido.');
  const url = new URL(target.uploadUrl);
  if (url.protocol !== 'https:') throw new Error('O endereço de envio não é seguro.');
  if (isUploadTargetExpired(target.expiresAt)) throw new StudioUploadRestartError();
}

export async function cancelStudioTransfer(ownerId: string, projectId: string) {
  const transfer = activeTransfers.get(transferKey(ownerId, projectId));
  if (!transfer) return;
  transfer.cancelled = true;
  transfer.abort.abort();
  await transfer.task?.cancelAsync().catch(() => undefined);
}

export async function uploadStudioFile(request: StudioTransferRequest, dependencies: TransferDependencies = {}) {
  assertTarget(request.target);
  if (!request.uri.startsWith('file://') || !Number.isSafeInteger(request.fileSize) || request.fileSize <= 0) throw new Error('O arquivo local não está disponível para envio.');
  const key = transferKey(request.ownerId, request.projectId);
  if (activeTransfers.has(key)) throw new Error('Este projeto já está sendo enviado.');
  const active: ActiveTransfer = { cancelled: false, abort: new AbortController() };
  activeTransfers.set(key, active);
  const check = () => {
    if (active.cancelled || request.shouldContinue?.() === false) throw new StudioUploadCancelledError();
  };
  try {
    const fileSystem = dependencies.fileSystem ?? await import('expo-file-system/legacy');
    check();
    if (request.target.method === 'PUT') {
      const task = fileSystem.createUploadTask(request.target.uploadUrl, request.uri, {
        httpMethod: 'PUT',
        uploadType: fileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: fileSystem.FileSystemSessionType.FOREGROUND,
        headers: { ...request.target.headers, 'Content-Type': request.mimeType },
      }, progress => {
        if (!active.cancelled && progress.totalBytesExpectedToSend > 0) request.onProgress?.(Math.min(99, Math.round(progress.totalBytesSent / progress.totalBytesExpectedToSend * 100)));
      });
      active.task = task;
      const response = await task.uploadAsync();
      check();
      if (response && [401, 403, 404, 410].includes(response.status)) throw new StudioUploadRestartError();
      if (!response || response.status < 200 || response.status >= 300) throw new Error('A conexão foi interrompida ou o servidor recusou o arquivo. Tente novamente.');
      request.onProgress?.(100);
      return;
    }
    const fetchRequest = dependencies.fetch ?? fetch;
    const signedHeaders = { ...request.target.headers, 'Tus-Resumable': '1.0.0' };
    let uploadUrl = request.tusUrl ? resolveTusLocation(request.tusUrl, request.target.uploadUrl) : undefined;
    if (!uploadUrl) {
      const filenameBytes = encodeURIComponent(request.name).replace(/%([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      const metadata = `filename ${btoa(filenameBytes)},filetype ${btoa(request.mimeType)}`;
      const response = await fetchRequest(request.target.uploadUrl, {
        method: 'POST', signal: active.abort.signal,
        headers: { ...signedHeaders, 'Upload-Length': String(request.fileSize), 'Upload-Metadata': metadata },
      });
      check();
      if ([401, 403, 404, 410].includes(response.status)) throw new StudioUploadRestartError();
      if (response.status !== 201) throw new Error('Não foi possível iniciar o envio resumível. Tente novamente.');
      uploadUrl = resolveTusLocation(response.headers.get('Location'), request.target.uploadUrl);
      await request.onTusUrl(uploadUrl);
    }
    const readOffset = async () => {
      const response = await fetchRequest(uploadUrl!, { method: 'HEAD', headers: signedHeaders, signal: active.abort.signal });
      check();
      if ([401, 403, 404, 410].includes(response.status)) throw new StudioUploadRestartError('Não foi possível retomar este envio. Prepare um novo envio.');
      if (!response.ok) throw new Error('Não foi possível consultar este envio. Confira sua conexão e tente novamente.');
      return parseTusOffset(response.headers.get('Upload-Offset'), request.fileSize);
    };
    let offset = await readOffset();
    const chunkSize = dependencies.chunkSize ?? defaultChunkSize;
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > 8 * 1024 * 1024) throw new Error('Tamanho de envio inválido.');
    request.onProgress?.(Math.round(offset / request.fileSize * 100));
    while (offset < request.fileSize) {
      check();
      if (isUploadTargetExpired(request.target.expiresAt)) throw new StudioUploadRestartError();
      const length = Math.min(chunkSize, request.fileSize - offset);
      const base64 = await fileSystem.readAsStringAsync(request.uri, { encoding: fileSystem.EncodingType.Base64, position: offset, length });
      check();
      const bytes = decodeBase64Bytes(base64);
      if (bytes.length !== length) throw new Error('Não foi possível ler este trecho do arquivo. Importe a mídia novamente.');
      const response = await fetchRequest(uploadUrl, {
        method: 'PATCH', signal: active.abort.signal,
        headers: { ...signedHeaders, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
        body: bytes.buffer as ArrayBuffer,
      });
      check();
      if ([401, 403, 404, 410].includes(response.status)) throw new StudioUploadRestartError();
      if (response.status !== 204) throw new Error('O envio foi interrompido. Ao tentar novamente, continuaremos do último trecho recebido.');
      const nextOffset = parseTusOffset(response.headers.get('Upload-Offset'), request.fileSize);
      if (nextOffset !== offset + length) throw new Error('O servidor não confirmou o trecho enviado. Tente retomar o envio.');
      offset = nextOffset;
      request.onProgress?.(Math.round(offset / request.fileSize * 100));
    }
  } catch (error) {
    if (active.cancelled || (error instanceof Error && error.name === 'AbortError')) throw new StudioUploadCancelledError();
    throw error;
  } finally {
    if (activeTransfers.get(key) === active) activeTransfers.delete(key);
  }
}
