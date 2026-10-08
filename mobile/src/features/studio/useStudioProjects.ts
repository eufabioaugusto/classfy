import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/features/auth/authContext';
import type { StudioKind, StudioProject } from './model';
import { createStudioProject, loadStudioProjects, removeStudioProject, studioSnapshot, subscribeStudio, updateStudioProject } from './store';
const signedOut = { projects: [] as StudioProject[], loading: false, error: null };
export function useStudioProjects() {
  const { user } = useAuth();
  const owner = user?.id;
  const snapshot = useSyncExternalStore(subscribeStudio, () => owner ? studioSnapshot(owner) : signedOut, () => signedOut);
  useEffect(() => { if (owner) void loadStudioProjects(owner); }, [owner]);
  function requireOwner() { if (!owner) throw new Error('Entre na sua conta para abrir o Studio.'); return owner; }
  return { ...snapshot,
    create: (kind: StudioKind) => createStudioProject(requireOwner(), kind),
    update: (id: string, patch: Partial<StudioProject>) => updateStudioProject(requireOwner(), id, patch),
    remove: (id: string) => removeStudioProject(requireOwner(), id),
  };
}
export function useStudioProject(id: string) {
  const store = useStudioProjects();
  return { ...store, project: store.projects.find(p => p.id === id) };
}
