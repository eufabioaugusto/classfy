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
  if (editing.clipGroups) {
    const ids = new Set([...editing.main, ...editing.layers.flatMap(layer => layer.items)].map(clip => clip.id));
    editing = { ...editing, clipGroups: editing.clipGroups.map(group => group.filter(id => ids.has(id))).filter(group => group.length > 1) };
  }
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
export function addCaptionTrack(project: StudioProject, cues: readonly { text: string; start: number; end: number }[],
  style: Partial<StudioTextStyle>): StudioProject {
  const editing = studioEditing(project);
  const duration = compileStudioRecipe(project).durationTicks;
  const items = cues.flatMap(cue => {
    const atTicks = studioTicks(cue.start);
    const durationTicks = Math.min(duration, studioTicks(cue.end)) - atTicks;
    if (atTicks < 0 || durationTicks < studioTicks(.1)) return [];
    const item = createStudioTextItem({ id: uuid(), content: cue.text, kind: 'caption', atTicks, durationTicks });
    return [{ ...item, text: { ...item.text!, ...style, content: cue.text } }];
  });
  if (!items.length) return project;
  return edit(project, { ...editing, layers: [...editing.layers, { id: `captions:${uuid()}`, kind: 'caption', items }] });
}
function text(project: StudioProject, content: string, atSeconds: number, durationSeconds: number, kind: 'text' | 'caption', ids: StudioWebItemIds) {
  const itemId = ids.itemId ?? uuid(), bounds = extent(project, atSeconds, durationSeconds);
  const item = createStudioTextItem({ id: itemId, content, kind, ...bounds });
  return edit(project, addStudioLayerItem(studioEditing(project), item, ids.layerId ?? `layer:item:${itemId}`));
}
/** Prototype scope: a single video before overlays or timing effects are added. */
export function classEditTarget(project: StudioProject) {
  const editing = studioEditing(project);
  const clip = editing.main[0];
  if (editing.main.length !== 1 || editing.layers.some(layer => layer.items.length)
    || clip.signature || (clip.playbackRate ?? 1) !== 1
    || clip.fadeInTicks || clip.fadeOutTicks || (clip.motion && clip.motion !== 'none')) return;
  const asset = editing.assets.find(value => value.id === clip.assetId);
  if (asset?.kind === 'video' && asset.hasAudio !== false) return { clip, asset };
}

export function applyClassEdit(project: StudioProject, clipId: string,
  pauses: readonly { start: number; end: number }[], enhancement?: StudioEnhancement, portrait?: StudioPortrait, grade?: StudioGrade): StudioProject {
  const target = classEditTarget(project);
  if (!target || target.clip.id !== clipId) throw new Error('A montagem mudou durante a análise do Class Edit.');
  if (!pauses.length && !enhancement && !portrait && !grade) return project;
  const editing = studioEditing(project);
  const clip = { ...target.clip, ...(enhancement ? { enhancement } : {}), ...(portrait ? { portrait } : {}), ...(grade ? { grade, effect: grade.preset } : {}) };
  let cursor = clip.sourceStartTicks;
  const main: StudioEditing['main'] = [];
  const keep = (end: number) => {
    if (end > cursor) main.push({ ...clip, id: main.length ? uuid() : clipId, sourceStartTicks: cursor, sourceEndTicks: end });
  };
  for (const pause of pauses) {
    const start = studioTicks(pause.start), end = studioTicks(pause.end);
    if (start < cursor || end <= start || end > clip.sourceEndTicks) throw new Error('Revise os limites dos cortes do Class Edit.');
    keep(start);
    cursor = end;
  }
  keep(clip.sourceEndTicks);
  if (!main.length) throw new Error('O Class Edit precisa preservar ao menos um trecho.');
  return edit(project, { ...editing, main });
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
  const editing = studioEditing(project);
  const group = editing.clipGroups?.find(members => members.includes(id)) ?? [id];
  const groupTakes = takes.filter(take => group.includes(take.id));
  if (group.length === 1) {
    const ordered = takes.filter(take => take.id !== id);
    return edit(project, reconcileStudioTakes(project, moveStudioTake(takes, id, ordered[targetIndex]?.id ?? null)));
  }
  if (group.includes(takes[targetIndex].id)) return project;
  const ordered = takes.filter(take => !group.includes(take.id));
  const target = ordered.findIndex(take => take.id === takes[targetIndex].id);
  ordered.splice(target + (targetIndex > takes.findIndex(take => take.id === id) ? 1 : 0), 0, ...groupTakes);
  const next = reconcileStudioTakes(project, ordered);
  const oldStart = compileStudioRecipe(project).clips.find(clip => clip.id === id)!.startTicks;
  const newStart = compileStudioRecipe({ ...project, editing: next }).clips.find(clip => clip.id === id)!.startTicks;
  const layers = next.layers.map(layer => ({ ...layer, items: layer.items.map(item => group.includes(item.id) && !item.anchor
    ? { ...item, atTicks: Math.max(0, item.atTicks + newStart - oldStart) } : item) }));
  return edit(project, { ...next, layers });
}
export function moveLayerClip(project: StudioProject, id: string, newAtSeconds: number, targetZIndex?: number): StudioProject {
  const editing = studioEditing(project), recipe = compileStudioRecipe(project);
  const visible = recipe.clips.find(value => value.id === id && value.zIndex > 0);
  if (!visible) throw new Error('Este elemento não está visível na montagem.');
  const members = editing.clipGroups?.find(group => group.includes(id)) ?? [id];
  const moving = recipe.clips.filter(clip => clip.zIndex > 0 && members.includes(clip.id));
  if (members.some(member => editing.main.some(clip => clip.id === member))) return project;
  const delta = Math.max(-Math.min(...moving.map(clip => studioSeconds(clip.startTicks))), newAtSeconds - studioSeconds(visible.startTicks));
  let next = editing;
  for (const clip of moving) {
    next = applyStudioLayerTimelineRange(next, clip.id, {
      startSeconds: studioSeconds(clip.startTicks) + delta,
      endSeconds: studioSeconds(clip.startTicks + clip.durationTicks) + delta,
    }, 'move');
  }
  if (targetZIndex !== undefined && moving.length === 1) next = moveStudioLayerItemToLane(next, id, targetZIndex);
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
export function groupStudioClips(project: StudioProject, ids: readonly string[], group: boolean): StudioProject {
  const editing = studioEditing(project);
  const previous = editing.clipGroups ?? [];
  const touched = previous.filter(members => members.some(id => ids.includes(id)));
  const remaining = previous.filter(members => !touched.includes(members));
  const members = [...new Set([...ids, ...touched.flat()])];
  if (group && members.length < 2 || !group && !touched.length) return project;
  if (group) remaining.push(members);
  return edit(project, { ...editing, clipGroups: remaining });
}

export function copyStudioClips(project: StudioProject, ids: readonly string[]) {
  const editing = studioEditing(project);
  const clips = compileStudioRecipe(project).clips.filter(clip => ids.includes(clip.id));
  const starts = new Map(clips.map(clip => [clip.id, clip.startTicks]));
  const visible = new Map(clips.map(clip => [clip.id, clip]));
  return {
    start: Math.min(...starts.values()),
    groups: (editing.clipGroups ?? []).map(group => group.filter(id => starts.has(id))).filter(group => group.length > 1),
    main: editing.main.filter(clip => starts.has(clip.id)),
    layers: editing.layers.flatMap(layer => {
      const items = layer.items.flatMap(item => {
        const clip = visible.get(item.id);
        if (!clip) return [];
        return [{ ...item, atTicks: clip.startTicks, durationTicks: clip.durationTicks,
          sourceStartTicks: clip.sourceStartTicks, sourceEndTicks: clip.sourceEndTicks,
          fadeInTicks: clip.fadeInTicks, fadeOutTicks: clip.fadeOutTicks,
          animationOffsetTicks: clip.animationOffsetTicks, motionOffsetTicks: clip.motionOffsetTicks }];
      });
      return items.length ? [{ ...layer, items }] : [];
    }),
  };
}

export function pasteStudioClips(project: StudioProject, copied: ReturnType<typeof copyStudioClips>, at: number, ids: Map<string, string>): StudioProject {
  const editing = studioEditing(project);
  const recipe = compileStudioRecipe(project);
  const atTicks = studioTicks(at);
  const main = [...editing.main];
  const index = recipe.clips.filter(clip => clip.zIndex === 0).findIndex(clip => clip.startTicks >= atTicks);
  const insertion = index < 0 ? main.length : index;
  const position = index < 0 ? recipe.clips.filter(clip => clip.zIndex === 0).reduce((end, clip) => Math.max(end, clip.startTicks + clip.durationTicks), 0)
    : recipe.clips.find(clip => clip.id === main[index].id)!.startTicks;
  main.splice(insertion, 0, ...copied.main.map(clip => ({ ...clip, id: ids.get(clip.id)! })));
  const offset = (copied.main.length ? position : atTicks) - copied.start;
  let next: StudioEditing = { ...editing, main, clipGroups: [...(editing.clipGroups ?? []), ...copied.groups.map(group => group.map(id => ids.get(id)!))] };
  for (const layer of copied.layers) {
    for (const { anchor, ...item } of layer.items) {
      next = addStudioLayerItem(next, { ...item, id: ids.get(item.id)!, atTicks: item.atTicks + offset,
        ...(anchor && ids.has(anchor.clipId) ? { anchor: { ...anchor, clipId: ids.get(anchor.clipId)! } } : {}) }, layer.id);
    }
  }
  return edit(project, next);
}

export function rollStudioBoundary(project: StudioProject, leftId: string, rightId: string, offset: number): StudioProject {
  const editing = studioEditing(project), takes = deriveStudioTakes(editing);
  const index = takes.findIndex(take => take.id === leftId);
  const left = takes[index], right = takes[index + 1];
  if (!left || right?.id !== rightId) return project;
  const leftRate = left.playbackRate ?? 1, rightRate = right.playbackRate ?? 1;
  const low = Math.max(.1 - (left.end - left.start) / leftRate, right.kind === 'image' ? -Infinity : -right.start / rightRate);
  const high = Math.min((right.end - right.start) / rightRate - .1, left.kind === 'image' ? Infinity : (left.duration - left.end) / leftRate);
  if (low > high) return project;
  const delta = Math.max(low, Math.min(high, offset));
  takes[index] = { ...left, end: left.end + delta * leftRate };
  takes[index + 1] = right.kind === 'image' ? { ...right, end: right.end - delta } : { ...right, start: right.start + delta * rightRate };
  return edit(project, reconcileStudioTakes(project, takes));
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
