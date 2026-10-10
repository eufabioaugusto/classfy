import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { withStudioTakes, type StudioProject } from './model';
import { getStudioProject, loadStudioProjects, mutateStudioProject, retainStudioProjectMedia, saveStudioProjectDuplicate } from './store';

export type StudioWorkspaceActionScope = { isCurrent: () => boolean };
function assertCurrent(scope: StudioWorkspaceActionScope) {
  if (!scope.isCurrent()) throw new Error('A ação foi cancelada porque a sessão mudou.');
}
export function renameStudioProject(owner: string, id: string, title: string, scope: StudioWorkspaceActionScope) {
  const name = title.trim();
  if (!name || name.length > 150) throw new Error('Escreva um título com até 150 caracteres.');
  return mutateStudioProject(owner, id, project => {
    assertCurrent(scope);
    if (['preparing', 'uploading', 'processing'].includes(project.state)) throw new Error('Interrompa o envio antes de renomear o projeto.');
    return { title: name };
  });
}

/** Copy originals once per URI; clips and anchored layers remain independent. */
export async function duplicateStudioProject(owner: string, id: string, scope: StudioWorkspaceActionScope): Promise<StudioProject> {
  assertCurrent(scope);
  await loadStudioProjects(owner);
  assertCurrent(scope);
  const source = getStudioProject(owner, id);
  if (!source?.editing || source.ownerId !== owner) throw new Error('Este projeto não pertence à sessão atual.');
  if (source.pendingTakes?.length || ['preparing', 'uploading', 'processing'].includes(source.state)) throw new Error('Conclua a recuperação ou interrompa o envio antes de duplicar o projeto.');
  if (!FileSystem.documentDirectory) throw new Error('O Studio precisa do aplicativo instalado no aparelho.');
  const release = retainStudioProjectMedia(owner, id);
  const copyId = randomUUID();
  const directory = `${FileSystem.documentDirectory}classfy-studio/${owner}/${copyId}/`;
  let committed = false;
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    assertCurrent(scope);
    const copies = new Map<string, string>();
    const copyFile = async (uri?: string): Promise<string | undefined> => {
      if (!uri) return undefined;
      if (copies.has(uri)) return copies.get(uri)!;
      if (!uri.startsWith('file://')) throw new Error('Os originais precisam estar neste aparelho para duplicar o projeto.');
      const info = await FileSystem.getInfoAsync(uri);
      assertCurrent(scope);
      if (!info.exists || info.isDirectory) throw new Error('Um arquivo do projeto precisa de recuperação antes de duplicar.');
      const extension = uri.split('?')[0].match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase() || 'bin';
      const target = `${directory}${randomUUID()}.${extension}`;
      await FileSystem.copyAsync({ from: uri, to: target });
      assertCurrent(scope);
      const copied = await FileSystem.getInfoAsync(target);
      assertCurrent(scope);
      if (!copied.exists || copied.isDirectory || ('size' in info && 'size' in copied && copied.size !== info.size)) throw new Error('Não foi possível confirmar a cópia de um arquivo. O original foi preservado.');
      copies.set(uri, target);
      return target;
    };
    const editing = JSON.parse(JSON.stringify(source.editing)) as NonNullable<StudioProject['editing']>;
    const assetIds = new Map(editing.assets.map(asset => [asset.id, randomUUID()]));
    const clipIds = new Map(editing.main.map(clip => [clip.id, randomUUID()]));
    for (const asset of editing.assets) {
      asset.uri = (await copyFile(asset.uri))!;
      asset.thumbnailUri = await copyFile(asset.thumbnailUri);
      asset.id = assetIds.get(asset.id)!;
    }
    editing.main = editing.main.map(clip => ({ ...clip, id: clipIds.get(clip.id)!, assetId: assetIds.get(clip.assetId)! }));
    editing.layers = editing.layers.map(layer => ({ ...layer, id: randomUUID(), items: layer.items.map(item => ({ ...item, id: randomUUID(),
      ...(item.assetId ? { assetId: assetIds.get(item.assetId)! } : {}),
      ...(item.anchor ? { anchor: { ...item.anchor, clipId: clipIds.get(item.anchor.clipId)! } } : {}),
    })) }));
    const coverUri = await copyFile(source.coverUri);
    const now = new Date().toISOString();
    const title = `${source.title.trim().slice(0, 142) || 'Projeto'} (cópia)`;
    const duplicate = withStudioTakes({ version: 2 as const, id: copyId, ownerId: owner, kind: source.kind,
      title, description: source.description, objective: source.objective, audience: source.audience, script: source.script,
      tags: [...source.tags], visibility: source.visibility, price: source.price, editing, coverUri,
      ...(!coverUri && source.coverUrl ? { coverUrl: source.coverUrl } : {}),
      createdAt: now, updatedAt: now, revision: 1, state: 'draft' as const, progress: 0,
    });
    assertCurrent(scope);
    const saved = await saveStudioProjectDuplicate(owner, id, duplicate, scope.isCurrent);
    // A durable copy survives navigation/account changes during the disk write.
    committed = true;
    return saved;
  } finally {
    release();
    if (!committed) await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
  }
}
