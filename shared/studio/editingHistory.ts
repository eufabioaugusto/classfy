import type { StudioEditing, StudioKind, StudioProject, StudioTake } from './model';
import { deriveStudioTakes, reconcileStudioTakes, validateStudioEditing } from './model.ts';

export type StudioHistoryProject = Pick<StudioProject, 'id' | 'ownerId' | 'kind' | 'takes'> & Pick<Partial<StudioProject>, 'editing'>;
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
  /** Persist this instead of takes for a canonical v2 edit (never both). */
  readonly editing?: StudioEditing;
};

type Frame = { takes: StudioTake[]; editing?: StudioEditing };
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
    take.width ?? null, take.height ?? null, take.thumbnailUri ?? null, take.enhancement ?? null, take.portrait ?? null];
}

/** Local media paths deliberately participate: old iOS container paths must not return through undo. */
export function studioEditingFingerprint(project: StudioHistoryProject) {
  return JSON.stringify([project.ownerId, project.id, project.kind, project.takes.map(takeValues), project.editing ?? null]);
}

function sourceFingerprint(take: StudioTake) {
  return JSON.stringify([take.uri, take.duration, take.width ?? null, take.height ?? null, take.thumbnailUri ?? null]);
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(child => freeze(child));
    Object.freeze(value);
  }
  return value;
}
function snapshot(takes: readonly StudioTake[], editing?: StudioEditing): Frame {
  return freeze({ takes: takes.map(take => ({ ...take,
    ...(take.enhancement ? { enhancement: { ...take.enhancement } } : {}),
    ...(take.portrait ? { portrait: { ...take.portrait } } : {}) })),
    ...(editing ? { editing: JSON.parse(JSON.stringify(editing)) as StudioEditing } : {}) });
}
function validEditing(before: StudioEditing | undefined, after: StudioEditing, kind: StudioKind) {
  const issues = validateStudioEditing(after, kind);
  if (issues.length) throw new Error(issues[0]);
  for (const asset of before?.assets ?? []) {
    const original = after.assets.find(candidate => candidate.id === asset.id);
    if (!original || JSON.stringify(original) !== JSON.stringify(asset)) throw new Error('A montagem deve preservar os arquivos originais dos takes.');
  }
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

  function begin(project: StudioHistoryProject, direction: StudioEditingOperation['direction'], takes?: readonly StudioTake[], key = project.ownerId, requestedEditing?: StudioEditing) {
    sync(project, key);
    if (pending) throw new Error('Aguarde a montagem ser salva antes de editar novamente.');
    const targetFrame = direction === 'undo' ? undo.at(-1) : direction === 'redo' ? redo.at(-1) : undefined;
    const target = direction === 'edit' ? takes : targetFrame?.takes;
    if (!target && !requestedEditing) return null;
    let editing: StudioEditing | undefined;
    if (project.editing) {
      editing = direction === 'edit' ? requestedEditing ?? reconcileStudioTakes(project, target!) : targetFrame?.editing;
      if (!editing) throw new Error('O histórico desta edição precisa ser reaberto.');
      if (direction === 'edit') validEditing(project.editing, editing, project.kind);
      // Originals remain in the media library even when undo removes their use.
      editing = { ...editing, assets: [...project.editing.assets, ...editing.assets.filter(asset => !project.editing!.assets.some(existing => existing.id === asset.id))] };
      validEditing(project.editing, editing, project.kind);
    } else if (direction === 'edit') requireImmutableSources(project.takes, target!);
    else { requireValidTakes(project.takes); requireValidTakes(target!); }
    const after = snapshot(editing ? deriveStudioTakes(editing) : target!, editing);
    const fingerprint = studioEditingFingerprint({ ...project, takes: after.takes, editing: after.editing });
    if (fingerprint === observedFingerprint) return null;
    const operation: StudioEditingOperation = Object.freeze({ direction, takes: after.takes, ...(after.editing ? { editing: after.editing } : {}) });
    pending = { operation, before: snapshot(project.takes, project.editing), afterFingerprint: fingerprint,
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
    beginEditing: (project: StudioHistoryProject, editing: StudioEditing, key?: string) => begin(project, 'edit', undefined, key, editing),
    beginUndo: (project: StudioHistoryProject, key?: string) => begin(project, 'undo', undefined, key),
    beginRedo: (project: StudioHistoryProject, key?: string) => begin(project, 'redo', undefined, key),
  };
}
