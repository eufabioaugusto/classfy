import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { documentDirectory } from 'expo-file-system/legacy';
import type { StudioKind, StudioProject } from './model';
import { rebaseStudioProject, timelineSignature } from './model';

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
const key = (owner: string) => `classfy:studio:v1:${owner}`;
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
      const records: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(records) || records.some(p => !p || p.version !== 1 || p.ownerId !== owner || !Array.isArray(p.takes) || !['aula', 'short', 'podcast'].includes(p.kind))) {
        throw new Error('Os rascunhos deste aparelho precisam de recuperação. Os arquivos originais foram preservados.');
      }
      // Transfers cannot survive a killed JS process. Never infer completion.
      const projects = (records as StudioProject[]).map(p => rebaseStudioProject(p, documentDirectory)).map(p => ['uploading', 'preparing'].includes(p.state)
        ? { ...p, state: 'error' as const, error: 'O envio foi interrompido. Retome quando estiver pronto.' }
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
    const project: StudioProject = {
      version: 1, id: randomUUID(), ownerId: owner, kind, title: '', description: '',
      objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '',
      takes: [], state: 'draft', progress: 0, revision: 1, createdAt: now, updatedAt: now,
    };
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
export function mutateStudioProject(owner: string, id: string, change: (project: StudioProject) => Partial<StudioProject>): Promise<StudioProject> {
  return serialized(owner, async () => {
    await loadStudioProjects(owner);
    if (studioSnapshot(owner).error) throw new Error(studioSnapshot(owner).error!);
    const existing = getStudioProject(owner, id);
    if (!existing) throw new Error('Este projeto não pertence à sessão atual.');
    if (existing.state === 'submitted') throw new Error('Este projeto já foi enviado para curadoria.');
    const patch = change(existing);
    const updated = { ...existing, ...patch, id, ownerId: owner, version: 1 as const,
      revision: existing.revision + 1, updatedAt: new Date().toISOString() };
    if (timelineSignature(existing) !== timelineSignature(updated)) {
      if (['preparing', 'uploading', 'processing'].includes(existing.state)) throw new Error('Aguarde ou interrompa o envio antes de editar os takes.');
      updated.state = 'draft'; updated.progress = 0; updated.error = undefined;
      updated.exportedUri = undefined; updated.exportedSignature = undefined;
      updated.mediaAssetId = undefined; updated.videoProvider = undefined; updated.uploadSignature = undefined;
      updated.uploadUrl = undefined; updated.uploadMethod = undefined; updated.uploadHeaders = undefined; updated.tusUrl = undefined;
    }
    if (patch.coverUri !== undefined && patch.coverUri !== existing.coverUri) updated.coverUrl = undefined;
    if (patch.takes) updated.pendingTakes = updated.pendingTakes?.filter(pending => !updated.takes.some(take => take.id === pending.id || take.uri === pending.uri));
    if (isTransientStudioProject(owner, id)) {
      if (!updated.takes.length && !updated.pendingTakes?.length) {
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
export function removeStudioProject(owner: string, id: string): Promise<void> {
  return serialized(owner, async () => {
    await loadStudioProjects(owner);
    if (studioSnapshot(owner).error) throw new Error(studioSnapshot(owner).error!);
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
    if (!project || project.takes.length || project.pendingTakes?.length || mediaWrites.get(mediaKey(owner, id))) return false;
    transient.get(owner)?.delete(id);
    publish(owner, { ...studioSnapshot(owner) });
    return true;
  });
}
export const discardTransient = discardTransientStudioProject;
