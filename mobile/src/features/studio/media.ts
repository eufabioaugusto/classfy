import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { cancelExportAsync, exportTimelineAsync, generateThumbnailAsync, getMediaInfoAsync, isStudioMediaAvailable } from '../../../modules/classfy-studio-media';
import { timelineSignature, type StudioProject, type StudioTake } from './model';
import { getStudioProject, mutateStudioProject, updateStudioProject } from './store';

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
export async function persistStudioTake(project: StudioProject, source: { uri: string; name?: string; duration?: number }): Promise<StudioTake> {
  await assertStudioOwner(project);
  if (!isStudioMediaAvailable()) throw new Error('Atualize o aplicativo para habilitar o editor nativo neste aparelho.');
  const directory = await studioProjectDirectory(project);
  const recoverable = getStudioProject(project.ownerId, project.id)?.pendingTakes?.find(take => take.sourceUri === source.uri);
  if (recoverable) return readStudioTake(project, recoverable, directory);
  const id = randomUUID();
  const extension = (source.name || source.uri).split('?')[0].split('.').pop()?.toLowerCase();
  const safeExtension = extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : project.kind === 'podcast' ? 'm4a' : 'mp4';
  const uri = `${directory}${id}.${safeExtension}`;
  await FileSystem.copyAsync({ from: source.uri, to: uri });
  const name = source.name || `Take ${project.takes.length + 1}`;
  // Journal the durable copy before metadata/thumbnail work. An interruption
  // cannot leave an imported or recorded file with no recovery pointer.
  await mutateStudioProject(project.ownerId, project.id, current => ({ pendingTakes: [...(current.pendingTakes || []), { id, uri, name, sourceUri: source.uri }] }));
  return readStudioTake(project, { id, uri, name }, directory);
}
async function readStudioTake(project: StudioProject, pending: { id: string; uri: string; name: string }, directory: string): Promise<StudioTake> {
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
    start: 0, end: info.duration, width: info.width, height: info.height, thumbnailUri };
}
async function appendStudioTake(project: StudioProject, take: StudioTake) {
  await assertStudioOwner(project);
  await mutateStudioProject(project.ownerId, project.id, current => ({
    takes: current.takes.some(t => t.id === take.id) ? current.takes : [...current.takes, take],
    ...(!current.coverUri && !current.coverUrl && take.thumbnailUri ? { coverUri: take.thumbnailUri } : {}),
  }));
}
export async function recoverPendingStudioTakes(project: StudioProject): Promise<{ recovered: number; errors: string[] }> {
  await assertStudioOwner(project);
  let recovered = 0;
  const errors: string[] = [];
  const directory = await studioProjectDirectory(project);
  for (const pending of project.pendingTakes || []) {
    try {
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
  if (project.exportedSignature === signature && project.exportedUri) {
    const file = await FileSystem.getInfoAsync(project.exportedUri);
    check();
    if (file.exists && !file.isDirectory) {
      const info = await getMediaInfoAsync(project.exportedUri);
      check();
      return { uri: project.exportedUri, duration: info.duration, mimeType: project.kind === 'podcast' ? 'audio/mp4' : 'video/mp4', fileSize: file.size };
    }
  }
  if (!project.takes.length) throw new Error('Grave ou importe um take antes de continuar.');
  const outputUri = `${await studioProjectDirectory(project)}export-${randomUUID()}.${project.kind === 'podcast' ? 'm4a' : 'mp4'}`;
  check();
  const result = await exportTimelineAsync({ requestId: project.id, clips: project.takes.map(t => ({ uri: t.uri, startSeconds: t.start, endSeconds: t.end })),
    outputUri, mediaType: project.kind === 'podcast' ? 'audio' : 'video', aspectRatio: project.kind === 'short' ? 'portrait' : 'landscape' }, progress => {
      if (shouldContinue?.() === false) { void cancelExportAsync(project.id); return; }
      onProgress?.(progress);
    });
  check();
  await assertStudioOwner(project);
  check();
  await updateStudioProject(project.ownerId, project.id, { exportedUri: result.uri, exportedSignature: signature });
  return result;
}
export async function cancelStudioExport(project: StudioProject) { await cancelExportAsync(project.id); }
