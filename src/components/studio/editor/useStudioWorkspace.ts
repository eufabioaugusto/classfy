import { useCallback, useEffect, useRef, useState } from 'react';
import { getProject, saveProject } from '@/lib/studio/editor/storage';
import { withStudioTakes, type StudioProject } from '../../../../shared/studio';

/** One writer per mounted workspace. A failed write keeps the editable draft. */
export function useStudioWorkspace(owner: string, projectId: string) {
  const [project, setProject] = useState<StudioProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const current = useRef<StudioProject | null>(null);
  const persisted = useRef<StudioProject | null>(null);
  const epoch = useRef(0);
  const writer = useRef<Promise<StudioProject | null> | null>(null);
  const operation = useRef<{ promise: Promise<StudioProject | null> | null; saved: StudioProject | null; savedDraft: StudioProject | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const undo = useRef<StudioProject[]>([]), redo = useRef<StudioProject[]>([]);
  const publish = useCallback((value: StudioProject) => { current.current = value; setProject(value); }, []);
  useEffect(() => {
    const token = ++epoch.current;
    current.current = persisted.current = null; writer.current = null; operation.current = null;
    undo.current = []; redo.current = []; setProject(null); setLoading(true); setError(null); setSaving(false);
    getProject(owner, projectId).then(value => {
      if (token !== epoch.current) return;
      if (!value) throw new Error('Este projeto não está disponível neste navegador.');
      persisted.current = value; publish(value);
    }).catch(cause => { if (token === epoch.current) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o projeto.'); })
      .finally(() => { if (token === epoch.current) setLoading(false); });
    return () => {
      const snapshot = current.current, confirmed = persisted.current, pending = operation.current;
      const dirty = snapshot && snapshot.ownerId === owner && snapshot.id === projectId && snapshot !== confirmed;
      ++epoch.current; clearTimeout(timer.current);
      if (!dirty) return;
      // An SPA unmount must not cancel a pending debounce or the final revision
      // behind an in-flight write. This closure never reads the next owner's refs.
      void (async () => {
        if (pending?.promise) await pending.promise.catch(() => undefined);
        if (pending?.savedDraft === snapshot) return;
        const base = pending?.saved ?? confirmed;
        await saveProject(owner, withStudioTakes({ ...snapshot, editing: snapshot.editing!, revision: base?.revision ?? snapshot.revision }));
      })().catch(() => undefined); // The POP guard keeps failed writes on screen.
    };
  }, [owner, projectId, publish]);
  const flush = useCallback(async (): Promise<StudioProject | null> => {
    clearTimeout(timer.current);
    if (writer.current) return writer.current;
    if (!current.current || current.current === persisted.current) { setSaving(false); return current.current; }
    const token = epoch.current;
    const pending = { promise: null as Promise<StudioProject | null> | null, saved: persisted.current, savedDraft: null as StudioProject | null };
    operation.current = pending;
    const work = async () => {
      setSaving(true);
      try {
        while (token === epoch.current && current.current && current.current !== persisted.current) {
          const draft = current.current;
          const base = persisted.current?.revision ?? draft.revision;
          const saved = await saveProject(owner, withStudioTakes({ ...draft, editing: draft.editing!, revision: base }));
          pending.saved = saved; pending.savedDraft = draft;
          if (token !== epoch.current) return saved;
          persisted.current = saved;
          if (current.current === draft) publish(saved);
          else publish(withStudioTakes({ ...current.current!, editing: current.current!.editing!, revision: saved.revision }));
        }
        if (token === epoch.current) setError(null);
        return token === epoch.current ? current.current : null;
      } catch (cause) {
        if (token === epoch.current) setError(cause instanceof Error ? cause.message : 'A edição não pôde ser salva. Tente novamente.');
        throw cause;
      } finally { if (token === epoch.current) { writer.current = null; setSaving(false); } }
    };
    const promise = work(); pending.promise = promise; writer.current = promise;
    return promise;
  }, [owner, publish]);
  const schedule = useCallback(() => { setSaving(true); clearTimeout(timer.current); timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 350); }, [flush]);
  const apply = useCallback((change: (value: StudioProject) => StudioProject) => {
    const before = current.current; if (!before) return;
    const next = change(before);
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    undo.current.push(before); if (undo.current.length > 80) undo.current.shift(); redo.current = [];
    publish(next); setHistoryVersion(v => v + 1); schedule();
  }, [publish, schedule]);
  const travel = useCallback((direction: 'undo' | 'redo') => {
    const source = direction === 'undo' ? undo : redo, target = direction === 'undo' ? redo : undo;
    const previous = source.current.pop(), now = current.current;
    if (!previous || !now) return;
    target.current.push(now);
    // Undo edits never removes a durably imported original from this project.
    const assets = [...now.editing!.assets];
    for (const asset of previous.editing!.assets) if (!assets.some(a => a.id === asset.id)) assets.push(asset);
    publish(withStudioTakes({ ...previous, editing: { ...previous.editing!, assets }, revision: now.revision }));
    setHistoryVersion(v => v + 1); schedule();
  }, [publish, schedule]);
  const isCurrent = useCallback((token: number) => token === epoch.current && !!current.current && current.current.ownerId === owner && current.current.id === projectId, [owner, projectId]);
  const hasPendingChanges = useCallback(() => current.current !== persisted.current, []);
  void historyVersion;
  return { project, loading, saving, error, apply, flush, current, epoch, isCurrent, hasPendingChanges,
    canUndo: undo.current.length > 0, canRedo: redo.current.length > 0,
    undo: () => travel('undo'), redo: () => travel('redo'), dirty: current.current !== persisted.current };
}
