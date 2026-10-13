import {
  addStudioLayerItem, applyStudioLayerTimelineRange, compileStudioRecipe, createStudioEditingHistory, createStudioTextItem,
  deriveStudioTakes, duplicateStudioLayer, duplicateStudioTake, locateStudioTime, moveStudioLayerItemToLane, moveStudioTake,
  patchStudioClipGrade, patchStudioClipEnhancement, patchStudioClipPortrait, patchStudioClipSignature, patchStudioClipProperties, patchStudioLayerItem, reconcileStudioTakes, removeStudioLayerItem,
  removeStudioTake, setStudioLayerHidden, setStudioLayerMuted, setStudioMainMuted, splitStudioLayer, splitStudioTake,
  studioEditing, studioSeconds, studioTicks, validateStudioEditing, withStudioTakes,
  type StudioAsset, type StudioClipPropertiesPatch, type StudioEditing, type StudioEffect, type StudioGrade,
  type StudioLayerItem, type StudioProject, type StudioRect, type StudioTextStyle, type StudioEnhancement, type StudioPortrait, type StudioSignature,
} from '../../../../shared/studio';

export { createStudioEditingHistory };
export type StudioWebClipPatch = StudioClipPropertiesPatch & {
  name?: string; rect?: Partial<StudioRect>; grade?: Partial<StudioGrade>; effect?: StudioEffect; text?: Partial<StudioTextStyle>;
  enhancement?: StudioEnhancement | null; portrait?: StudioPortrait | null; signature?: StudioSignature | null;
};
export type StudioWebItemIds = { itemId?: string; layerId?: string };
const uuid = (): string => crypto.randomUUID();

/** Commands edit the recipe only. The caller persists with its current base revision. */
function edit(project: StudioProject, editing: StudioEditing): StudioProject {
  if (['preparing', 'uploading', 'processing', 'submitted'].includes(project.state)) throw new Error('Aguarde a operação deste projeto antes de editar.');
  const issues = validateStudioEditing(editing, project.kind);
  if (issues.length) throw new Error(issues[0]);
  if (JSON.stringify(studioEditing(project)) === JSON.stringify(editing)) return project;
  return withStudioTakes({ ...project, version: 2, editing, state: 'draft', progress: 0, error: undefined,
    exportedUri: undefined, exportedSignature: undefined, uploadSignature: undefined });
}
function original(editing: StudioEditing, asset: StudioAsset): StudioEditing {
  const existing = editing.assets.find(value => value.id === asset.id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) throw new Error('A edição deve preservar o arquivo original.');
  return existing ? editing : { ...editing, assets: [...editing.assets, { ...asset }] };
}
function extent(project: StudioProject, atSeconds: number, durationSeconds: number) {
  const recipe = compileStudioRecipe(project), at = studioTicks(atSeconds);
  const duration = Math.min(studioTicks(durationSeconds), recipe.durationTicks - at);
  if (at < 0 || duration < studioTicks(.1)) throw new Error('Posicione o elemento dentro do conteúdo, com duração de pelo menos 0,1 segundo.');
  return { atTicks: at, durationTicks: duration };
}
export function addMainAsset(project: StudioProject, asset: StudioAsset, clipId = uuid()): StudioProject {
  const editing = original(studioEditing(project), asset);
  if (editing.main.some(value => value.id === clipId) || editing.layers.some(layer => layer.items.some(item => item.id === clipId))) throw new Error('O clip precisa de uma identificação nova.');
  return edit(project, { ...editing, main: [...editing.main, { id: clipId, assetId: asset.id, sourceStartTicks: 0,
    sourceEndTicks: asset.kind === 'image' ? 0 : asset.durationTicks, ...(asset.kind === 'image' ? { durationTicks: studioTicks(3) } : {}) }] });
}
export function addLayerAsset(project: StudioProject, asset: StudioAsset, atSeconds: number, ids: StudioWebItemIds = {}): StudioProject {
  const bounds = extent(project, atSeconds, asset.kind === 'image' ? 3 : studioSeconds(asset.durationTicks));
  const editing = original(studioEditing(project), asset), itemId = ids.itemId ?? uuid();
  const item: StudioLayerItem = { id: itemId, kind: asset.kind, assetId: asset.id, ...bounds,
    sourceStartTicks: 0, sourceEndTicks: asset.kind === 'image' ? 0 : bounds.durationTicks,
    ...(asset.kind !== 'audio' ? { rect: { x: .62, y: .08, width: .3, height: .3 }, fit: 'contain' } : {}) };
  return edit(project, addStudioLayerItem(editing, item, ids.layerId ?? `layer:item:${itemId}`));
}
export function addText(project: StudioProject, content: string, atSeconds: number, durationSeconds = 3, ids: StudioWebItemIds = {}): StudioProject {
  return text(project, content, atSeconds, durationSeconds, 'text', ids);
}
export function addCaption(project: StudioProject, content: string, atSeconds: number, durationSeconds: number, ids: StudioWebItemIds = {}): StudioProject {
  return text(project, content, atSeconds, durationSeconds, 'caption', ids);
}
function text(project: StudioProject, content: string, atSeconds: number, durationSeconds: number, kind: 'text' | 'caption', ids: StudioWebItemIds) {
  const itemId = ids.itemId ?? uuid(), bounds = extent(project, atSeconds, durationSeconds);
  const item = createStudioTextItem({ id: itemId, content, kind, ...bounds });
  return edit(project, addStudioLayerItem(studioEditing(project), item, ids.layerId ?? `layer:item:${itemId}`));
}
export function trimMainClip(project: StudioProject, id: string, sourceStartSeconds: number, sourceEndSeconds: number): StudioProject {
  const takes = deriveStudioTakes(studioEditing(project)), index = takes.findIndex(value => value.id === id);
  if (index < 0) throw new Error('Este clip não está mais na montagem.');
  const take = takes[index];
  if (![sourceStartSeconds, sourceEndSeconds].every(Number.isFinite) || sourceStartSeconds < 0 || sourceEndSeconds <= sourceStartSeconds) throw new Error('Revise os limites do corte.');
  if (take.kind === 'image') {
    takes[index] = { ...take, start: 0, end: sourceEndSeconds - sourceStartSeconds, duration: sourceEndSeconds - sourceStartSeconds };
  } else takes[index] = { ...take, start: sourceStartSeconds, end: sourceEndSeconds };
  return edit(project, reconcileStudioTakes(project, takes));
}
/** The UI passes the playhead, never the selected clip's unrelated source time. */
export function splitMainClip(project: StudioProject, id: string, atSeconds: number, ids: { leftId?: string; rightId?: string } = {}): StudioProject {
  const takes = deriveStudioTakes(studioEditing(project)), location = locateStudioTime(takes, atSeconds);
  if (location?.takeId !== id) throw new Error('Posicione o cursor dentro do clip selecionado para dividir.');
  return edit(project, reconcileStudioTakes(project, splitStudioTake(takes, id, location.sourceSeconds, ids.leftId ?? uuid(), ids.rightId ?? uuid())));
}
export function moveMainClip(project: StudioProject, id: string, targetIndex: number): StudioProject {
  const takes = deriveStudioTakes(studioEditing(project));
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= takes.length) throw new Error('A posição do clip não é válida.');
  const ordered = takes.filter(take => take.id !== id);
  return edit(project, reconcileStudioTakes(project, moveStudioTake(takes, id, ordered[targetIndex]?.id ?? null)));
}
export function moveLayerClip(project: StudioProject, id: string, newAtSeconds: number, targetZIndex?: number): StudioProject {
  const editing = studioEditing(project), visible = compileStudioRecipe(project).clips.find(value => value.id === id && value.zIndex > 0);
  if (!visible) throw new Error('Este elemento não está visível na montagem.');
  let next = applyStudioLayerTimelineRange(editing, id, { startSeconds: newAtSeconds, endSeconds: newAtSeconds + studioSeconds(visible.durationTicks) }, 'move');
  if (targetZIndex !== undefined) next = moveStudioLayerItemToLane(next, id, targetZIndex);
  return edit(project, next);
}
export function trimLayerClip(project: StudioProject, id: string, startSeconds: number, endSeconds: number): StudioProject {
  return edit(project, applyStudioLayerTimelineRange(studioEditing(project), id, { startSeconds, endSeconds }));
}
export function splitLayerClip(project: StudioProject, id: string, atSeconds: number, rightId = uuid()): StudioProject {
  return edit(project, splitStudioLayer(studioEditing(project), id, atSeconds, rightId));
}
export function removeClip(project: StudioProject, id: string): StudioProject {
  const editing = studioEditing(project);
  return edit(project, editing.main.some(clip => clip.id === id)
    ? reconcileStudioTakes(project, removeStudioTake(deriveStudioTakes(editing), id)) : removeStudioLayerItem(editing, id));
}
export function duplicateClip(project: StudioProject, id: string, duplicateId = uuid()): StudioProject {
  const editing = studioEditing(project);
  return edit(project, editing.main.some(clip => clip.id === id)
    ? reconcileStudioTakes(project, duplicateStudioTake(deriveStudioTakes(editing), id, duplicateId)) : duplicateStudioLayer(editing, id, duplicateId));
}
export function patchClip(project: StudioProject, id: string, patch: StudioWebClipPatch): StudioProject {
  const allowed = new Set(['name', 'rect', 'grade', 'effect', 'text', 'enhancement', 'portrait', 'signature', 'playbackRate', 'flipHorizontal', 'flipVertical', 'opacity', 'gain', 'fadeInTicks', 'fadeOutTicks', 'motion', 'fit', 'rotationDegrees']);
  if (Object.keys(patch).some(key => !allowed.has(key))) throw new Error('Use uma operação de corte ou movimento para alterar o intervalo do clip.');
  const { name, rect, grade, effect, text: textPatch, enhancement, portrait, signature, ...properties } = patch;
  let editing = studioEditing(project);
  if (Object.keys(properties).length) editing = patchStudioClipProperties(editing, id, properties);
  if (grade) editing = patchStudioClipGrade(editing, id, grade);
  if (enhancement !== undefined) editing = patchStudioClipEnhancement(editing, id, enhancement);
  if (portrait !== undefined) editing = patchStudioClipPortrait(editing, id, portrait);
  if (signature !== undefined) editing = patchStudioClipSignature(editing, id, signature);
  const main = editing.main.find(value => value.id === id);
  if (main) {
    if (textPatch) throw new Error('Selecione um texto para editar seu conteúdo.');
    editing = { ...editing, main: editing.main.map(value => value.id !== id ? value : { ...value,
      ...(name !== undefined ? { name } : {}), ...(effect !== undefined ? { effect } : {}),
      ...(rect ? { rect: { ...(value.rect ?? { x: 0, y: 0, width: 1, height: 1 }), ...rect } } : {}) }) };
  } else {
    if (name !== undefined) throw new Error('O nome deste elemento é definido por seu original.');
    editing = patchStudioLayerItem(editing, id, { ...(rect ? { rect } : {}), ...(effect !== undefined ? { effect } : {}), ...(textPatch ? { text: textPatch } : {}) });
  }
  return edit(project, editing);
}
export function setMainMuted(project: StudioProject, muted: boolean): StudioProject { return edit(project, setStudioMainMuted(studioEditing(project), muted)); }
export function setLayerMuted(project: StudioProject, layerId: string, muted: boolean): StudioProject { return edit(project, setStudioLayerMuted(studioEditing(project), layerId, muted)); }
export function setLayerHidden(project: StudioProject, layerId: string, hidden: boolean): StudioProject { return edit(project, setStudioLayerHidden(studioEditing(project), layerId, hidden)); }

export type StudioCommandHistory = ReturnType<typeof createStudioEditingHistory>;
/** History changes only after the caller's durable write succeeds. */
export async function persistHistoryEdit(history: StudioCommandHistory, before: StudioProject, next: StudioProject,
  persist: (project: StudioProject) => Promise<StudioProject>): Promise<StudioProject> {
  const operation = history.beginEditing(before, studioEditing(next));
  if (!operation) return before;
  try { const saved = await persist(next); history.commit(operation, saved); return saved; }
  catch (error) { history.abort(operation); throw error; }
}
async function restoreHistory(history: StudioCommandHistory, project: StudioProject, direction: 'undo' | 'redo', persist: (project: StudioProject) => Promise<StudioProject>) {
  const operation = direction === 'undo' ? history.beginUndo(project) : history.beginRedo(project);
  if (!operation?.editing) return project;
  try { const saved = await persist(edit(project, operation.editing)); history.commit(operation, saved); return saved; }
  catch (error) { history.abort(operation); throw error; }
}
export function undoProject(project: StudioProject, history: StudioCommandHistory, persist: (project: StudioProject) => Promise<StudioProject>) { return restoreHistory(history, project, 'undo', persist); }
export function redoProject(project: StudioProject, history: StudioCommandHistory, persist: (project: StudioProject) => Promise<StudioProject>) { return restoreHistory(history, project, 'redo', persist); }
