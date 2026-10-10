import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/features/auth/authContext';
import type { StudioKind, StudioProject } from './model';
import { createStudioProject, getStudioProject, loadStudioProjects, recoverStudioProjects, removeStudioProject, studioSnapshot, subscribeStudio, updateStudioProject, type CreateStudioProjectOptions } from './store';
import { duplicateStudioProject, renameStudioProject, type StudioWorkspaceActionScope } from './workspaceActions';
const signedOut = { projects: [] as StudioProject[], loading: false, error: null };
export function useStudioProjects() {
  const { user } = useAuth();
  const owner = user?.id;
  const snapshot = useSyncExternalStore(subscribeStudio, () => owner ? studioSnapshot(owner) : signedOut, () => signedOut);
  useEffect(() => { if (owner) void loadStudioProjects(owner); }, [owner]);
  function requireOwner() { if (!owner) throw new Error('Entre na sua conta para abrir o Studio.'); return owner; }
  return { ...snapshot,
    create: (kind: StudioKind, options?: CreateStudioProjectOptions) => createStudioProject(requireOwner(), kind, options),
    update: (id: string, patch: Partial<StudioProject>) => updateStudioProject(requireOwner(), id, patch),
    remove: (id: string, scope?: StudioWorkspaceActionScope) => removeStudioProject(requireOwner(), id, scope?.isCurrent),
    recover: () => recoverStudioProjects(requireOwner()),
    rename: (id: string, title: string, scope: StudioWorkspaceActionScope) => renameStudioProject(requireOwner(), id, title, scope),
    duplicate: (id: string, scope: StudioWorkspaceActionScope) => duplicateStudioProject(requireOwner(), id, scope),
  };
}
export function useStudioProject(id: string) {
  const { user } = useAuth();
  const store = useStudioProjects();
  return { ...store, project: user ? getStudioProject(user.id, id) : undefined };
}
