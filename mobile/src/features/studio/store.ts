import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { documentDirectory } from 'expo-file-system/legacy';
import type { StudioKind, StudioProject } from './model';
import { emptyStudioEditing, migrateStudioProject, normalizeStudioCaptureGrade, rebaseStudioProject, reconcileStudioTakes, timelineSignature, validateStudioEditing, validateStudioPendingTakes, withStudioTakes } from './model';

type Snapshot = { projects: StudioProject[]; loading: boolean; error: string | null };
const owners = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();
const queues = new Map<string, Promise<unknown>>();
// Opening the camera is a session, not a saved draft. Its first durable media
// journal promotes the same ID, so capture/import need no separate save path.
const transient = new Map<string, Map<string, StudioProject>>();
const mediaWrites = new Map<string, number>();
const mediaKey = (owner: string, id: string) => JSON.stringify([owner, id]);
const key = (owner: string) => `classfy:studio:v2:${owner}`;
const legacyKey = (owner: string) => `classfy:studio:v1:${owner}`;
const backupKey = (owner: string) => `classfy:studio:v1:backup:${owner}`;
const empty: Snapshot = { projects: [], loading: true, error: null };
export function studioSnapshot(owner: string) { return owners.get(owner) || empty; }
export function subscribeStudio(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(owner: string, snapshot: Snapshot) { owners.set(owner, snapshot); listeners.forEach(l => l()); }
export function getStudioProject(ownerId: string, id: string) {
  return studioSnapshot(ownerId).projects.find(p => p.id === id && p.ownerId === ownerId) || transient.get(ownerId)?.get(id);
}
export function isTransientStudioProject(owner: string, id: string) { return transient.get(owner)?.has(id) || false; }
export function retainStudioProjectMedia(owner: string, id: string) {
  if (!getStudioProject(owner, id)) throw new Error('Este projeto não pertence à sessão atual.');
  const token = mediaKey(owner, id);
  mediaWrites.set(token, (mediaWrites.get(token) || 0) + 1);
  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    const remaining = (mediaWrites.get(token) || 1) - 1;
    if (remaining > 0) mediaWrites.set(token, remaining); else mediaWrites.delete(token);
  };
}

export async function loadStudioProjects(owner: string) {
  if (loading.has(owner)) return loading.get(owner);
  if (owners.has(owner) && !owners.get(owner)!.loading) return;
  const task = (async () => {
    try {
      const raw = await AsyncStorage.getItem(key(owner));
      let projects: StudioProject[];
      if (raw !== null) projects = readProjects(raw, owner, 2);
      else {
        const legacy = await AsyncStorage.getItem(legacyKey(owner));
        if (legacy !== null) projects = await migrateIndex(owner, legacy);
        else projects = [];
      }
      // Transfers cannot survive a killed JS process. Never infer completion.
      projects = projects.map(p => rebaseStudioProject(p, documentDirectory)).map(p => ['uploading', 'preparing'].includes(p.state)
        ? withStudioTakes({ ...p, editing: p.editing!, state: 'error' as const, error: 'O envio foi interrompido. Retome quando estiver pronto.' })
        : p);
      publish(owner, { projects, loading: false, error: null });
    } catch (e) {
      publish(owner, { projects: [], loading: false, error: e instanceof Error ? e.message : 'Não foi possível abrir os projetos neste aparelho.' });
    }
  })();
  loading.set(owner, task);
  await task;
  loading.delete(owner);
}
function readProjects(raw: string, owner: string, version: 1 | 2): StudioProject[] {
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || records.some(project => !project || project.version !== version || project.ownerId !== owner
    || !project.id || !['aula', 'short', 'podcast'].includes(project.kind)
    || (version === 1 ? !Array.isArray(project.takes) : !project.editing || !Array.isArray(project.editing.assets) || !Array.isArray(project.editing.main) || !Array.isArray(project.editing.layers)))) {
    throw new Error('Os rascunhos deste aparelho precisam de recuperação. Os arquivos originais foram preservados.');
  }
  return records.map(record => {
    const project = migrateStudioProject(rebaseStudioProject(record, documentDirectory));
    const issues = [...validateStudioEditing(project.editing!, project.kind), ...validateStudioPendingTakes(project.pendingTakes)];
    // Unsupported native capabilities (e.g. a raw cinematic original) do not
    // erase a recoverable index. They are shown when preparing the publication.
    const structural = issues.filter(issue => !issue.includes('cinematográfico'));
    if (structural.length) throw new Error('Os rascunhos deste aparelho precisam de recuperação. Os arquivos originais foram preservados.');
    return project;
  });
}
async function migrateIndex(owner: string, legacy: string): Promise<StudioProject[]> {
  const projects = readProjects(legacy, owner, 1);
  // Preserve exact v1 bytes before writing v2. Never overwrite a previous backup.
  if (await AsyncStorage.getItem(backupKey(owner)) === null) await AsyncStorage.setItem(backupKey(owner), legacy);
  const encoded = JSON.stringify(projects);
  await AsyncStorage.setItem(key(owner), encoded);
  const readback = await AsyncStorage.getItem(key(owner));
  if (readback !== encoded) throw new Error('Não foi possível confirmar a recuperação dos rascunhos. Os originais e o índice anterior foram preservados.');
  return readProjects(readback, owner, 2);
}
/** Explicit recovery only; retain the damaged v2 bytes before restoring v1. */
export function recoverStudioProjects(owner: string): Promise<void> {
  return serialized(owner, async () => {
    const legacy = await AsyncStorage.getItem(backupKey(owner)) ?? await AsyncStorage.getItem(legacyKey(owner));
    if (!legacy) throw new Error('Não há um índice anterior para recuperar. Seus arquivos originais continuam no aparelho.');
    readProjects(legacy, owner, 1);
    const damaged = await AsyncStorage.getItem(key(owner));
    if (damaged !== null) await AsyncStorage.setItem(`classfy:studio:v2:recovery:${owner}:${Date.now()}`, damaged);
    const projects = await migrateIndex(owner, legacy);
    publish(owner, { projects, loading: false, error: null });
  });
}
function serialized<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(owner) || Promise.resolve()).catch(() => undefined).then(work);
  queues.set(owner, next);
  return next;
}
async function persist(owner: string, projects: StudioProject[]) {
  await AsyncStorage.setItem(key(owner), JSON.stringify(projects));
  publish(owner, { projects, loading: false, error: null });
}
export type CreateStudioProjectOptions = { transient?: boolean };
export function createStudioProject(owner: string, kind: StudioKind, options: CreateStudioProjectOptions = {}): Promise<StudioProject> {
  return serialized(owner, async () => {
    await loadStudioProjects(owner);
    if (studioSnapshot(owner).error) throw new Error(studioSnapshot(owner).error!);
    const now = new Date().toISOString();
    const project = withStudioTakes({
      version: 2, id: randomUUID(), ownerId: owner, kind, title: '', description: '',
      objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '',
      editing: emptyStudioEditing(kind), state: 'draft' as const, progress: 0, revision: 1, createdAt: now, updatedAt: now,
    });
    if (options.transient) {
      const sessions = transient.get(owner) || new Map<string, StudioProject>();
      sessions.set(project.id, project); transient.set(owner, sessions);
      publish(owner, { ...studioSnapshot(owner) });
    } else await persist(owner, [project, ...studioSnapshot(owner).projects]);
    return project;
  });
}
export function updateStudioProject(owner: string, id: string, patch: Partial<StudioProject>): Promise<StudioProject> {
  return mutateStudioProject(owner, id, () => patch);
}
/** A completed workspace copy enters the index once, after all its files exist. */
export function saveStudioProjectDuplicate(owner: string, sourceId: string, project: StudioProject, isCurrent: () => boolean): Promise<StudioProject> {
  return serialized(owner, async () => {
    await loadStudioProjects(owner);
    if (studioSnapshot(owner).error) throw new Error(studioSnapshot(owner).error!);
    if (!isCurrent()) throw new Error('A ação foi cancelada porque a sessão mudou.');
    const source = getStudioProject(owner, sourceId);
    if (!source || source.ownerId !== owner || project.ownerId !== owner || project.id === sourceId || getStudioProject(owner, project.id)) throw new Error('Este projeto não pertence à sessão atual.');
    if (source.pendingTakes?.length || ['preparing', 'uploading', 'processing'].includes(source.state)) throw new Error('Conclua a recuperação ou interrompa o envio antes de duplicar o projeto.');
    const issues = validateStudioEditing(project.editing!, project.kind).filter(issue => !issue.includes('cinematográfico'));
    if (issues.length) throw new Error(issues[0]);
    await persist(owner, [project, ...studioSnapshot(owner).projects]);
    return project;
  });
}
export function mutateStudioProject(owner: string, id: string, change: (project: StudioProject) => Partial<StudioProject>): Promise<StudioProject> {
  return serialized(owner, async () => {
    await loadStudioProjects(owner);
    if (studioSnapshot(owner).error) throw new Error(studioSnapshot(owner).error!);
    const existing = getStudioProject(owner, id);
    if (!existing) throw new Error('Este projeto não pertence à sessão atual.');
    if (existing.state === 'submitted') throw new Error('Este projeto já foi enviado para curadoria.');
    const patch = change(existing);
    if (patch.takes && patch.editing) throw new Error('Atualize a montagem por um único contrato de edição.');
    const editing = patch.editing ?? (patch.takes ? reconcileStudioTakes(existing, patch.takes) : existing.editing!);
    for (const asset of existing.editing!.assets) {
      const retained = editing.assets.find(candidate => candidate.id === asset.id);
      if (!retained || JSON.stringify(retained) !== JSON.stringify(asset)) throw new Error('A montagem deve preservar os arquivos originais dos takes.');
    }
    const issues = [...validateStudioEditing(editing, existing.kind), ...validateStudioPendingTakes(patch.pendingTakes ?? existing.pendingTakes)];
    const structural = issues.filter(issue => !issue.includes('cinematográfico'));
    if (structural.length) throw new Error(structural[0]);
    const updated = withStudioTakes({ ...existing, ...patch, editing, id, ownerId: owner, version: 2 as const,
      revision: existing.revision + 1, updatedAt: new Date().toISOString() });
    if (timelineSignature(existing) !== timelineSignature(updated)) {
      if (['preparing', 'uploading', 'processing'].includes(existing.state)) throw new Error('Aguarde ou interrompa o envio antes de editar os takes.');
      updated.state = 'draft'; updated.progress = 0; updated.error = undefined;
      updated.exportedUri = undefined; updated.exportedSignature = undefined;
      updated.mediaAssetId = undefined; updated.videoProvider = undefined; updated.uploadSignature = undefined;
      updated.uploadUrl = undefined; updated.uploadMethod = undefined; updated.uploadHeaders = undefined; updated.tusUrl = undefined;
    }
    if (patch.coverUri !== undefined && patch.coverUri !== existing.coverUri) updated.coverUrl = undefined;
    if (patch.takes || patch.editing) {
      updated.pendingTakes = updated.pendingTakes?.filter(pending => {
        if (pending.layerItem) return !editing.layers.some(layer => (!pending.layerId || layer.id === pending.layerId)
          && layer.items.some(item => item.id === pending.layerItem!.id && item.assetId === pending.id)
          && editing.assets.some(asset => asset.id === pending.id && asset.uri === pending.uri));
        const grade = normalizeStudioCaptureGrade(pending.grade);
        return !editing.main.some(clip => clip.id === pending.id
          && editing.assets.some(asset => asset.id === clip.assetId && asset.uri === pending.uri)
          && (!grade || (Object.keys(grade) as (keyof typeof grade)[]).every(key => clip.grade?.[key] === grade[key])));
      });
    }
    if (isTransientStudioProject(owner, id)) {
      if (!hasStudioMedia(updated) && !updated.pendingTakes?.length) {
        transient.get(owner)!.set(id, updated);
        publish(owner, { ...studioSnapshot(owner) });
      } else {
        // Persist before publishing or removing the transient entry. Disk
        // failure keeps the original session available for an honest retry.
        await persist(owner, [updated, ...studioSnapshot(owner).projects]);
        transient.get(owner)?.delete(id);
      }
    } else await persist(owner, studioSnapshot(owner).projects.map(p => p.id === id ? updated : p));
    return updated;
  });
}
export function removeStudioProject(owner: string, id: string, isCurrent?: () => boolean): Promise<void> {
  return serialized(owner, async () => {
    await loadStudioProjects(owner);
    if (studioSnapshot(owner).error) throw new Error(studioSnapshot(owner).error!);
    if (isCurrent && !isCurrent()) throw new Error('A ação foi cancelada porque a sessão mudou.');
    const project = getStudioProject(owner, id);
    if (mediaWrites.get(mediaKey(owner, id))) throw new Error('Aguarde seus arquivos serem salvos antes de remover o projeto.');
    if (project && ['uploading', 'preparing', 'processing'].includes(project.state)) throw new Error('Interrompa o envio antes de remover o projeto.');
    if (isTransientStudioProject(owner, id)) {
      transient.get(owner)?.delete(id);
      publish(owner, { ...studioSnapshot(owner) });
      return;
    }
    // Remove the index only. Never remove the source files automatically.
    await persist(owner, studioSnapshot(owner).projects.filter(p => p.id !== id));
  });
}

export function discardTransientStudioProject(owner: string, id: string): Promise<boolean> {
  return serialized(owner, async () => {
    const project = transient.get(owner)?.get(id);
    if (!project || hasStudioMedia(project) || project.pendingTakes?.length || mediaWrites.get(mediaKey(owner, id))) return false;
    transient.get(owner)?.delete(id);
    publish(owner, { ...studioSnapshot(owner) });
    return true;
  });
}
function hasStudioMedia(project: StudioProject) {
  return project.takes.length > 0 || project.editing?.layers.some(layer => layer.items.some(item => !!item.assetId));
}
export const discardTransient = discardTransientStudioProject;
