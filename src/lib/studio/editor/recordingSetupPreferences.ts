import type { StudioKind } from '../../../../shared/studio';

export type StudioRecordingSelection = { kind: StudioKind; mode: 'camera' | 'screen' | 'scenes' | 'remote'; remoteScenes: boolean };
const key = (owner: string, projectId?: string) => `classfy-studio-setup-v1:${owner}${projectId ? `:project:${projectId}` : ''}`;

/** Remembers choices only; never device access, credentials, media or activation. */
export function readStudioRecordingSelection(owner: string, premium: boolean, scenesSupported = true, projectId?: string): StudioRecordingSelection | null {
  try {
    const raw = localStorage.getItem(key(owner, projectId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StudioRecordingSelection>;
    if (!value || !['aula', 'short', 'podcast'].includes(value.kind ?? '') || !['camera', 'screen', 'scenes', 'remote'].includes(value.mode ?? '') || typeof value.remoteScenes !== 'boolean') return null;
    const kind = value.kind as StudioKind;
    let mode = value.mode as StudioRecordingSelection['mode'];
    if (kind === 'podcast' || !premium && (mode === 'remote' || mode === 'scenes') || !scenesSupported && mode === 'scenes') mode = 'camera';
    return { kind, mode, remoteScenes: mode === 'remote' && premium && scenesSupported && value.remoteScenes };
  } catch { return null; }
}

export function saveStudioRecordingSelection(owner: string, selection: StudioRecordingSelection, projectId?: string): void {
  try { localStorage.setItem(key(owner, projectId), JSON.stringify(selection)); } catch { /* Restricted storage never prevents recording. */ }
}
