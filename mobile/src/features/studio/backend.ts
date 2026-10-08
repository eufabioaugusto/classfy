import * as FileSystem from 'expo-file-system/legacy';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { cancelStudioExport, exportStudioProject } from './media';
import { publicationIssues, timelineDuration, timelineSignature, type StudioProject } from './model';
import { getStudioProject, updateStudioProject } from './store';
import { cancelStudioTransfer, decodeBase64Bytes, isUploadTargetExpired, StudioUploadCancelledError, StudioUploadRestartError, uploadStudioFile, type StudioUploadTarget } from './uploadTransport';

type Progress = (progress: number, stage?: string) => void;
type RemoteDraft = { id: string; owner_id: string; draft_key: string; kind: string; state: string; updated_at: string; payload: Record<string, unknown> };
type MediaAsset = { id: string; status: string; duration_seconds: number | null };
type Operation = { cancelled: boolean; promise: Promise<StudioProject> };
const operations = new Map<string, Operation>();
const operationKey = (project: StudioProject) => `${project.ownerId}:${project.id}`;
const draftKey = (project: StudioProject) => `${project.kind}:new:${project.id}`;
const terminalFailures = ['failed', 'deleted', 'missing'];
const processingTimeoutMs = 120_000;

class StudioBackendError extends Error {}

function current(project: StudioProject) {
  const latest = getStudioProject(project.ownerId, project.id);
  if (!latest) throw new StudioBackendError('Este projeto não está disponível nesta conta.');
  return latest;
}
async function patch(project: StudioProject, values: Partial<StudioProject>) {
  return updateStudioProject(project.ownerId, project.id, values);
}
async function ownerAuthorization(project: StudioProject) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== project.ownerId || !data.session.access_token) throw new StudioBackendError('Sua sessão mudou. Entre na conta que criou este projeto.');
  // Capture the intended account on the request itself. A session switch while
  // the SDK awaits auth cannot save this project's payload under a new owner.
  return `Bearer ${data.session.access_token}`;
}
async function requireCreatorOwner(project: StudioProject) {
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== project.ownerId) throw new StudioBackendError('Sua sessão mudou. Entre na conta que criou este projeto.');
  const [roles, profile] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', project.ownerId).in('role', ['creator', 'admin']),
    supabase.from('profiles').select('creator_status').eq('id', project.ownerId).maybeSingle(),
  ]);
  if (roles.error || profile.error) throw new StudioBackendError('Não foi possível verificar sua conta. Confira sua conexão e tente novamente.');
  const granted = roles.data?.some(role => role.role === 'admin') || (roles.data?.some(role => role.role === 'creator') && profile.data?.creator_status === 'approved');
  if (!granted) throw new StudioBackendError('Sua conta precisa estar aprovada como creator para enviar uma publicação. Seus projetos continuam salvos.');
}
function ensureTimeline(project: StudioProject, signature: string, operation?: Operation) {
  if (operation?.cancelled) throw new StudioUploadCancelledError();
  const latest = current(project);
  if (latest.state === 'submitted') throw new StudioBackendError('Este projeto já foi enviado para curadoria.');
  if (timelineSignature(latest) !== signature) throw new StudioBackendError('A gravação foi alterada. Prepare novamente a versão atual do projeto.');
  return latest;
}
async function remoteDraft(project: StudioProject): Promise<RemoteDraft | null> {
  const { data, error } = await supabase.from('publication_drafts')
    .select('id,owner_id,draft_key,kind,state,updated_at,payload').eq('owner_id', project.ownerId).eq('draft_key', draftKey(project)).maybeSingle();
  if (error) throw new StudioBackendError('Não foi possível sincronizar o rascunho. Confira sua conexão e tente novamente.');
  return data as RemoteDraft | null;
}
function assertRemoteVersion(project: StudioProject, record: RemoteDraft | null) {
  if (!record) {
    if (project.remoteDraftId) throw new StudioBackendError('O rascunho mudou em outro dispositivo. Seus arquivos locais continuam preservados.');
    return;
  }
  if (record.state !== 'draft') throw new StudioBackendError(record.state === 'submitted' ? 'Este projeto já foi enviado para curadoria.' : 'Este rascunho foi encerrado em outro dispositivo.');
  if (!project.remoteSavedAt || record.updated_at !== project.remoteSavedAt) throw new StudioBackendError('Este rascunho mudou em outro dispositivo. Abra a versão atual antes de enviar para preservar as alterações.');
}
async function fingerprint(project: StudioProject) {
  // iOS can move an app's container after an update. The cloud fingerprint
  // identifies source takes and cuts, independently of their local directory.
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([
    project.kind, project.takes.map(take => [take.id, take.duration, take.start, take.end]),
  ]));
}
function canonicalDraftPayload(payload: Record<string, unknown>) {
  const mobile = payload._mobileStudio as Record<string, unknown> | undefined;
  const price = String(payload.price ?? '').trim().replace(',', '.');
  return JSON.stringify({ title: String(payload.title ?? '').trim(), description: String(payload.description ?? '').trim(),
    visibility: payload.visibility, price: Number.isFinite(Number(price)) ? Number(price) : price,
    discount: Number(payload.discount ?? 0), tags: payload.tags,
    mediaAssetId: payload.mediaAssetId || null, fileUrl: payload.fileUrl || '', thumbnailUrl: payload.thumbnailUrl || '',
    videoProvider: payload.videoProvider || null,
    projectId: mobile?.projectId, objective: mobile?.objective || '', audience: mobile?.audience || '', script: mobile?.script || '',
    timelineFingerprint: mobile?.timelineFingerprint,
  });
}
async function reconcileDraftVersion(project: StudioProject, record: RemoteDraft | null) {
  if (!record || record.state !== 'draft' || record.updated_at === project.remoteSavedAt) return project;
  if (record.owner_id !== project.ownerId || record.draft_key !== draftKey(project) || record.kind !== project.kind) return project;
  // A connection can fail after a successful RPC, before its timestamp reaches
  // the local index. Adopt only an identical publication, never remote edits.
  if (canonicalDraftPayload(record.payload) !== canonicalDraftPayload(await publicationPayload(project))) return project;
  return patch(project, { remoteDraftId: record.id, remoteSavedAt: record.updated_at });
}
async function publicationPayload(project: StudioProject, duration = timelineDuration(project.takes)) {
  return {
    title: project.title.trim(), description: project.description.trim(),
    visibility: project.visibility, price: project.price.trim().replace(',', '.'), discount: '0', tags: project.tags,
    fileName: `${project.title.trim() || 'Publicação'}.${project.kind === 'podcast' ? 'm4a' : 'mp4'}`,
    fileUrl: project.mediaAssetId ? `media:${project.mediaAssetId}` : '', thumbnailUrl: project.coverUrl || '',
    duration, mediaAssetId: project.mediaAssetId || null, videoProvider: project.videoProvider || null,
    uploadState: project.state === 'draft' ? 'idle' : project.state === 'error' ? 'failed' : project.state,
    // Keep planning portable without sending local paths or signed destinations.
    _mobileStudio: { version: 1, projectId: project.id, objective: project.objective, audience: project.audience,
      script: project.script, timelineFingerprint: await fingerprint(project) },
  };
}
async function saveCloudDraft(project: StudioProject, duration?: number) {
  let latest = current(project);
  if (latest.state === 'submitted') throw new StudioBackendError('Este projeto já foi enviado para curadoria.');
  const record = await remoteDraft(latest);
  latest = await reconcileDraftVersion(latest, record);
  assertRemoteVersion(latest, record);
  const payload = await publicationPayload(latest, duration);
  const authorization = await ownerAuthorization(latest);
  const { data, error } = await supabase.rpc('save_publication_draft', {
    p_draft_key: draftKey(latest), p_kind: latest.kind, p_payload: payload,
    p_source_type: null, p_source_id: null,
  }).setHeader('Authorization', authorization);
  const saved = (Array.isArray(data) ? data[0] : data) as RemoteDraft | null;
  if (error || !saved?.id || !saved.updated_at) throw new StudioBackendError('Não foi possível salvar na sua conta. O projeto continua salvo neste aparelho.');
  const result = await patch(latest, { remoteDraftId: saved.id, remoteSavedAt: saved.updated_at });
  if (JSON.stringify(await publicationPayload(result, duration)) !== JSON.stringify(payload)) throw new StudioBackendError('Os detalhes mudaram durante a sincronização. Revise sua publicação e tente novamente.');
  return result;
}
async function getAsset(project: StudioProject): Promise<MediaAsset | null> {
  if (!project.mediaAssetId) return null;
  const { data, error } = await supabase.from('media_assets').select('id,status,duration_seconds')
    .eq('id', project.mediaAssetId).eq('owner_id', project.ownerId).maybeSingle();
  if (error) throw new StudioBackendError('Não foi possível verificar o processamento. Tente novamente em instantes.');
  return data as MediaAsset | null;
}
async function recoverSubmission(project: StudioProject, draft: RemoteDraft) {
  const { data } = await supabase.from('publication_submissions').select('id,source_id')
    .eq('owner_id', project.ownerId).eq('draft_id', draft.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return patch(project, { state: 'submitted', progress: 100, error: undefined,
    remoteDraftId: draft.id, remoteSavedAt: draft.updated_at, submissionId: data?.id, contentId: data?.source_id || undefined,
    uploadUrl: undefined, uploadHeaders: undefined, tusUrl: undefined });
}
async function recoverAsset(project: StudioProject) {
  if (project.mediaAssetId || !project.remoteDraftId) return project;
  const record = await remoteDraft(project);
  if (!record || record.id !== project.remoteDraftId) return project;
  const mobile = record.payload._mobileStudio as { timelineFingerprint?: string } | undefined;
  if (mobile?.timelineFingerprint !== await fingerprint(project)) return project;
  const payloadId = typeof record.payload.mediaAssetId === 'string' ? record.payload.mediaAssetId : null;
  const { data: asset } = payloadId
    ? await supabase.from('media_assets').select('id,status,duration_seconds').eq('id', payloadId).eq('owner_id', project.ownerId).maybeSingle()
    : await supabase.from('media_assets').select('id,status,duration_seconds').eq('publication_draft_id', record.id)
      .eq('owner_id', project.ownerId).is('abandoned_at', null).gte('created_at', record.updated_at)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!asset) return project;
  return patch(project, { mediaAssetId: asset.id, uploadSignature: timelineSignature(project),
    videoProvider: typeof record.payload.videoProvider === 'string' ? record.payload.videoProvider : undefined });
}
async function uploadCover(project: StudioProject) {
  if (project.coverUrl) return project;
  if (!project.coverUri?.startsWith('file://')) throw new StudioBackendError('Escolha uma capa antes de continuar.');
  const info = await FileSystem.getInfoAsync(project.coverUri);
  if (!info.exists || info.isDirectory || info.size <= 0) throw new StudioBackendError('A capa não está disponível neste aparelho. Escolha outra imagem.');
  if (info.size > 12 * 1024 * 1024) throw new StudioBackendError('A capa está muito grande. Escolha uma imagem de até 12 MB.');
  const bytes = decodeBase64Bytes(await FileSystem.readAsStringAsync(project.coverUri, { encoding: FileSystem.EncodingType.Base64 }));
  const path = `thumbnails/${project.ownerId}/${randomUUID()}.jpg`;
  const authorization = await ownerAuthorization(project);
  const { error } = await supabase.storage.from('contents').upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false, headers: { Authorization: authorization } });
  if (error) throw new StudioBackendError('Não foi possível enviar a capa. Confira sua conexão e tente novamente.');
  const { data } = supabase.storage.from('contents').getPublicUrl(path);
  if (current(project).coverUri !== project.coverUri) throw new StudioBackendError('A capa mudou durante o envio. Prepare novamente a versão atual.');
  return patch(project, { coverUrl: data.publicUrl });
}
function targetFromProject(project: StudioProject): StudioUploadTarget | null {
  if (!project.mediaAssetId || !project.uploadUrl || !project.uploadMethod || !['mux', 'bunny'].includes(project.videoProvider || '')) return null;
  return { mediaAssetId: project.mediaAssetId, provider: project.videoProvider as 'mux' | 'bunny',
    uploadUrl: project.uploadUrl, method: project.uploadMethod, headers: project.uploadHeaders, expiresAt: project.uploadExpiresAt };
}
async function createTarget(project: StudioProject): Promise<StudioUploadTarget> {
  const authorization = await ownerAuthorization(project);
  const { data, error } = await supabase.functions.invoke('video-create-upload', {
    headers: { Authorization: authorization },
    body: { title: project.title.trim() || 'Publicação', mediaType: project.kind === 'podcast' ? 'audio' : 'video',
      draftId: project.remoteDraftId, slotKey: `${project.kind}:primary`, corsOrigin: '*' },
  });
  if (error || !data?.mediaAssetId || !data.uploadUrl) throw new StudioBackendError('Não foi possível preparar o envio. Confira sua conexão e tente novamente.');
  if (data.method === 'MOCK' || data.provider === 'mock') throw new StudioBackendError('O serviço de publicação não está disponível neste ambiente.');
  if (!['mux', 'bunny'].includes(data.provider) || !['PUT', 'TUS'].includes(data.method)) throw new StudioBackendError('O serviço retornou um envio incompatível. Tente novamente.');
  return data as StudioUploadTarget;
}
async function waitForProcessing(project: StudioProject, signature: string, operation: Operation, onProgress?: Progress) {
  const deadline = Date.now() + processingTimeoutMs;
  while (Date.now() < deadline) {
    ensureTimeline(project, signature, operation);
    const asset = await getAsset(current(project));
    if (asset?.status === 'ready') {
      if (project.kind === 'short' && Number(asset.duration_seconds) > 180) throw new StudioBackendError('O vídeo processado ultrapassa 3 minutos. Revise os cortes do short.');
      const ready = await patch(project, { state: 'ready', progress: 100, error: undefined });
      onProgress?.(100, 'Pronto para enviar');
      return saveCloudDraft(ready, asset.duration_seconds || undefined);
    }
    if (!asset || terminalFailures.includes(asset.status)) throw new StudioBackendError('A mídia não pôde ser processada. Tente preparar o envio novamente.');
    onProgress?.(100, 'Preparando a reprodução');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  // Processing continues on the provider. A timeout does not mean failure.
  return current(project);
}
function runOperation(project: StudioProject, work: (operation: Operation) => Promise<StudioProject>): Promise<StudioProject> {
  const key = operationKey(project);
  if (operations.has(key)) return Promise.reject(new StudioBackendError('Este projeto tem uma operação em andamento. Aguarde ou interrompa o envio para continuar.'));
  const operation = { cancelled: false, promise: null as unknown as Promise<StudioProject> };
  operations.set(key, operation);
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== project.ownerId) {
      operation.cancelled = true;
      void cancelStudioTransfer(project.ownerId, project.id);
      void cancelStudioExport(project).catch(() => undefined);
    }
  });
  operation.promise = work(operation).catch(async error => {
    const latest = getStudioProject(project.ownerId, project.id);
    if (latest && latest.state !== 'submitted') {
      const cancelled = operation.cancelled || error instanceof StudioUploadCancelledError;
      const message = error instanceof StudioBackendError || error instanceof StudioUploadCancelledError || error instanceof StudioUploadRestartError ? error.message
        : 'O envio foi interrompido. Seu projeto continua salvo. Confira sua conexão e tente novamente.';
      await patch(latest, { state: latest.state === 'processing' && cancelled ? 'processing' : cancelled ? 'draft' : 'error', error: message,
        ...(error instanceof StudioUploadRestartError ? { uploadUrl: undefined, uploadHeaders: undefined, tusUrl: undefined } : {}) }).catch(() => undefined);
      throw new StudioBackendError(message);
    }
    throw error;
  }).finally(() => {
    listener.subscription.unsubscribe();
    if (operations.get(key) === operation) operations.delete(key);
  });
  return operation.promise;
}

export function prepareStudioUpload(project: StudioProject, onProgress?: Progress): Promise<StudioProject> {
  return runOperation(project, async operation => {
    await requireCreatorOwner(project);
    let active = current(project);
    if (active.state === 'submitted') return active;
    const issues = publicationIssues(active);
    if (issues.length) throw new StudioBackendError(issues[0]);
    const signature = timelineSignature(active);
    const record = await remoteDraft(active);
    if (record?.state === 'submitted') return recoverSubmission(active, record);
    active = await reconcileDraftVersion(active, record);
    assertRemoteVersion(active, record);
    active = await recoverAsset(active);
    const existingAsset = await getAsset(active);
    if (active.uploadSignature === signature && existingAsset && ['ready', 'processing'].includes(existingAsset.status)) {
      if (active.kind === 'short' && existingAsset.status === 'ready' && Number(existingAsset.duration_seconds) > 180) throw new StudioBackendError('O vídeo processado ultrapassa 3 minutos. Revise os cortes do short.');
      onProgress?.(100, existingAsset.status === 'ready' ? 'Pronto para enviar' : 'Preparando a reprodução');
      active = await uploadCover(active);
      active = await patch(active, { state: existingAsset.status === 'ready' ? 'ready' : 'processing', progress: 100, error: undefined });
      active = await saveCloudDraft(active, existingAsset.duration_seconds || undefined);
      return existingAsset.status === 'ready' ? active : waitForProcessing(active, signature, operation, onProgress);
    }
    ensureTimeline(active, signature, operation);
    active = await patch(active, { state: 'preparing', progress: 0, error: undefined });
    onProgress?.(0, 'Preparando arquivo');
    const exported = await exportStudioProject(active,
      progress => onProgress?.(Math.min(100, Math.max(0, progress * 100)), 'Preparando arquivo'),
      () => !operation.cancelled);
    if (active.kind === 'short' && exported.duration > 180) throw new StudioBackendError('A exportação ultrapassa 3 minutos. Reduza um pouco os cortes do short.');
    active = ensureTimeline(active, signature, operation);
    active = await saveCloudDraft(active, exported.duration);
    onProgress?.(0, 'Enviando capa');
    active = await uploadCover(active);
    active = ensureTimeline(active, signature, operation);
    let target = active.uploadSignature === signature ? targetFromProject(active) : null;
    const oldAsset = existingAsset;
    // A completed transfer can become ready while the editor/export was open.
    const latestAsset = await getAsset(active);
    if (active.uploadSignature === signature && latestAsset && ['ready', 'processing'].includes(latestAsset.status)) {
      if (active.kind === 'short' && latestAsset.status === 'ready' && Number(latestAsset.duration_seconds) > 180) throw new StudioBackendError('O vídeo processado ultrapassa 3 minutos. Revise os cortes do short.');
      active = await patch(active, { state: latestAsset.status === 'ready' ? 'ready' : 'processing', progress: 100 });
      active = await saveCloudDraft(active, latestAsset.duration_seconds || exported.duration);
      return latestAsset.status === 'ready' ? active : waitForProcessing(active, signature, operation, onProgress);
    }
    if (!target || isUploadTargetExpired(target.expiresAt) || !latestAsset || terminalFailures.includes(latestAsset.status)) {
      target = await createTarget(active);
      ensureTimeline(active, signature, operation);
      active = await patch(active, { mediaAssetId: target.mediaAssetId, videoProvider: target.provider, uploadSignature: signature,
        uploadUrl: target.uploadUrl, uploadMethod: target.method, uploadHeaders: target.headers, uploadExpiresAt: target.expiresAt,
        tusUrl: undefined, state: 'uploading', progress: 0 });
      active = await saveCloudDraft(active, exported.duration);
      if (oldAsset && oldAsset.id !== target.mediaAssetId && !['ready', 'processing'].includes(oldAsset.status)) {
        const authorization = await ownerAuthorization(active);
        await supabase.rpc('abandon_media_asset', { p_media_asset_id: oldAsset.id }).setHeader('Authorization', authorization);
      }
    } else {
      active = await patch(active, { state: 'uploading', progress: 0 });
    }
    await requireCreatorOwner(active);
    ensureTimeline(active, signature, operation);
    let persistedProgress = -1;
    let progressSave = Promise.resolve();
    await uploadStudioFile({ ownerId: active.ownerId, projectId: active.id, uri: exported.uri,
      name: `${active.title || 'Publicação'}.${active.kind === 'podcast' ? 'm4a' : 'mp4'}`, mimeType: exported.mimeType,
      fileSize: exported.fileSize, target, tusUrl: active.tusUrl,
      shouldContinue: () => !operation.cancelled && !!getStudioProject(active.ownerId, active.id),
      onTusUrl: async tusUrl => { await patch(active, { tusUrl }); },
      onProgress: progress => {
        onProgress?.(progress, 'Enviando arquivo');
        if (progress === 100 || progress >= persistedProgress + 5) {
          persistedProgress = progress;
          progressSave = progressSave.then(async () => {
            if (!operation.cancelled && current(active).state === 'uploading') await patch(active, { progress });
          }).catch(() => undefined);
        }
      },
    });
    await progressSave;
    active = ensureTimeline(active, signature, operation);
    active = await patch(active, { state: 'processing', progress: 100, error: undefined });
    active = await saveCloudDraft(active, exported.duration);
    return waitForProcessing(active, signature, operation, onProgress);
  });
}

export async function refreshStudioUpload(project: StudioProject): Promise<StudioProject> {
  await requireCreatorOwner(project);
  let active = current(project);
  if (active.state === 'submitted') return active;
  if (operations.has(operationKey(active))) return active;
  const record = await remoteDraft(active);
  if (record?.state === 'submitted') return recoverSubmission(active, record);
  active = await reconcileDraftVersion(active, record);
  active = await recoverAsset(active);
  if (active.uploadSignature !== timelineSignature(active)) return active;
  const asset = await getAsset(active);
  if (asset?.status === 'ready') {
    if (active.kind === 'short' && Number(asset.duration_seconds) > 180) return patch(active, { state: 'error', error: 'O vídeo processado ultrapassa 3 minutos. Revise os cortes do short.' });
    return patch(active, { state: 'ready', progress: 100, error: undefined });
  }
  if (asset?.status === 'processing') return patch(active, { state: 'processing', progress: 100, error: undefined });
  if (!asset || terminalFailures.includes(asset.status)) return patch(active, { state: 'error', error: 'A mídia não está disponível. Prepare o envio novamente.' });
  return active;
}

export function submitStudioProject(project: StudioProject): Promise<StudioProject> {
  return runOperation(project, async operation => {
    await requireCreatorOwner(project);
    let active = current(project);
    if (active.state === 'submitted') return active;
    const record = await remoteDraft(active);
    if (record?.state === 'submitted') return recoverSubmission(active, record);
    const issues = publicationIssues(active);
    if (issues.length) throw new StudioBackendError(issues[0]);
    const signature = timelineSignature(active);
    if (active.uploadSignature !== signature) throw new StudioBackendError('Prepare o envio desta versão antes de continuar.');
    const asset = await getAsset(active);
    if (!asset || asset.status !== 'ready') throw new StudioBackendError('A mídia ainda está sendo preparada. Aguarde o processamento para enviar.');
    if (active.kind === 'short' && Number(asset.duration_seconds) > 180) throw new StudioBackendError('O vídeo processado ultrapassa 3 minutos. Revise os cortes do short.');
    active = await uploadCover(active);
    active = await patch(active, { state: 'ready', progress: 100, error: undefined });
    active = await saveCloudDraft(active, asset.duration_seconds || undefined);
    await requireCreatorOwner(active);
    ensureTimeline(active, signature, operation);
    const authorization = await ownerAuthorization(active);
    const { data, error } = await supabase.rpc('submit_standalone_publication', { p_draft_id: active.remoteDraftId }).setHeader('Authorization', authorization);
    if (error || !data?.submissionId) {
      const refreshed = await remoteDraft(active);
      if (refreshed?.state === 'submitted') return recoverSubmission(active, refreshed);
      throw new StudioBackendError('Não foi possível confirmar o envio para curadoria. Seu projeto continua salvo. Tente novamente.');
    }
    return patch(active, { state: 'submitted', progress: 100, error: undefined,
      submissionId: data.submissionId, contentId: data.contentId,
      uploadUrl: undefined, uploadHeaders: undefined, tusUrl: undefined });
  });
}

export async function cancelStudioUpload(project: StudioProject) {
  await ownerAuthorization(project);
  const operation = operations.get(operationKey(project));
  if (operation) operation.cancelled = true;
  await Promise.all([cancelStudioTransfer(project.ownerId, project.id), cancelStudioExport(project).catch(() => undefined)]);
  // A cancellation request can arrive during native preflight, before there
  // is an export task to cancel. Keep edits/retries blocked until that job exits.
  await operation?.promise.catch(() => undefined);
  const active = getStudioProject(project.ownerId, project.id);
  if (active && !['submitted', 'processing', 'ready'].includes(active.state)) {
    await patch(active, { state: 'draft', error: 'Envio pausado. Seu projeto continua salvo neste dispositivo.' });
  }
}
