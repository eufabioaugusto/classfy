import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { cancelExportAsync, exportRecipeAsync, getStudioExportCapabilitiesAsync, isStudioCompositionAvailable, exportTimelineAsync, generateThumbnailAsync, getMediaInfoAsync, isStudioMediaAvailable } from '../../../modules/classfy-studio-media';
import { addStudioLayerItem, compileStudioRecipe, normalizeStudioCaptureGrade, studioEditing, studioOutputSupported, studioTicks, timelineSignature, validateStudioRecipe, type StudioProject, type StudioTake, type StudioAsset, type StudioLayerItem, type StudioPendingTake, type StudioEditing } from './model';
import { getStudioProject, mutateStudioProject, retainStudioProjectMedia, updateStudioProject } from './store';

export async function assertStudioOwner(project: StudioProject) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== project.ownerId) throw new Error('Sua sessão mudou. Abra o projeto na conta que o criou.');
}
export async function studioProjectDirectory(project: StudioProject) {
  if (!FileSystem.documentDirectory) throw new Error('O Studio precisa do aplicativo instalado no aparelho.');
  const uri = `${FileSystem.documentDirectory}classfy-studio/${project.ownerId}/${project.id}/`;
  await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  return uri;
}
export async function persistStudioTake(project: StudioProject, source: { uri: string; id?: string; name?: string; duration?: number; sourceKind?: StudioTake['sourceKind']; sourceStage?: StudioTake['sourceStage']; frameRate?: number; colorSpace?: string; grade?: StudioTake['grade'] }): Promise<StudioTake> {
  const grade = normalizeStudioCaptureGrade(source.grade);
  await assertStudioOwner(project);
  if (!isStudioMediaAvailable()) throw new Error('Atualize o aplicativo para habilitar o editor nativo neste aparelho.');
  const release = retainStudioProjectMedia(project.ownerId, project.id);
  try {
    const directory = await studioProjectDirectory(project);
    if (source.id && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(source.id)) throw new Error('O identificador deste original não é válido.');
    const existing = source.id && getStudioProject(project.ownerId, project.id)?.takes.find(take => take.id === source.id);
    if (existing) return existing;
    const recoverable = getStudioProject(project.ownerId, project.id)?.pendingTakes?.find(take => take.sourceUri === source.uri);
    if (recoverable) return await readStudioTake(project, recoverable, directory);
    const id = source.id || randomUUID();
    const nameExtension = source.name?.split('.').pop()?.toLowerCase();
    const extension = nameExtension && /^[a-z0-9]{2,5}$/.test(nameExtension) ? nameExtension : source.uri.split('?')[0].split('.').pop()?.toLowerCase();
    const safeExtension = extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : project.kind === 'podcast' ? 'm4a' : 'mp4';
    const uri = `${directory}${id}.${safeExtension}`;
    await FileSystem.copyAsync({ from: source.uri, to: uri });
    await assertStudioOwner(project);
    const name = source.name || `Take ${project.takes.length + 1}`;
    // Journal the durable copy before metadata/thumbnail work. This also
    // promotes a camera session only after its first original is on disk.
    const pending: StudioPendingTake = { id, uri, name, sourceUri: source.uri, sourceKind: source.sourceKind, sourceStage: source.sourceStage, frameRate: source.frameRate, colorSpace: source.colorSpace, ...(grade ? { grade } : {}) };
    await mutateStudioProject(project.ownerId, project.id, current => ({ pendingTakes: [...(current.pendingTakes || []), pending] }));
    return await readStudioTake(project, pending, directory);
  } finally { release(); }
}
async function readStudioTake(project: StudioProject, pending: StudioPendingTake, directory: string): Promise<StudioTake> {
  const { id, uri, name } = pending;
  const info = await getMediaInfoAsync(uri);
  if (!Number.isFinite(info.duration) || info.duration < 0.1) throw new Error('O arquivo não tem duração válida. Escolha outro conteúdo.');
  if (project.kind !== 'podcast' && !info.hasVideo) throw new Error('Escolha um vídeo para este formato.');
  if (project.kind === 'podcast' && !info.hasAudio) throw new Error('Este arquivo não contém uma faixa de áudio.');
  let thumbnailUri: string | undefined;
  if (info.hasVideo) {
    const output = `${directory}${id}.jpg`;
    try { thumbnailUri = (await generateThumbnailAsync(uri, output, Math.min(0.5, info.duration / 2))).uri; } catch { /* Cover can be chosen manually. */ }
  }
  await assertStudioOwner(project);
  return { id, uri, name, duration: info.duration,
    sourceKind: pending.sourceKind, sourceStage: pending.sourceStage, frameRate: Number.isFinite(info.frameRate) && info.frameRate! > 0 ? info.frameRate : pending.frameRate, colorSpace: info.colorSpace ?? pending.colorSpace,
    start: 0, end: info.duration, width: info.width, height: info.height, thumbnailUri, hasAudio: info.hasAudio,
    ...(pending.grade ? { grade: normalizeStudioCaptureGrade(pending.grade) } : {}) };
}
async function appendStudioTake(project: StudioProject, take: StudioTake) {
  await assertStudioOwner(project);
  const saved = await mutateStudioProject(project.ownerId, project.id, current => ({
    takes: current.takes.some(t => t.id === take.id) ? current.takes : [...current.takes, take],
    ...(!current.coverUri && !current.coverUrl && take.thumbnailUri ? { coverUri: take.thumbnailUri } : {}),
  }));
  if (saved.pendingTakes?.some(pending => !pending.layerItem && pending.id === take.id)) throw new Error('O tratamento deste take precisa de recuperação. O original continua salvo.');
}
export async function recoverPendingStudioTakes(project: StudioProject): Promise<{ recovered: number; errors: string[] }> {
  await assertStudioOwner(project);
  let recovered = 0;
  const errors: string[] = [];
  const directory = await studioProjectDirectory(project);
  for (const pending of project.pendingTakes || []) {
    try {
      if (pending.layerItem) { await finishStudioLayerImport(project, pending); recovered++; continue; }
      const thumbnail = `${directory}${pending.id}.jpg`;
      // Reuse an existing thumbnail on recovery instead of overwriting it.
      const take = await readStudioTake(project, pending, directory);
      if (!take.thumbnailUri && (await FileSystem.getInfoAsync(thumbnail)).exists) take.thumbnailUri = thumbnail;
      await appendStudioTake(project, take); recovered++;
    } catch (error) { errors.push(`${pending.name}: ${error instanceof Error ? error.message : 'Não foi possível recuperar.'}`); }
  }
  return { recovered, errors };
}
async function importBatch(project: StudioProject, assets: {uri: string; name?: string}[]) {
  const takes: StudioTake[] = [];
  const errors: string[] = [];
  for (const asset of assets) {
    try { const take = await persistStudioTake(project, asset); await appendStudioTake(project, take); takes.push(take); }
    catch (error) { errors.push(error instanceof Error ? error.message : 'Não foi possível importar um arquivo.'); }
  }
  if (errors.length) {
    if (!takes.length) throw new Error(errors[0]);
    await assertStudioOwner(project);
    Alert.alert('Importação parcial', `${takes.length} ${takes.length === 1 ? 'take salvo' : 'takes salvos'}. ${errors.length} ${errors.length === 1 ? 'arquivo precisa' : 'arquivos precisam'} de atenção. Os arquivos copiados podem ser recuperados no projeto.`);
  }
  return takes;
}
export async function importStudioMedia(project: StudioProject): Promise<StudioTake[]> {
  await assertStudioOwner(project);
  if (project.kind === 'podcast') {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return [];
    return importBatch(project, result.assets.map(asset => ({ uri: asset.uri, name: asset.name })));
  }
  // The system picker grants access to the selected assets without requesting
  // broad photo-library access. Import originals; never use its ten-minute trim.
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: true,
    allowsEditing: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    selectionLimit: 20, orderedSelection: true });
  if (result.canceled) return [];
  return importBatch(project, result.assets.map(asset => ({ uri: asset.uri, name: asset.fileName || undefined })));
}
export async function importStudioCover(project: StudioProject): Promise<string | null> {
  await assertStudioOwner(project);
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true,
    aspect: project.kind === 'short' ? [9, 16] : [16, 9], quality: 1 });
  if (result.canceled) return null;
  const context = ImageManipulator.manipulate(result.assets[0].uri);
  context.resize({ width: project.kind === 'short' ? 1080 : 1920 });
  const rendered = await context.renderAsync();
  const jpeg = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const uri = `${await studioProjectDirectory(project)}cover-${randomUUID()}.jpg`;
  await FileSystem.copyAsync({ from: jpeg.uri, to: uri });
  await assertStudioOwner(project);
  return uri;
}
export async function exportStudioProject(project: StudioProject, onProgress?: (progress: number) => void, shouldContinue?: () => boolean): Promise<{uri: string; duration: number; mimeType: string; fileSize: number}> {
  const check = () => { if (shouldContinue?.() === false) throw new Error('Preparação interrompida. Seus takes continuam salvos.'); };
  check();
  await assertStudioOwner(project);
  check();
  const signature = timelineSignature(project);
  const editing = studioEditing(project);
  const recipe = compileStudioRecipe(project);
  const errors = validateStudioRecipe(recipe);
  if (errors.length) throw new Error(errors[0]);
  if (editing.output.profile === 'legacy-source' && recipe.version === 3) throw new Error('Escolha o perfil de composição e a qualidade de saída para exportar Melhorar cena e Retoque natural sem perder os tratamentos.');
  const requiresAudio = project.kind === 'podcast' || recipe.clips.some(clip => clip.kind === 'audio' && clip.gain > 0);
  const matchesOutput = (info: Awaited<ReturnType<typeof getMediaInfoAsync>>) => Number.isFinite(info.fileSize) && info.fileSize > 0
    && (!requiresAudio || info.hasAudio)
    && Number.isFinite(info.duration) && info.duration > 0
    && Math.abs(info.duration - recipe.durationTicks / recipe.timebase) <= Math.max(0.1, 2 * recipe.output.frameRateDenominator / recipe.output.frameRateNumerator)
    && (project.kind === 'podcast' ? info.hasAudio : info.hasVideo && (editing.output.profile !== 'standard'
      || info.width === recipe.output.width && info.height === recipe.output.height && Number.isFinite(info.frameRate)
        && Math.abs(info.frameRate! - recipe.output.frameRateNumerator / recipe.output.frameRateDenominator) < 0.02));
  if (project.exportedSignature === signature && project.exportedUri) {
    const file = await FileSystem.getInfoAsync(project.exportedUri);
    check();
    if (file.exists && !file.isDirectory && file.size > 0) {
      // A matching signature alone cannot certify a downgraded or replaced
      // file. An unreadable/stale artifact is regenerated from the originals.
      let info: Awaited<ReturnType<typeof getMediaInfoAsync>> | undefined;
      try { info = await getMediaInfoAsync(project.exportedUri); } catch { /* Re-export below. */ }
      check();
      if (info && matchesOutput(info)) return { uri: project.exportedUri, duration: info.duration, mimeType: project.kind === 'podcast' ? 'audio/mp4' : 'video/mp4', fileSize: file.size };
    }
  }
  if (!project.takes.length) throw new Error('Grave ou importe um take antes de continuar.');
  const outputUri = `${await studioProjectDirectory(project)}export-${randomUUID()}.${project.kind === 'podcast' ? 'm4a' : 'mp4'}`;
  check();
  const progressHandler = (progress: number) => {
    if (shouldContinue?.() === false) { void cancelExportAsync(project.id); return; }
    onProgress?.(progress);
  };
  if (editing.output.profile === 'legacy-source' && (editing.mainMuted || editing.layers.some(layer => layer.items.length) || editing.main.some(clip => clip.grade || clip.effect && clip.effect !== 'natural' || clip.gain !== undefined && clip.gain !== 1) || editing.canvas.backgroundColor !== '#000000' || editing.canvas.aspectRatio !== (project.kind === 'short' ? 'portrait' : 'landscape'))) throw new Error('Escolha o perfil de composição e a qualidade de saída para exportar esta edição com camadas.');
  if (editing.output.profile === 'standard') {
    if (!isStudioCompositionAvailable()) throw new Error('Atualize o Classfy Dev para editar e exportar camadas e tratamentos de imagem.');
    const capabilities = await getStudioExportCapabilitiesAsync();
    check(); await assertStudioOwner(project); check();
    if (project.kind !== 'podcast' && !studioOutputSupported(recipe.output, capabilities)) throw new Error('Esta versão do Classfy Dev não suporta a saída escolhida. Atualize o aplicativo ou escolha uma saída compatível; seus originais continuam intactos.');
  }
  const result = editing.output.profile === 'standard'
    ? await exportRecipeAsync({ requestId: project.id, recipeJSON: JSON.stringify(recipe), outputUri }, progressHandler)
    : await exportTimelineAsync({ requestId: project.id, clips: project.takes.map(t => ({ uri: t.uri, startSeconds: t.start, endSeconds: t.end })),
    outputUri, mediaType: project.kind === 'podcast' ? 'audio' : 'video', aspectRatio: project.kind === 'short' ? 'portrait' : 'landscape' }, progressHandler);
  check();
  await assertStudioOwner(project);
  check();
  const actual = await getMediaInfoAsync(result.uri);
  check();
  if (!matchesOutput(actual)) throw new Error('O arquivo gerado não corresponde à resolução ou ao FPS escolhidos. Seus originais e a edição continuam salvos.');
  await assertStudioOwner(project); check();
  await updateStudioProject(project.ownerId, project.id, { exportedUri: result.uri, exportedSignature: signature });
  return { ...result, duration: actual.duration, fileSize: actual.fileSize };
}
export async function cancelStudioExport(project: StudioProject) { await cancelExportAsync(project.id); }

export type StudioVoiceoverPersistScope = {
  isCurrent: () => boolean;
  onBeforePersist?: (latest: StudioProject, next: StudioEditing) => void;
  onPersisted?: (saved: StudioProject) => void;
  onPersistError?: () => void;
};
async function finishStudioLayerImport(project: StudioProject, pending: NonNullable<StudioProject['pendingTakes']>[number], scope?: StudioVoiceoverPersistScope) {
  await assertStudioOwner(project);
  const check = () => { if (scope && !scope.isCurrent()) throw new Error('A narração está preservada no projeto. Recupere o arquivo ao voltar.'); };
  check();
  if (!pending.layerItem || !pending.kind) throw new Error('O destino da camada precisa de recuperação.');
  let asset: StudioAsset;
  if (pending.kind === 'image') {
    const dimensions = studioImageSize(pending.imageSize) ?? await readStudioImageSize(pending.uri);
    asset = { id: pending.id, kind: 'image', uri: pending.uri, name: pending.name, durationTicks: 0, ...dimensions, thumbnailUri: pending.uri };
  } else {
    const info = await getMediaInfoAsync(pending.uri);
    if (!Number.isFinite(info.duration) || info.duration < 0.1 || pending.kind === 'video' && !info.hasVideo || pending.kind === 'audio' && !info.hasAudio) throw new Error('Este arquivo não contém a mídia selecionada.');
    asset = { id: pending.id, kind: pending.kind, uri: pending.uri, name: pending.name, durationTicks: studioTicks(info.duration), width: info.width, height: info.height, frameRate: info.frameRate, colorSpace: info.colorSpace, sourceStage: pending.sourceStage, sourceKind: pending.sourceKind, hasAudio: info.hasAudio };
  }
  const item = { ...pending.layerItem };
  if (asset.kind !== 'image') {
    item.durationTicks = Math.min(item.durationTicks, asset.durationTicks);
    item.sourceStartTicks = 0; item.sourceEndTicks = item.durationTicks;
    item.fadeInTicks = Math.min(item.fadeInTicks || 0, Math.floor(item.durationTicks / 2));
    item.fadeOutTicks = Math.min(item.fadeOutTicks || 0, Math.floor(item.durationTicks / 2));
  }
  await assertStudioOwner(project);
  check();
  let began = false;
  let saved: StudioProject;
  try {
    saved = await mutateStudioProject(project.ownerId, project.id, latest => {
      check();
      const editing = studioEditing(latest);
      if (editing.layers.some(layer => layer.items.some(existing => existing.id === item.id))) return {};
      const next = addStudioLayerItem({ ...editing, assets: [...editing.assets.filter(original => original.id !== asset.id), asset] }, item, pending.layerId);
      began = true;
      scope?.onBeforePersist?.(latest, next);
      return { editing: next };
    });
  } catch (cause) {
    if (began) scope?.onPersistError?.();
    throw cause;
  }
  if (began) scope?.onPersisted?.(saved);
  return saved;
}
/** Recorder cache is copied and journaled before resolving a usable audio lane. */
export async function persistStudioVoiceover(project: StudioProject, source: { uri: string; duration: number; name?: string }, positionSeconds: number, scope: StudioVoiceoverPersistScope): Promise<{ project: StudioProject; itemId: string }> {
  const check = () => { if (!scope.isCurrent()) throw new Error('A gravação foi cancelada porque a tela ou a sessão mudou.'); };
  check(); await assertStudioOwner(project); check();
  if (!isStudioCompositionAvailable()) throw new Error('Atualize o Classfy Dev para adicionar sua narração.');
  const latest = getStudioProject(project.ownerId, project.id);
  if (!latest || studioEditing(latest).output.profile !== 'standard') throw new Error('Selecione o perfil de composição antes de adicionar uma narração.');
  const duration = Math.min(source.duration, Math.max(0, compileStudioRecipe(latest).durationTicks / 120_000 - positionSeconds));
  if (!source.uri.startsWith('file://') || !Number.isFinite(positionSeconds) || positionSeconds < 0 || !Number.isFinite(duration) || duration < 0.1) throw new Error('Posicione o cursor antes do fim do vídeo para adicionar uma narração.');
  const release = retainStudioProjectMedia(project.ownerId, project.id);
  try {
    const recoverable = latest.pendingTakes?.find(pending => pending.sourceUri === source.uri && pending.kind === 'audio' && pending.layerItem?.kind === 'audio');
    if (recoverable) {
      const saved = await finishStudioLayerImport(project, recoverable, scope);
      return { project: saved, itemId: recoverable.layerItem!.id };
    }
    const id = randomUUID(), itemId = randomUUID();
    const uri = `${await studioProjectDirectory(project)}${id}.m4a`; check();
    await FileSystem.copyAsync({ from: source.uri, to: uri });
    await assertStudioOwner(project);
    const pending: StudioPendingTake = { id, uri, name: source.name || 'Narração.m4a', sourceUri: source.uri, kind: 'audio', layerId: `layer:item:${itemId}`,
      layerItem: { id: itemId, kind: 'audio', assetId: id, atTicks: studioTicks(positionSeconds), durationTicks: studioTicks(duration), sourceStartTicks: 0, sourceEndTicks: studioTicks(duration), gain: 1 } };
    // Keep this commitment after a blur: the original has already been copied.
    await mutateStudioProject(project.ownerId, project.id, current => ({ pendingTakes: [...(current.pendingTakes || []), pending] }));
    check();
    const saved = await finishStudioLayerImport(project, pending, scope);
    return { project: saved, itemId };
  } finally { release(); }
}
function studioImageSize(value?: { width: number; height: number }) {
  return value && [value.width, value.height].every(dimension => Number.isFinite(dimension) && dimension > 0)
    ? { width: value.width, height: value.height } : undefined;
}
async function readStudioImageSize(uri: string) {
  const context = ImageManipulator.manipulate(uri);
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    rendered = await context.renderAsync();
    const dimensions = studioImageSize(rendered);
    if (!dimensions) throw new Error('Não foi possível ler as dimensões desta imagem.');
    return dimensions;
  } finally {
    // Release the metadata raster immediately; the recipe keeps the original.
    try { rendered?.release(); } finally { context.release(); }
  }
}
export async function importStudioLayer(project: StudioProject, kind: 'image' | 'video' | 'audio', item: Omit<StudioLayerItem, 'assetId'>): Promise<StudioProject | null> {
  await assertStudioOwner(project);
  if (!isStudioCompositionAvailable()) throw new Error('Atualize o Classfy Dev para usar camadas.');
  if (studioEditing(project).output.profile !== 'standard') throw new Error('Selecione o perfil de composição e a qualidade de saída antes de adicionar camadas.');
  let source: { uri: string; name: string; imageSize?: { width: number; height: number } };
  if (kind === 'audio') {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (picked.canceled) return null; source = { uri: picked.assets[0].uri, name: picked.assets[0].name };
  } else {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: kind === 'video' ? ['videos'] : ['images'], allowsEditing: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current });
    if (picked.canceled) return null;
    const asset = picked.assets[0];
    if (!asset) throw new Error('Nenhum arquivo foi selecionado.');
    source = { uri: asset.uri, name: asset.fileName || (kind === 'video' ? 'Vídeo.mp4' : 'Imagem.jpg'),
      ...(kind === 'image' ? { imageSize: studioImageSize(asset) } : {}) };
  }
  await assertStudioOwner(project);
  const release = retainStudioProjectMedia(project.ownerId, project.id);
  try {
    const id = randomUUID(); const ext = source.name.split('.').pop()?.toLowerCase();
    const uri = `${await studioProjectDirectory(project)}${id}.${ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'm4a'}`;
    await FileSystem.copyAsync({ from: source.uri, to: uri });
    await assertStudioOwner(project);
    const pending = { id, uri, name: source.name, sourceUri: source.uri, kind, layerItem: { ...item, assetId: id }, layerId: `layer:item:${item.id}`,
      ...(source.imageSize ? { imageSize: source.imageSize } : {}) };
    await mutateStudioProject(project.ownerId, project.id, latest => ({ pendingTakes: [...(latest.pendingTakes || []), pending] }));
    return await finishStudioLayerImport(project, pending);
  } finally { release(); }
}
export async function importStudioCaptionFile(project: StudioProject, duration: number) {
  await assertStudioOwner(project);
  const picked = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'application/x-subrip', 'text/vtt', 'application/octet-stream'], copyToCacheDirectory: true });
  if (picked.canceled) return null;
  const file = picked.assets[0];
  if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error('Escolha uma legenda SRT ou VTT.');
  if (file.size && file.size > 2_000_000) throw new Error('Escolha uma legenda com até 2 MB.');
  const source = await FileSystem.readAsStringAsync(file.uri);
  await assertStudioOwner(project);
  const { parseStudioCaptions } = await import('./captions');
  return parseStudioCaptions(source, duration);
}
