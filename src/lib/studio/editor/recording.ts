import { studioTicks, withStudioTakes, type StudioAsset, type StudioKind, type StudioProject } from '../../../../shared/studio';
import { addMainAsset, patchClip, removeClip } from './commands';
import { inspectStudioMedia, type StudioMediaMetadata } from './media';
import { createProject, getAsset, getProject, putAsset, saveProject, studioAssetUri } from './storage';

export type StudioRecordingScope = { isCurrent?: () => boolean; signal?: AbortSignal };
export type StudioRecordingAppendScope = StudioRecordingScope & { operationId?: string };
export type StudioRecordingSessionOptions = {
  owner: string; kind: StudioKind; title?: string; projectId?: string; isCurrent?: () => boolean;
};
export type StudioRecordingSession = {
  current(): StudioProject | null;
  loadExisting(scope?: StudioRecordingScope): Promise<StudioProject | null>;
  append(file: File, scope?: StudioRecordingAppendScope): Promise<StudioProject>;
  remove(clipId: string, scope?: StudioRecordingScope): Promise<StudioProject>;
};
type RecordingStorage = { createProject: typeof createProject; getProject: typeof getProject; saveProject: typeof saveProject; putAsset: typeof putAsset; getAsset: typeof getAsset };
/** Only browser/codec and persistence boundaries are replaceable in tests. */
export type StudioRecordingDependencies = {
  storage?: RecordingStorage; inspect?: typeof inspectStudioMedia; id?: () => string;
};
type TakeReceipt = { operationId: string; assetId: string; clipId: string; metadata?: StudioMediaMetadata; asset?: StudioAsset };

export class StudioRecordingBusyError extends Error {
  constructor() { super('Aguarde o salvamento deste take antes de continuar.'); this.name = 'StudioRecordingBusyError'; }
}
function identity(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('A identificação da gravação não é válida.');
}
function available(project: StudioProject) {
  if (['preparing', 'uploading', 'processing', 'submitted'].includes(project.state) || project.pendingTakes?.length) {
    throw new Error('Aguarde a operação deste projeto antes de gravar ou remover takes.');
  }
}
function validMetadata(metadata: StudioMediaMetadata, kind: StudioKind) {
  if (!Number.isFinite(metadata.duration) || studioTicks(metadata.duration) < studioTicks(.1)) throw new Error('Grave um take com pelo menos 0,1 segundo.');
  if (kind === 'podcast') {
    if (metadata.kind !== 'audio' || metadata.hasAudio !== true) throw new Error('Este podcast precisa de uma gravação de áudio válida.');
  } else if (metadata.kind !== 'video' || !Number.isFinite(metadata.width) || !Number.isFinite(metadata.height) || metadata.width! <= 0 || metadata.height! <= 0) {
    throw new Error('Este formato precisa de uma gravação de vídeo válida.');
  }
}

/**
 * One recording workspace owns one session. Keep it and the candidate File for
 * retries. A REC operationId belongs to that exact File, never its filename.
 * IndexedDB CAS confirms every montage write; original bytes are immutable.
 */
export function createStudioRecordingSession(options: StudioRecordingSessionOptions, dependencies: StudioRecordingDependencies = {}): StudioRecordingSession {
  identity(options.owner);
  if (!['aula', 'short', 'podcast'].includes(options.kind)) throw new Error('Escolha um formato válido para a gravação.');
  if (options.projectId !== undefined) identity(options.projectId);
  const owner = options.owner, initialKind = options.kind, title = options.title ?? '';
  const storage = dependencies.storage ?? { createProject, getProject, saveProject, putAsset, getAsset };
  const inspect = dependencies.inspect ?? inspectStudioMedia, id = dependencies.id ?? (() => crypto.randomUUID());
  const receipts = new Map<string, TakeReceipt>(), files = new WeakMap<File, TakeReceipt>();
  let projectId = options.projectId, project: StudioProject | null = null;
  let flight: { key: string; promise: Promise<StudioProject | null> } | undefined;

  function assertScope(scope?: StudioRecordingScope) {
    if (scope?.signal?.aborted || options.isCurrent?.() === false || scope?.isCurrent?.() === false) throw new DOMException('Operação cancelada.', 'AbortError');
  }
  function accept(value: StudioProject) {
    if (value.ownerId !== owner || value.id !== projectId) throw new Error('Este projeto não pertence à gravação atual.');
    project = value;
    return value;
  }
  async function latest(scope?: StudioRecordingScope): Promise<StudioProject | null> {
    assertScope(scope);
    if (!projectId) return null;
    const value = await storage.getProject(owner, projectId);
    assertScope(scope);
    if (!value) throw new Error('Este projeto não está mais na biblioteca desta conta.');
    return accept(value);
  }
  function run<T extends StudioProject | null>(key: string, work: () => Promise<T>): Promise<T> {
    if (flight) return flight.key === key ? flight.promise as Promise<T> : Promise.reject(new StudioRecordingBusyError());
    const promise = work().finally(() => { if (flight?.promise === promise) flight = undefined; });
    flight = { key, promise };
    return promise;
  }
  function receiptFor(file: File, operationId?: string): TakeReceipt {
    if (!file || !Number.isFinite(file.size) || file.size <= 0 || typeof file.slice !== 'function') throw new Error('A gravação está vazia ou não está disponível.');
    if (operationId !== undefined) identity(operationId);
    const byFile = files.get(file), byOperation = operationId ? receipts.get(operationId) : undefined;
    if (byOperation && byFile !== byOperation || byFile && operationId && byFile.operationId !== operationId) throw new Error('Esta tentativa pertence a outro arquivo de gravação.');
    if (byOperation || byFile) return (byOperation ?? byFile)!;
    const receipt: TakeReceipt = { operationId: operationId ?? id(), assetId: id(), clipId: id() };
    identity(receipt.operationId); identity(receipt.assetId); identity(receipt.clipId);
    receipts.set(receipt.operationId, receipt); files.set(file, receipt);
    return receipt;
  }
  async function ensureBytes(assetId: string, blob: Blob, scope?: StudioRecordingScope) {
    assertScope(scope);
    // An interrupted put may have committed before its Promise was observed.
    // The session's exclusive asset ID is reused, never overwritten.
    const previous = await storage.getAsset(owner, projectId!, assetId);
    assertScope(scope);
    if (previous) {
      if (previous.size !== blob.size || previous.type !== blob.type) throw new Error('O original salvo não corresponde a este take.');
      return;
    }
    await storage.putAsset(owner, projectId!, assetId, blob);
    assertScope(scope);
  }
  function acknowledged(receipt: TakeReceipt, value: StudioProject) {
    receipt.metadata = undefined;
    return value;
  }
  async function appendReceipt(receipt: TakeReceipt, file: File, scope?: StudioRecordingAppendScope) {
    // Only the current failed candidate may keep its decoded thumbnail. The
    // caller owns Files; neither the operation ledger nor its WeakMap values do.
    for (const old of receipts.values()) if (old !== receipt) old.metadata = undefined;
    let current = await latest(scope);
    if (current) {
      // This includes a successful but unobserved save, and clips subsequently
      // split/removed in another tab. Do not resurrect an already accepted take.
      const original = current.editing?.assets.find(asset => asset.id === receipt.assetId);
      if (original) {
        if (!receipt.asset || JSON.stringify(original) !== JSON.stringify(receipt.asset)) throw new Error('O original salvo não corresponde a este take.');
        return acknowledged(receipt, current);
      }
      available(current);
    }
    const kind = current?.kind ?? initialKind;
    if (!receipt.metadata) receipt.metadata = await inspect(file, { signal: scope?.signal });
    assertScope(scope); validMetadata(receipt.metadata, kind);
    // No project or original is written until the decoder has accepted media.
    if (!current) {
      assertScope(scope);
      const created = await storage.createProject(owner, kind, title);
      projectId = created.id; current = accept(created);
      assertScope(scope);
    }
    const metadata = receipt.metadata;
    if (!receipt.asset) {
      const name = file.name || (kind === 'podcast' ? 'Take de áudio.webm' : 'Take de vídeo.webm');
      const uri = studioAssetUri(owner, current.id, receipt.assetId, name);
      receipt.asset = { id: receipt.assetId, uri, name, kind: metadata.kind, durationTicks: studioTicks(metadata.duration),
        ...(metadata.width !== undefined ? { width: metadata.width } : {}), ...(metadata.height !== undefined ? { height: metadata.height } : {}),
        ...(metadata.frameRate !== undefined ? { frameRate: metadata.frameRate } : {}), hasAudio: metadata.hasAudio,
        ...(metadata.colorSpace ? { colorSpace: metadata.colorSpace } : {}), ...(metadata.thumbnail ? { thumbnailUri: `${uri}:thumbnail` } : {}) };
    }
    await ensureBytes(receipt.asset.id, file, scope);
    if (metadata.thumbnail) await ensureBytes(`${receipt.asset.id}:thumbnail`, metadata.thumbnail, scope);
    // Re-read after byte I/O. An edit made while the codec/copy ran is preserved;
    // another edit during save still conflicts through the storage revision CAS.
    current = (await latest(scope))!;
    const original = current.editing?.assets.find(asset => asset.id === receipt.assetId);
    if (original) {
      if (JSON.stringify(original) !== JSON.stringify(receipt.asset)) throw new Error('O original salvo não corresponde a este take.');
      return acknowledged(receipt, current);
    }
    available(current);
    let next = addMainAsset(current, receipt.asset, receipt.clipId);
    if (kind === 'short') next = patchClip(next, receipt.clipId, { fit: 'cover' });
    if (!next.coverUri && !next.coverUrl && receipt.asset.thumbnailUri) next = withStudioTakes({ ...next, editing: next.editing!, coverUri: receipt.asset.thumbnailUri });
    assertScope(scope);
    // Once the transaction starts, let its durable result settle. The caller
    // checks its own epoch before updating UI; a blur cannot undo a committed REC.
    return acknowledged(receipt, accept(await storage.saveProject(owner, next)));
  }
  return {
    current: () => project,
    loadExisting: scope => run('load', () => latest(scope)),
    append(file, scope) {
      let receipt: TakeReceipt;
      try {
        assertScope(scope);
        const previous = scope?.operationId ? receipts.get(scope.operationId) : files.get(file);
        if (flight && (!previous || flight.key !== `append:${previous.operationId}`)) throw new StudioRecordingBusyError();
        receipt = receiptFor(file, scope?.operationId);
      } catch (error) { return Promise.reject(error); }
      return run(`append:${receipt.operationId}`, () => appendReceipt(receipt, file, scope));
    },
    remove(clipId, scope) {
      try { identity(clipId); assertScope(scope); } catch (error) { return Promise.reject(error); }
      return run(`remove:${clipId}`, async () => {
        const current = await latest(scope);
        if (!current) throw new Error('Salve o primeiro take antes de remover uma gravação.');
        const removed = current.editing?.main.find(clip => clip.id === clipId);
        if (!removed) return current; // repeated removal is idempotent
        available(current);
        let next = removeClip(current, clipId);
        const asset = current.editing?.assets.find(value => value.id === removed.assetId);
        if (!next.coverUrl && asset?.thumbnailUri && next.coverUri === asset.thumbnailUri) {
          const first = next.editing?.main[0];
          next = withStudioTakes({ ...next, editing: next.editing!, coverUri: next.editing?.assets.find(value => value.id === first?.assetId)?.thumbnailUri });
        }
        assertScope(scope);
        return accept(await storage.saveProject(owner, next));
      });
    },
  };
}
