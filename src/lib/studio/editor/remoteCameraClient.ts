import { supabase } from '@/integrations/supabase/client';
import type { StudioRemoteResponse, StudioRemoteThumbnailDescriptor } from '../../../../shared/studio/remoteCamera';

export type StudioRemoteRequest = { action: string; [key: string]: unknown };
export type StudioRemoteScope = { signal?: AbortSignal; isCurrent?: () => boolean };
export type StudioRemoteDownload = { url?: string; parts?: { url: string; index: number; bytes: number }[]; bytes?: number; mime?: string; totalParts?: number; nextPartIndex?: number | null; expiresAt: string };
export type StudioRemoteDownloadScope = StudioRemoteScope & { cacheKey?: string; nextPage?: (index: number) => Promise<StudioRemoteDownload>; onProgress?: (receivedBytes: number, totalBytes?: number) => void };
export type StudioRemoteClient = {
  request(body: StudioRemoteRequest, scope?: StudioRemoteScope): Promise<StudioRemoteResponse>;
  download(download: StudioRemoteDownload | string, scope?: StudioRemoteDownloadScope): Promise<Blob>;
  thumbnail?(sessionId: string, takeId: string, clientId: string, scope?: StudioRemoteScope): Promise<(StudioRemoteThumbnailDescriptor & { url: string; expiresAt: string }) | null>;
};
export class StudioRemoteCameraError extends Error {
  constructor(message: string, readonly code = 'remote_camera_error') { super(message); this.name = 'StudioRemoteCameraError'; }
}
export const assertStudioRemoteScope = (scope: StudioRemoteScope) => {
  if (scope.signal?.aborted || scope.isCurrent?.() === false) throw new DOMException('Conexão cancelada.', 'AbortError');
};
async function remoteBounded<T>(scope: StudioRemoteScope, task: (signal: AbortSignal) => Promise<T>, milliseconds = 20_000): Promise<T> {
  assertStudioRemoteScope(scope);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort(); scope.signal?.addEventListener('abort', abort, { once: true });
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new StudioRemoteCameraError('A conexão demorou. Reconecte para continuar; seu original permanece no iPhone.', 'timeout')); controller.abort(); }, milliseconds); });
    const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new DOMException('Conexão cancelada.', 'AbortError')), { once: true }));
    const result = await Promise.race([task(controller.signal), deadline, cancelled]); assertStudioRemoteScope(scope); return result;
  } finally { clearTimeout(timer); scope.signal?.removeEventListener('abort', abort); }
}
/** A long original has no overall transfer deadline; a stalled part is resumable. */
async function readRemotePart(target: URL, scope: StudioRemoteScope, write: (bytes: Uint8Array) => Promise<void>) {
  assertStudioRemoteScope(scope); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, received = 0;
  let rejectIdle!: (error: Error) => void;
  const inactive = new Promise<never>((_, reject) => { rejectIdle = reject; });
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => { rejectIdle(new StudioRemoteCameraError('A transferência parou. Retome para continuar de onde terminou.', 'download_stalled')); controller.abort(); }, 30_000); };
  const cancel = () => controller.abort(); scope.signal?.addEventListener('abort', cancel, { once: true });
  const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new DOMException('Conexão cancelada.', 'AbortError')), { once: true }));
  const work = (async () => {
    const response = await fetch(target.href, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
    if (!response.ok || !response.body) throw new StudioRemoteCameraError('A transferência foi interrompida. Retome o recebimento do original.', 'download_failed');
    const reader = response.body.getReader();
    try { while (true) { const next = await reader.read(); assertStudioRemoteScope(scope); if (next.done) break; reset(); received += next.value.byteLength; await write(next.value); } return received; }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  })();
  reset();
  try { return await Promise.race([work, inactive, cancelled]); }
  finally { clearTimeout(timer); scope.signal?.removeEventListener('abort', cancel); controller.abort(); }
}
/** Every response belongs to the account that initiated the gesture. Never log JWTs or signed URLs. */
export function createStudioRemoteClient(owner: string): StudioRemoteClient {
  const ownerSession = async (scope: StudioRemoteScope) => {
    const { data, error } = await remoteBounded(scope, () => supabase.auth.getSession());
    if (error || !owner || data.session?.user.id !== owner || !data.session.access_token) throw new StudioRemoteCameraError('Sua conta mudou. Abra a câmera novamente.', 'account_changed');
    return data.session.access_token;
  };
  const invoke = async (body: StudioRemoteRequest, scope: StudioRemoteScope) => {
      const token = await ownerSession(scope);
      const { data, error } = await remoteBounded(scope, signal => supabase.functions.invoke('studio-camera', { body, signal, headers: { Authorization: `Bearer ${token}` } }));
      await ownerSession(scope); assertStudioRemoteScope(scope);
      if (error) {
        let detail: { error?: string; message?: string; code?: string } | undefined;
        try { if ('context' in error && error.context instanceof Response) detail = await error.context.clone().json(); } catch { /* Transport errors have no JSON response. */ }
        throw new StudioRemoteCameraError(detail?.message ?? detail?.error ?? 'Não foi possível conectar o iPhone. Reconecte a prévia para continuar.', detail?.code ?? 'transport');
      }
      return data;
  };
  return {
    async request(body, scope = {}) {
      const data = await invoke(body, scope);
      if (!data?.session?.id || !Array.isArray(data.commands) || !Array.isArray(data.takes) || typeof data.serverAt !== 'string') throw new StudioRemoteCameraError('A conexão respondeu com dados incompletos.', 'invalid_response');
      return data as StudioRemoteResponse;
    },
    async thumbnail(sessionId, takeId, clientId, scope = {}) {
      const data = await invoke({ action: 'thumbnail_get', sessionId, takeId, role: 'controller', clientId }, scope);
      if (data?.thumbnail == null) return null;
      const value = data.thumbnail;
      if (value.version !== 1 || value.mime !== 'image/jpeg' || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > 16384 ||
        ![value.width, value.height].every(size => Number.isSafeInteger(size) && size > 0 && size <= 320) || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash) || typeof value.url !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
        throw new StudioRemoteCameraError('A miniatura respondeu com dados inválidos.', 'invalid_thumbnail');
      }
      let target: URL;
      try { target = new URL(value.url); } catch { throw new StudioRemoteCameraError('A miniatura não possui endereço válido.', 'invalid_thumbnail'); }
      const expected = `/storage/v1/object/sign/studio-camera-thumbnails/${owner}/${sessionId}/${takeId}/v1.jpg`;
      if (target.protocol !== 'https:' || target.origin !== new URL(import.meta.env.VITE_SUPABASE_URL).origin || decodeURIComponent(target.pathname) !== expected) {
        throw new StudioRemoteCameraError('A miniatura não pertence a este take privado.', 'invalid_thumbnail');
      }
      return value;
    },
    async download(download, scope = {}) {
      await ownerSession(scope);
      const origin = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
      const descriptor = typeof download === 'string' ? { url: download, expiresAt: '' } : download;
      const parts = descriptor.parts?.length ? [...descriptor.parts].sort((left, right) => left.index - right.index) : descriptor.url ? [{ url: descriptor.url, index: 0, bytes: descriptor.bytes ?? 0 }] : [];
      if (!parts.length || parts.some((part, index) => part.index !== index || !Number.isSafeInteger(part.bytes) || part.bytes < 0)) throw new StudioRemoteCameraError('As partes do original estão incompletas.', 'invalid_download');
      const targets = parts.map(part => { let target: URL; try { target = new URL(part.url); } catch { throw new StudioRemoteCameraError('O original não possui um endereço válido.'); } if (target.protocol !== 'https:' || target.origin !== origin || !target.pathname.includes('/storage/v1/')) throw new StudioRemoteCameraError('O endereço do original não pertence ao armazenamento privado da Classfy.', 'invalid_download'); return target; });
      const expires = parts.map(() => Date.parse(descriptor.expiresAt));
      if (descriptor.bytes && descriptor.nextPartIndex == null && parts.every(part => part.bytes > 0) && parts.reduce((sum, part) => sum + part.bytes, 0) !== descriptor.bytes) throw new StudioRemoteCameraError('O tamanho confirmado do original não corresponde às suas partes.', 'invalid_download');
      const blob = await (async () => {
        const getDirectory = navigator.storage?.getDirectory?.bind(navigator.storage);
        if (!getDirectory) {
          if (parts.length !== 1 || descriptor.nextPartIndex != null || parts[0].bytes > 50 * 1024 * 1024) throw new StudioRemoteCameraError('Use Chrome, Edge ou Safari atualizado para receber este original com segurança.', 'storage_unsupported');
          return remoteBounded(scope, async signal => { const response = await fetch(targets[0].href, { signal, credentials: 'omit', redirect: 'error' }); if (!response.ok) throw new StudioRemoteCameraError('Não foi possível receber o original. Retome a transferência.', 'download_failed'); scope.onProgress?.(0, descriptor.bytes); const blob = await response.blob(); assertStudioRemoteScope(scope); scope.onProgress?.(blob.size, descriptor.bytes); return blob; }, 180_000);
        }
        const directory = await (await getDirectory()).getDirectoryHandle('classfy-remote-originals', { create: true }); assertStudioRemoteScope(scope);
        const key = (scope.cacheKey ?? crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 180);
        const handle = await directory.getFileHandle(`${owner}-${key}.original`, { create: true });
        const previous = await handle.getFile(); let retained = 0, nextPartIndex = descriptor.nextPartIndex ?? null;
        const pageAt = async (index: number) => {
          if (!scope.nextPage) throw new StudioRemoteCameraError('Faltam partes do original. Retome a transferência.', 'original_incomplete');
          const page = await scope.nextPage(index); assertStudioRemoteScope(scope);
          const next = [...page.parts ?? []].sort((left, right) => left.index - right.index);
          if (page.bytes !== descriptor.bytes || !next.length || next.some((part, offset) => part.index !== index + offset || !Number.isSafeInteger(part.bytes) || part.bytes <= 0) || page.nextPartIndex != null && page.nextPartIndex <= index) throw new StudioRemoteCameraError('A próxima parte não corresponde a este original.', 'invalid_download');
          const nextTargets = next.map(part => { const target = new URL(part.url); if (target.protocol !== 'https:' || target.origin !== origin || !target.pathname.includes('/storage/v1/')) throw new StudioRemoteCameraError('O endereço do original não pertence ao armazenamento privado da Classfy.', 'invalid_download'); return target; });
          parts.splice(index, parts.length - index, ...next); targets.splice(index, targets.length - index, ...nextTargets); expires.splice(index, expires.length - index, ...next.map(() => Date.parse(page.expiresAt))); nextPartIndex = page.nextPartIndex ?? null;
        };
        // Only whole verified parts survive a retry; a partial network chunk is
        // truncated before resuming. Originals stay on disk, never concatenated in RAM.
        for (let index = 0; index < parts.length || nextPartIndex !== null; index++) {
          if (index === parts.length) {
            if (nextPartIndex !== index) throw new StudioRemoteCameraError('Faltam partes do original. Retome a transferência.', 'original_incomplete'); await pageAt(index);
          }
          if (parts[index].bytes > 0 && retained + parts[index].bytes <= previous.size) { retained += parts[index].bytes; scope.onProgress?.(retained, descriptor.bytes); continue; }
          if (Number.isFinite(expires[index]) && expires[index] <= Date.now() + 30_000) await pageAt(index);
          assertStudioRemoteScope(scope);
          const writable = await handle.createWritable({ keepExistingData: true }); let received = 0;
          try {
            await writable.truncate(retained); await writable.seek(retained);
            received = await readRemotePart(targets[index], scope, async bytes => { received += bytes.byteLength; if (parts[index].bytes && received > parts[index].bytes) throw new StudioRemoteCameraError('Uma parte do original excedeu o tamanho confirmado.', 'original_incomplete'); await writable.write(bytes); scope.onProgress?.(retained + received, descriptor.bytes); });
            if (parts[index].bytes && received !== parts[index].bytes) throw new StudioRemoteCameraError('Uma parte do original ficou incompleta. Retome a transferência.', 'original_incomplete');
            await writable.close(); retained += received;
          } catch (error) { await writable.abort().catch(() => undefined); throw error; }
        }
        let file = await handle.getFile(); if (file.size > retained) { const writable = await handle.createWritable({ keepExistingData: true }); await writable.truncate(retained); await writable.close(); file = await handle.getFile(); }
        if (descriptor.bytes && file.size !== descriptor.bytes) throw new StudioRemoteCameraError('O original ficou incompleto. Retome a transferência.', 'original_incomplete'); return file;
      })();
      await ownerSession(scope); assertStudioRemoteScope(scope); return blob;
    },
  };
}
