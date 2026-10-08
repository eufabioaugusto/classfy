import type { StudioKind, StudioProject, StudioTake } from './model';

export type StudioHistoryProject = Pick<StudioProject, 'id' | 'ownerId' | 'kind' | 'takes'>;
export type StudioEditingHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
};
export type StudioEditingOperation = {
  readonly direction: 'edit' | 'undo' | 'redo';
  /** Detached, frozen snapshots. Persist these takes without modifying them. */
  readonly takes: StudioTake[];
};

type Frame = { takes: StudioTake[] };
type Pending = {
  operation: StudioEditingOperation;
  before: Frame;
  afterFingerprint: string;
  scope: string;
  sessionKey: string;
  published: boolean;
};

function takeValues(take: StudioTake) {
  return [take.id, take.uri, take.name, take.duration, take.start, take.end,
    take.width ?? null, take.height ?? null, take.thumbnailUri ?? null];
}

/** Local media paths deliberately participate: old iOS container paths must not return through undo. */
export function studioEditingFingerprint(project: StudioHistoryProject) {
  return JSON.stringify([project.ownerId, project.id, project.kind, project.takes.map(takeValues)]);
}

function sourceFingerprint(take: StudioTake) {
  return JSON.stringify([take.uri, take.duration, take.width ?? null, take.height ?? null, take.thumbnailUri ?? null]);
}

function snapshot(takes: readonly StudioTake[]): Frame {
  const copied = takes.map(take => Object.freeze({ ...take }));
  // The public array is writable in the StudioProject type, but callers receive
  // immutable objects so a later mutation cannot corrupt a saved undo frame.
  Object.freeze(copied);
  return { takes: copied };
}

function requireValidTakes(takes: readonly StudioTake[]) {
  const ids = new Set<string>();
  for (const take of takes) {
    if (!take.id || ids.has(take.id) || !take.uri) throw new Error('A identificação dos takes precisa de recuperação.');
    if (![take.duration, take.start, take.end].every(Number.isFinite) || take.duration <= 0
      || take.start < 0 || take.end > take.duration + 0.05 || take.end - take.start < 0.1 - 1e-6) {
      throw new Error('Revise os limites deste take antes de editar.');
    }
    ids.add(take.id);
  }
}

function requireImmutableSources(before: readonly StudioTake[], after: readonly StudioTake[]) {
  requireValidTakes(before);
  requireValidTakes(after);
  const sources = new Set(before.map(sourceFingerprint));
  const byId = new Map(before.map(take => [take.id, sourceFingerprint(take)]));
  for (const take of after) {
    const source = sourceFingerprint(take);
    if (!sources.has(source) || byId.has(take.id) && byId.get(take.id) !== source) {
      throw new Error('A montagem deve preservar os arquivos originais dos takes.');
    }
  }
}

/**
 * Takes-only history. Begin inside the store's atomic mutation callback, then
 * commit only after persistence succeeds; abort a rejected save. No file, project
 * metadata, upload state or export signature is restored by this helper.
 */
export function createStudioEditingHistory(options: { limit?: number } = {}) {
  const configured = Number.isFinite(options.limit) ? Math.floor(options.limit!) : 50;
  const limit = Math.max(1, Math.min(100, configured));
  let scope: string | null = null;
  let sessionKey = '';
  let observedFingerprint: string | null = null;
  let pending: Pending | null = null;
  let undo: Frame[] = [];
  let redo: Frame[] = [];

  function state(): StudioEditingHistoryState {
    return { canUndo: !pending && undo.length > 0, canRedo: !pending && redo.length > 0,
      undoCount: undo.length, redoCount: redo.length };
  }
  function reset() { undo = []; redo = []; pending = null; }
  function clear() { reset(); scope = null; sessionKey = ''; observedFingerprint = null; }
  function projectScope(project: { ownerId: string; id: string; kind: StudioKind }, key: string) {
    return JSON.stringify([key, project.ownerId, project.id, project.kind]);
  }
  function sync(project: StudioHistoryProject | null | undefined, key = project?.ownerId ?? '') {
    if (!project) { clear(); return state(); }
    const nextScope = projectScope(project, key);
    const fingerprint = studioEditingFingerprint(project);
    if (scope !== nextScope) {
      reset(); scope = nextScope; sessionKey = key; observedFingerprint = fingerprint;
    } else if (fingerprint !== observedFingerprint) {
      // AsyncStorage publishes the successful mutation before its promise
      // reaches the editor. Recognize only this ticket's exact expected takes.
      if (pending && pending.scope === nextScope && pending.afterFingerprint === fingerprint) pending.published = true;
      else { reset(); observedFingerprint = fingerprint; }
    }
    return state();
  }

  function begin(project: StudioHistoryProject, direction: StudioEditingOperation['direction'], takes?: readonly StudioTake[], key = project.ownerId) {
    sync(project, key);
    if (pending) throw new Error('Aguarde a montagem ser salva antes de editar novamente.');
    const target = direction === 'edit' ? takes : direction === 'undo' ? undo.at(-1)?.takes : redo.at(-1)?.takes;
    if (!target) return null;
    if (direction === 'edit') requireImmutableSources(project.takes, target);
    else { requireValidTakes(project.takes); requireValidTakes(target); }
    const after = snapshot(target);
    const fingerprint = studioEditingFingerprint({ ...project, takes: after.takes });
    if (fingerprint === observedFingerprint) return null;
    const operation: StudioEditingOperation = Object.freeze({ direction, takes: after.takes });
    pending = { operation, before: snapshot(project.takes), afterFingerprint: fingerprint,
      scope: scope!, sessionKey: key, published: false };
    return operation;
  }
  function commit(operation: StudioEditingOperation, saved: StudioHistoryProject): boolean {
    const transaction = pending;
    // An old async response must not rebind a cleared/new account's history.
    if (!transaction || transaction.operation !== operation) return false;
    if (projectScope(saved, transaction.sessionKey) !== transaction.scope
      || studioEditingFingerprint(saved) !== transaction.afterFingerprint) {
      sync(saved, transaction.sessionKey);
      // A mismatched result can equal the old baseline; it still was not this
      // operation's saved result and may never advance any history stack.
      reset(); observedFingerprint = studioEditingFingerprint(saved);
      return false;
    }
    if (operation.direction === 'edit') { undo.push(transaction.before); redo = []; }
    else if (operation.direction === 'undo') { undo.pop(); redo.push(transaction.before); }
    else { redo.pop(); undo.push(transaction.before); }
    if (undo.length > limit) undo.splice(0, undo.length - limit);
    observedFingerprint = transaction.afterFingerprint;
    pending = null;
    return true;
  }
  function abort(operation: StudioEditingOperation | null | undefined) {
    if (!pending || pending.operation !== operation) return;
    const transaction = pending;
    pending = null;
    if (transaction.published) {
      // If the caller failed after the store already published, do not keep
      // history anchored to a baseline that is no longer on disk.
      reset(); observedFingerprint = transaction.afterFingerprint;
    }
  }

  return { sync, state, clear, commit, abort,
    beginEdit: (project: StudioHistoryProject, takes: readonly StudioTake[], key?: string) => begin(project, 'edit', takes, key),
    beginUndo: (project: StudioHistoryProject, key?: string) => begin(project, 'undo', undefined, key),
    beginRedo: (project: StudioHistoryProject, key?: string) => begin(project, 'redo', undefined, key),
  };
}
