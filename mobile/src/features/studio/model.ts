export type StudioKind = 'aula' | 'short' | 'podcast';
export type StudioVisibility = 'free' | 'pro' | 'premium' | 'paid';
export type StudioState = 'draft' | 'preparing' | 'uploading' | 'processing' | 'ready' | 'submitted' | 'error';
export type StudioTake = {
  id: string;
  uri: string;
  name: string;
  duration: number;
  start: number;
  end: number;
  width?: number;
  height?: number;
  thumbnailUri?: string;
  assetId?: string;
  sourceKind?: 'standard' | 'cinematic';
  sourceStage?: 'standard' | 'cinematicRaw' | 'cinematicRendered';
  frameRate?: number;
  colorSpace?: string;
  /** Still images use presentation duration in the takes adapter. */
  kind?: 'video' | 'image' | 'audio';
};
export type StudioProject = {
  version: 1 | 2;
  id: string;
  ownerId: string;
  kind: StudioKind;
  title: string;
  description: string;
  objective: string;
  audience: string;
  script: string;
  tags: string[];
  visibility: StudioVisibility;
  price: string;
  /** Derived adapter in v2. Never serialized as a second canonical timeline. */
  takes: StudioTake[];
  editing?: StudioEditing;
  pendingTakes?: { id: string; uri: string; name: string; sourceUri?: string; kind?: StudioAssetKind; sourceKind?: 'standard' | 'cinematic'; sourceStage?: StudioSourceStage; frameRate?: number; colorSpace?: string; layerItem?: StudioLayerItem; layerId?: string }[];
  coverUri?: string;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  state: StudioState;
  progress: number;
  error?: string;
  remoteDraftId?: string;
  remoteSavedAt?: string;
  mediaAssetId?: string;
  videoProvider?: string;
  uploadSignature?: string;
  exportedUri?: string;
  exportedSignature?: string;
  uploadUrl?: string;
  uploadMethod?: 'PUT' | 'TUS' | 'MOCK';
  uploadHeaders?: Record<string, string>;
  uploadExpiresAt?: string;
  tusUrl?: string;
  submissionId?: string;
  contentId?: string;
};
export const studioFormats = [
  { kind: 'aula', title: 'Aula', detail: 'Uma ideia que merece profundidade.', ratio: '16:9' },
  { kind: 'short', title: 'Short', detail: 'Um aprendizado em até 3 minutos.', ratio: '9:16' },
  { kind: 'podcast', title: 'Podcast', detail: 'Dê voz ao seu conhecimento.', ratio: 'Áudio' },
] as const;
export function timelineDuration(takes: readonly StudioTake[]) {
  return takes.reduce((sum, take) => sum + Math.max(0, take.end - take.start), 0);
}
// Project schema and renderer are independent. Legacy artifacts are adopted only
// when their old signature proves the unchanged sequential render.
export const STUDIO_RENDER_VERSION = 3;
export function timelineSignature(project: Pick<StudioProject, 'kind' | 'takes'> & Partial<StudioProject>) {
  if (!project.editing) return legacyTimelineSignature(project);
  const recipe = compileStudioRecipe(project);
  return JSON.stringify([STUDIO_RENDER_VERSION, recipe, recipe.assets.map(asset => asset.id)], (key, value) => key === 'uri' || key === 'thumbnailUri' ? undefined : value);
}
export function legacyTimelineSignature(project: Pick<StudioProject, 'kind' | 'takes'>) {
  return JSON.stringify([2, project.kind, project.takes.map(t => [t.id, t.uri, t.start, t.end])]);
}
export function formatStudioDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
export function formatStudioEditorTime(seconds: number) {
  const tenths = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 10));
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}
export function publicationIssues(project: StudioProject) {
  const issues: string[] = [];
  if (!project.title.trim()) issues.push('Adicione um título.');
  if (project.kind !== 'short' && !project.description.trim()) issues.push('Conte o que o aluno vai aprender.');
  if (!project.takes.length) issues.push('Grave ou importe seu conteúdo.');
  if (project.pendingTakes?.length) issues.push('Recupere ou retire os arquivos pendentes antes de enviar.');
  if (project.takes.some(t => !Number.isFinite(t.duration) || !Number.isFinite(t.start) || !Number.isFinite(t.end) || t.start < 0 || t.end > t.duration + 0.05 || t.end - t.start < 0.1 - 1e-6)) issues.push('Revise os cortes dos takes.');
  let duration = timelineDuration(project.takes);
  if (project.editing) {
    try { const recipe = compileStudioRecipe(project); duration = studioSeconds(recipe.durationTicks); issues.push(...validateStudioEditing(project.editing, project.kind)); }
    catch { issues.push('Revise os cortes e os originais da montagem.'); }
  }
  if (project.kind === 'short' && duration > 180) issues.push('Shorts devem ter até 3 minutos.');
  if (!project.coverUri && !project.coverUrl) issues.push('Escolha uma capa.');
  if (project.visibility === 'paid' && (!Number.isFinite(Number(project.price.replace(',', '.'))) || Number(project.price.replace(',', '.')) <= 0)) issues.push('Defina um preço válido.');
  return issues;
}
export const studioStateLabel: Record<StudioState, string> = {
  draft: 'Rascunho', preparing: 'Preparando vídeo', uploading: 'Enviando',
  processing: 'Processando', ready: 'Pronto para enviar', submitted: 'Em curadoria', error: 'Envio interrompido',
};
// iOS may relocate the data container during an app update. Store-owned files
// are rebased to the current Documents root; arbitrary external files are not.
export function rebaseStudioProject(project: StudioProject, documentDirectory: string | null): StudioProject {
  if (!documentDirectory) return project;
  const relativeRoot = `classfy-studio/${project.ownerId}/${project.id}/`;
  const uri = (value?: string) => {
    if (!value) return value;
    const marker = `/Documents/${relativeRoot}`;
    const index = value.indexOf(marker);
    return index >= 0 ? `${documentDirectory}${relativeRoot}${value.slice(index + marker.length)}` : value;
  };
  if (project.editing) return withStudioTakes({ ...project, coverUri: uri(project.coverUri), exportedUri: uri(project.exportedUri),
    editing: { ...project.editing, assets: project.editing.assets.map(asset => ({ ...asset, uri: uri(asset.uri)!, thumbnailUri: uri(asset.thumbnailUri) })) },
    pendingTakes: project.pendingTakes?.map(t => ({ ...t, uri: uri(t.uri)! })) });
  const updated = { ...project, coverUri: uri(project.coverUri), exportedUri: uri(project.exportedUri),
    takes: project.takes.map(t => ({ ...t, uri: uri(t.uri)!, thumbnailUri: uri(t.thumbnailUri) })),
    pendingTakes: project.pendingTakes?.map(t => ({ ...t, uri: uri(t.uri)! })) };
  if (updated.exportedSignature && project.exportedSignature === timelineSignature(project)) updated.exportedSignature = timelineSignature(updated);
  if (updated.uploadSignature && project.uploadSignature === timelineSignature(project)) updated.uploadSignature = timelineSignature(updated);
  return updated;
}

export const STUDIO_TIMEBASE = 120_000 as const;
export type StudioAssetKind = 'video' | 'image' | 'audio';
export type StudioSourceStage = 'standard' | 'cinematicRaw' | 'cinematicRendered';
export type StudioEffect = 'natural' | 'studio' | 'cinematic';
export type StudioGrade = { preset: StudioEffect; intensity: number; exposure: number; contrast: number; saturation: number; temperature: number };
export type StudioRect = { x: number; y: number; width: number; height: number };
export type StudioTextStyle = { content: string; fontFamily: string; fontSize: number; color: string; backgroundColor: string; alignment: 'left' | 'center' | 'right' };
export type StudioAsset = {
  id: string; kind: StudioAssetKind; uri: string; name: string; durationTicks: number;
  width?: number; height?: number; frameRate?: number; thumbnailUri?: string;
  sourceKind?: 'standard' | 'cinematic'; sourceStage?: StudioSourceStage; colorSpace?: string;
};
export type StudioMainClip = {
  id: string; assetId: string; name?: string; sourceStartTicks: number; sourceEndTicks: number;
  /** Still image hold; temporal originals derive duration from their source range. */
  durationTicks?: number; effect?: StudioEffect; grade?: StudioGrade; gain?: number;
};
export type StudioLayerKind = StudioAssetKind | 'text' | 'caption';
export type StudioLayerAnchor = { clipId: string; offsetTicks?: number; sourceStartTicks?: number; sourceEndTicks?: number };
export type StudioLayerItem = {
  id: string; kind: StudioLayerKind; assetId?: string; atTicks: number; durationTicks: number;
  sourceStartTicks?: number; sourceEndTicks?: number; anchor?: StudioLayerAnchor;
  rect?: StudioRect; rotationDegrees?: number; fit?: 'contain' | 'cover'; opacity?: number;
  gain?: number; fadeInTicks?: number; fadeOutTicks?: number; effect?: StudioEffect; grade?: StudioGrade; text?: StudioTextStyle;
};
export type StudioLayer = { id: string; kind: StudioLayerKind; items: StudioLayerItem[] };
export type StudioOutputProfile = {
  profile: 'standard' | 'legacy-source'; width: number; height: number;
  frameRateNumerator: number; frameRateDenominator: number; colorSpace: 'rec709' | 'source';
};
export type StudioEditing = {
  version: 2; timebase: typeof STUDIO_TIMEBASE; assets: StudioAsset[]; main: StudioMainClip[]; layers: StudioLayer[];
  canvas: { aspectRatio: 'landscape' | 'portrait' | 'square'; backgroundColor: string }; output: StudioOutputProfile;
};
export type StudioRecipeClip = {
  id: string; kind: StudioLayerKind; assetId?: string; startTicks: number; durationTicks: number;
  sourceStartTicks: number; sourceEndTicks: number; zIndex: number; rect: StudioRect;
  rotationDegrees: number; fit: 'contain' | 'cover'; opacity: number; gain: number;
  fadeInTicks: number; fadeOutTicks: number; effect: StudioEffect; grade?: StudioGrade; text?: StudioTextStyle;
};
export type StudioRenderRecipe = {
  version: 2; timebase: typeof STUDIO_TIMEBASE; durationTicks: number; mediaType: 'video' | 'audio';
  canvas: StudioEditing['canvas']; output: StudioOutputProfile; assets: StudioAsset[]; clips: StudioRecipeClip[];
};
export function studioTicks(seconds: number) {
  if (!Number.isFinite(seconds) || !Number.isSafeInteger(Math.round(seconds * STUDIO_TIMEBASE))) throw new Error('O tempo da edição não é válido.');
  return Math.round(seconds * STUDIO_TIMEBASE);
}
export function studioSeconds(ticks: number) { return ticks / STUDIO_TIMEBASE; }
export function studioGrade(preset: StudioEffect = 'natural'): StudioGrade {
  return { preset, intensity: 1, exposure: 0, contrast: 0, saturation: 0, temperature: 0 };
}
export function emptyStudioEditing(kind: StudioKind, legacy = false): StudioEditing {
  const portrait = kind === 'short';
  return { version: 2, timebase: STUDIO_TIMEBASE, assets: [], main: [], layers: [],
    canvas: { aspectRatio: portrait ? 'portrait' : 'landscape', backgroundColor: '#000000' },
    output: { profile: legacy ? 'legacy-source' : 'standard', width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080,
      frameRateNumerator: 30, frameRateDenominator: 1, colorSpace: legacy ? 'source' : 'rec709' } };
}
/** The path of an immutable original identifies it locally, independently of the iOS container. */
function stableStudioPath(uri: string) {
  const at = uri.indexOf('/classfy-studio/');
  return at >= 0 ? uri.slice(at) : uri;
}
function sourceIdentity(take: StudioTake) { return stableStudioPath(take.uri); }
function mainDuration(clip: StudioMainClip, asset?: StudioAsset) {
  return asset?.kind === 'image' ? clip.durationTicks ?? 0 : clip.sourceEndTicks - clip.sourceStartTicks;
}
export function deriveStudioTakes(editing: StudioEditing): StudioTake[] {
  const assets = new Map(editing.assets.map(asset => [asset.id, asset]));
  return editing.main.map(clip => {
    const asset = assets.get(clip.assetId);
    if (!asset) throw new Error('Um original da montagem precisa de recuperação.');
    const image = asset.kind === 'image';
    return { id: clip.id, assetId: asset.id, uri: asset.uri, name: clip.name ?? asset.name,
      duration: studioSeconds(image ? clip.durationTicks ?? 0 : asset.durationTicks),
      start: studioSeconds(image ? 0 : clip.sourceStartTicks), end: studioSeconds(image ? clip.durationTicks ?? 0 : clip.sourceEndTicks),
      width: asset.width, height: asset.height, thumbnailUri: asset.thumbnailUri, kind: asset.kind,
      sourceKind: asset.sourceKind, sourceStage: asset.sourceStage, frameRate: asset.frameRate, colorSpace: asset.colorSpace };
  });
}
function freezeStudioValue<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(child => freezeStudioValue(child)); Object.freeze(value); }
  return value;
}
export function withStudioTakes<T extends Partial<StudioProject> & { editing: StudioEditing }>(project: T): T & StudioProject {
  const result = { ...project, editing: freezeStudioValue(project.editing) } as T & StudioProject;
  const takes = freezeStudioValue(deriveStudioTakes(result.editing!));
  // A getter keeps legacy consumers compatible while JSON contains only editing.
  Object.defineProperty(result, 'takes', { configurable: true, enumerable: false, get: () => takes });
  return result;
}
export function studioEditing(project: Pick<StudioProject, 'kind' | 'takes'> & Partial<StudioProject>): StudioEditing {
  return project.editing ?? reconcileStudioTakes({ ...project, editing: emptyStudioEditing(project.kind, true) }, project.takes);
}
export function reconcileStudioTakes(project: Pick<StudioProject, 'kind'> & Partial<StudioProject>, takes: readonly StudioTake[]): StudioEditing {
  const previous = project.editing ?? emptyStudioEditing(project.kind, true);
  const assets = [...previous.assets];
  const byAsset = new Map(assets.map(asset => [asset.id, asset]));
  const previousById = new Map(previous.main.map(clip => [clip.id, clip]));
  const origins = new Map<string, string>();
  const ids = new Set<string>();
  const main = takes.map(take => {
    if (!take.id || ids.has(take.id)) throw new Error('A identificação dos takes precisa de recuperação.');
    ids.add(take.id);
    const sameClip = previousById.get(take.id);
    let asset = sameClip ? byAsset.get(sameClip.assetId) : take.assetId ? byAsset.get(take.assetId) : undefined;
    asset ??= assets.find(candidate => stableStudioPath(candidate.uri) === sourceIdentity(take));
    if (asset && stableStudioPath(asset.uri) !== sourceIdentity(take)) throw new Error('A montagem deve preservar os arquivos originais dos takes.');
    if (!asset) {
      // Deterministic migration/retries. A duplicate/split resolves the existing URI first.
      const assetId = take.assetId || `source:${encodeURIComponent(sourceIdentity(take))}`;
      if (byAsset.has(assetId)) throw new Error('A identificação de um original precisa de recuperação.');
      asset = { id: assetId, uri: take.uri, name: take.name, kind: take.kind ?? (project.kind === 'podcast' ? 'audio' : 'video'),
        durationTicks: take.kind === 'image' ? 0 : studioTicks(take.duration), width: take.width, height: take.height,
        thumbnailUri: take.thumbnailUri, frameRate: take.frameRate, sourceKind: take.sourceKind, sourceStage: take.sourceStage, colorSpace: take.colorSpace };
      assets.push(asset); byAsset.set(asset.id, asset);
    } else if (asset.kind !== 'image' && studioTicks(take.duration) !== asset.durationTicks
      || take.width !== undefined && asset.width !== take.width || take.height !== undefined && asset.height !== take.height) {
      throw new Error('A montagem deve preservar os arquivos originais dos takes.');
    }
    const start = asset.kind === 'image' ? 0 : studioTicks(take.start);
    const end = asset.kind === 'image' ? 0 : studioTicks(take.end);
    const origin = sameClip ?? previous.main.find(clip => clip.assetId === asset!.id && clip.sourceStartTicks === start && clip.sourceEndTicks === end)
      ?? previous.main.find(clip => clip.assetId === asset!.id && clip.sourceStartTicks < end && clip.sourceEndTicks > start);
    if (origin) origins.set(take.id, origin.id);
    return { ...(origin ?? {}), id: take.id, assetId: asset.id, name: take.name,
      sourceStartTicks: start, sourceEndTicks: end, ...(asset.kind === 'image' ? { durationTicks: studioTicks(take.end - take.start) } : {}) } as StudioMainClip;
  });
  const layers = previous.layers.map(layer => ({ ...layer, items: layer.items.flatMap(item => {
    if (!item.anchor) return [{ ...item }];
    const old = previousById.get(item.anchor.clipId);
    if (!old) return [];
    const targets = main.filter(clip => clip.id === old.id || origins.get(clip.id) === old.id && !previousById.has(clip.id));
    return targets.flatMap(clip => {
      if (clip.id === old.id) return [{ ...item, anchor: { ...item.anchor! } }];
      const sourceBased = item.anchor!.sourceStartTicks !== undefined;
      const sourceStart = sourceBased ? item.anchor!.sourceStartTicks! : old.sourceStartTicks + (item.anchor!.offsetTicks ?? 0);
      const sourceEnd = sourceBased ? item.anchor!.sourceEndTicks! : sourceStart + item.durationTicks;
      const image = byAsset.get(old.assetId)?.kind === 'image';
      const start = image ? sourceStart : Math.max(sourceStart, clip.sourceStartTicks);
      const end = image ? Math.min(sourceEnd, mainDuration(clip, byAsset.get(clip.assetId))) : Math.min(sourceEnd, clip.sourceEndTicks);
      if (end <= start) return [];
      const media = item.assetId ? byAsset.get(item.assetId) : undefined;
      const shiftedSource = media && media.kind !== 'image' ? (item.sourceStartTicks ?? 0) + start - sourceStart : undefined;
      return [{ ...item, id: `${item.id}~${clip.id}`, durationTicks: end - start,
        ...(shiftedSource !== undefined ? { sourceStartTicks: shiftedSource, sourceEndTicks: shiftedSource + end - start } : {}),
        fadeInTicks: Math.min(item.fadeInTicks ?? 0, end - start),
        fadeOutTicks: Math.min(item.fadeOutTicks ?? 0, Math.max(0, end - start - Math.min(item.fadeInTicks ?? 0, end - start))),
        anchor: sourceBased ? { clipId: clip.id, sourceStartTicks: start, sourceEndTicks: end } : { clipId: clip.id, offsetTicks: start - clip.sourceStartTicks } }];
    });
  }) }));
  return { ...previous, assets, main, layers };
}
export function migrateStudioProject(project: StudioProject): StudioProject {
  if (project.version === 2 && project.editing) return withStudioTakes(project as StudioProject & { editing: StudioEditing });
  if (project.version !== 1 || !Array.isArray(project.takes)) throw new Error('O projeto precisa de recuperação.');
  const oldSignature = legacyTimelineSignature(project);
  const migrated = withStudioTakes({ ...project, version: 2, editing: studioEditing(project) });
  const signature = timelineSignature(migrated);
  if (project.exportedSignature === oldSignature) migrated.exportedSignature = signature;
  if (project.uploadSignature === oldSignature) migrated.uploadSignature = signature;
  return migrated;
}
function baseRecipeClip(id: string, kind: StudioLayerKind, startTicks: number, durationTicks: number): StudioRecipeClip {
  return { id, kind, startTicks, durationTicks, sourceStartTicks: 0, sourceEndTicks: 0, zIndex: 0,
    rect: { x: 0, y: 0, width: 1, height: 1 }, rotationDegrees: 0, fit: 'contain', opacity: 1, gain: 1,
    fadeInTicks: 0, fadeOutTicks: 0, effect: 'natural' };
}
export function compileStudioRecipe(project: Pick<StudioProject, 'kind' | 'takes'> & Partial<StudioProject>): StudioRenderRecipe {
  const editing = studioEditing(project);
  const assets = new Map(editing.assets.map(asset => [asset.id, asset]));
  const mainStarts = new Map<string, { clip: StudioMainClip; start: number; duration: number }>();
  const clips: StudioRecipeClip[] = [];
  let cursor = 0;
  for (const clip of editing.main) {
    const asset = assets.get(clip.assetId);
    if (!asset) throw new Error('Um original da montagem precisa de recuperação.');
    const duration = mainDuration(clip, asset);
    mainStarts.set(clip.id, { clip, start: cursor, duration });
    clips.push({ ...baseRecipeClip(clip.id, asset.kind, cursor, duration), assetId: clip.assetId,
      sourceStartTicks: clip.sourceStartTicks, sourceEndTicks: clip.sourceEndTicks, effect: clip.effect ?? 'natural', grade: clip.grade, gain: clip.gain ?? 1 });
    cursor += duration;
  }
  for (let layerIndex = 0; layerIndex < editing.layers.length; layerIndex++) {
    for (const item of editing.layers[layerIndex].items) {
      let start = item.atTicks, duration = item.durationTicks;
      let sourceStart = item.sourceStartTicks ?? 0;
      let sourceEnd = item.sourceEndTicks ?? (item.assetId && assets.get(item.assetId)?.kind !== 'image' ? sourceStart + duration : 0);
      if (item.anchor) {
        const host = mainStarts.get(item.anchor.clipId);
        if (!host) continue;
        const sourceAnchor = item.anchor.sourceStartTicks !== undefined;
        const offset = sourceAnchor ? item.anchor.sourceStartTicks! - host.clip.sourceStartTicks : item.anchor.offsetTicks ?? 0;
        const anchoredDuration = sourceAnchor ? item.anchor.sourceEndTicks! - item.anchor.sourceStartTicks! : duration;
        const visibleStart = Math.max(0, offset), visibleEnd = Math.min(host.duration, offset + anchoredDuration);
        if (visibleEnd <= visibleStart) continue;
        start = host.start + visibleStart; duration = visibleEnd - visibleStart;
        const excluded = visibleStart - offset;
        if (item.assetId && assets.get(item.assetId)?.kind !== 'image') { sourceStart += excluded; sourceEnd = sourceStart + duration; }
      }
      clips.push({ ...baseRecipeClip(item.id, item.kind, start, duration), assetId: item.assetId,
        sourceStartTicks: sourceStart, sourceEndTicks: sourceEnd, zIndex: layerIndex + 1,
        rect: item.rect ?? { x: 0, y: 0, width: 1, height: 1 }, rotationDegrees: item.rotationDegrees ?? 0, fit: item.fit ?? 'contain',
        opacity: item.opacity ?? 1, gain: item.gain ?? 1, fadeInTicks: Math.min(item.fadeInTicks ?? 0, duration), fadeOutTicks: Math.min(item.fadeOutTicks ?? 0, Math.max(0, duration - Math.min(item.fadeInTicks ?? 0, duration))),
        effect: item.effect ?? 'natural', grade: item.grade, text: item.text });
    }
  }
  const referenced = new Set(clips.map(clip => clip.assetId).filter(Boolean));
  return { version: 2, timebase: STUDIO_TIMEBASE, mediaType: project.kind === 'podcast' ? 'audio' : 'video',
    durationTicks: Math.max(cursor, ...clips.map(clip => clip.startTicks + clip.durationTicks), 0),
    canvas: { ...editing.canvas }, output: { ...editing.output },
    assets: editing.assets.filter(asset => referenced.has(asset.id)).map(asset => ({ ...asset })).sort((a, b) => a.id.localeCompare(b.id)),
    clips: clips.sort((a, b) => a.startTicks - b.startTicks || a.zIndex - b.zIndex || a.id.localeCompare(b.id)) };
}
function isTicks(value: number) { return Number.isSafeInteger(value) && value >= 0; }
const effects: StudioEffect[] = ['natural', 'studio', 'cinematic'];
const studioColor = (value: string) => typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
export function validateStudioRecipe(recipe: StudioRenderRecipe): string[] {
  const issues: string[] = [];
  const push = (message: string) => { if (!issues.includes(message)) issues.push(message); };
  if (recipe.version !== 2 || recipe.timebase !== STUDIO_TIMEBASE || !isTicks(recipe.durationTicks)) push('A versão ou o tempo da montagem não é válido.');
  if (!recipe.canvas || !['landscape', 'portrait', 'square'].includes(recipe.canvas.aspectRatio) || !studioColor(recipe.canvas.backgroundColor)) push('O enquadramento da montagem não é válido.');
  const assets = new Map<string, StudioAsset>();
  for (const asset of recipe.assets) {
    if (!asset.id || assets.has(asset.id) || !['image', 'video', 'audio'].includes(asset.kind) || !asset.uri?.startsWith('file://')
      || typeof asset.name !== 'string' || !isTicks(asset.durationTicks) || (asset.kind === 'image' ? asset.durationTicks !== 0 : asset.durationTicks === 0)
      || [asset.width, asset.height].some(value => value !== undefined && (!Number.isFinite(value) || (asset.kind === 'audio' ? value < 0 : value <= 0)))
      || asset.frameRate !== undefined && (!Number.isFinite(asset.frameRate) || asset.frameRate < 0)
      || asset.sourceKind !== undefined && !['standard', 'cinematic'].includes(asset.sourceKind)
      || asset.sourceStage !== undefined && !['standard', 'cinematicRaw', 'cinematicRendered'].includes(asset.sourceStage)) push('Revise os arquivos originais da montagem.');
    assets.set(asset.id, asset);
    if (asset.sourceStage === 'cinematicRaw') push('Este vídeo cinematográfico precisa ser renderizado antes de editar.');
  }
  const ids = new Set<string>();
  const edges: { tick: number; delta: number }[] = [];
  for (const clip of recipe.clips) {
    if (!clip.id || ids.has(clip.id) || !['video', 'image', 'audio', 'text', 'caption'].includes(clip.kind) || !isTicks(clip.startTicks) || !isTicks(clip.durationTicks) || clip.durationTicks < 1 || !isTicks(clip.startTicks + clip.durationTicks)
      || !isTicks(clip.sourceStartTicks) || !isTicks(clip.sourceEndTicks)) push('Revise os cortes e a identificação da montagem.');
    ids.add(clip.id);
    const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
    if (['video', 'image', 'audio'].includes(clip.kind) && (!asset || asset.kind !== clip.kind)) push('Um original da montagem precisa de recuperação.');
    if (asset && asset.kind !== 'image' && (clip.sourceEndTicks - clip.sourceStartTicks !== clip.durationTicks
      || clip.sourceEndTicks > asset.durationTicks + studioTicks(0.05))) push('Revise os cortes dos takes.');
    if (clip.kind === 'video') { edges.push({ tick: clip.startTicks, delta: 1 }, { tick: clip.startTicks + clip.durationTicks, delta: -1 }); }
    const { rect } = clip;
    if (!rect || ![rect.x, rect.y, rect.width, rect.height, clip.rotationDegrees, clip.opacity, clip.gain].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0 || rect.width > 10 || rect.height > 10 || Math.abs(rect.x) > 10 || Math.abs(rect.y) > 10
      || clip.opacity < 0 || clip.opacity > 1 || clip.gain < 0 || clip.gain > 4 || !['contain', 'cover'].includes(clip.fit)) push('Revise o enquadramento e o volume das camadas.');
    if (!isTicks(clip.fadeInTicks) || !isTicks(clip.fadeOutTicks) || clip.fadeInTicks + clip.fadeOutTicks > clip.durationTicks) push('Revise os fades de áudio.');
    if (!effects.includes(clip.effect)) push('O efeito deste clip não é suportado.');
    if (clip.grade) {
      const grade = clip.grade;
      if (!effects.includes(grade.preset) || ![grade.intensity, grade.exposure, grade.contrast, grade.saturation, grade.temperature].every(Number.isFinite)
        || grade.intensity < 0 || grade.intensity > 1 || Math.abs(grade.exposure) > 2
        || [grade.contrast, grade.saturation, grade.temperature].some(value => Math.abs(value) > 1)) push('Revise os ajustes de cor do clip.');
    }
    if (['text', 'caption'].includes(clip.kind) && (!clip.text || !clip.text.content.trim() || !Number.isFinite(clip.text.fontSize)
      || clip.text.fontSize <= 0 || clip.text.fontSize > 1 || typeof clip.text.fontFamily !== 'string' || !clip.text.fontFamily.trim()
      || !studioColor(clip.text.color) || !studioColor(clip.text.backgroundColor) || !['left', 'center', 'right'].includes(clip.text.alignment))) push('Revise os textos e as legendas.');
  }
  let streams = 0;
  for (const edge of edges.sort((a, b) => a.tick - b.tick || a.delta - b.delta)) { streams += edge.delta; if (streams > 2) push('A montagem pode usar até dois vídeos ao mesmo tempo.'); }
  const output = recipe.output;
  if (!output || !['standard', 'legacy-source'].includes(output.profile) || !Number.isFinite(output.width) || !Number.isFinite(output.height)
    || output.width <= 0 || output.height <= 0 || !Number.isSafeInteger(output.frameRateNumerator) || output.frameRateNumerator <= 0
    || !Number.isSafeInteger(output.frameRateDenominator) || output.frameRateDenominator <= 0) push('O perfil de exportação não é válido.');
  if (output?.profile === 'standard' && (!(output.width === 1920 && output.height === 1080 || output.width === 1080 && output.height === 1920 || output.width === 1080 && output.height === 1080)
    || output.frameRateNumerator !== 30 || output.frameRateDenominator !== 1 || output.colorSpace !== 'rec709')) push('Esta versão prepara a montagem em 1080p, 30 fps e SDR.');
  return issues;
}
export function validateStudioEditing(editing: StudioEditing, kind: StudioKind): string[] {
  const issues: string[] = [];
  if (editing.version !== 2 || editing.timebase !== STUDIO_TIMEBASE) issues.push('A edição precisa de recuperação.');
  const assetIds = editing.assets.map(asset => asset.id), clipIds = editing.main.map(clip => clip.id), layerIds = editing.layers.map(layer => layer.id);
  const allItemIds = [...clipIds, ...editing.layers.flatMap(layer => layer.items.map(item => item.id))];
  if (new Set(allItemIds).size !== allItemIds.length || allItemIds.some(id => !id)
    || new Set(assetIds).size !== assetIds.length || new Set(layerIds).size !== layerIds.length || layerIds.some(id => !id)) issues.push('A identificação da edição precisa de recuperação.');
  const assets = new Map(editing.assets.map(asset => [asset.id, asset]));
  for (const clip of editing.main) {
    const asset = assets.get(clip.assetId);
    if (!asset || !isTicks(clip.sourceStartTicks) || !isTicks(clip.sourceEndTicks) || mainDuration(clip, asset) < STUDIO_TIMEBASE / 10
      || asset.kind === 'image' && (clip.sourceStartTicks !== 0 || clip.sourceEndTicks !== 0 || !isTicks(clip.durationTicks!))) issues.push('Revise os cortes dos takes.');
  }
  const originals: StudioRecipeClip[] = [];
  for (const layer of editing.layers) for (const item of layer.items) {
    const anchor = item.anchor;
    const sourceAnchor = anchor?.sourceStartTicks !== undefined || anchor?.sourceEndTicks !== undefined;
    const invalidAnchor = !!anchor && (!clipIds.includes(anchor.clipId)
      || anchor.offsetTicks !== undefined && !isTicks(anchor.offsetTicks)
      || sourceAnchor && (!isTicks(anchor.sourceStartTicks!) || !isTicks(anchor.sourceEndTicks!) || anchor.sourceEndTicks! <= anchor.sourceStartTicks! || anchor.offsetTicks !== undefined));
    if (item.kind !== layer.kind || !['video', 'image', 'audio', 'text', 'caption'].includes(item.kind)
      || !isTicks(item.atTicks) || !isTicks(item.durationTicks) || item.durationTicks < 1 || invalidAnchor) issues.push('Revise os vínculos das camadas.');
    // Validate the stored element too: a trim can hide it entirely in the render
    // recipe, but hidden invalid data must never become valid merely by saving.
    const sourceStart = item.sourceStartTicks ?? 0;
    const sourceEnd = item.sourceEndTicks ?? (item.assetId && assets.get(item.assetId)?.kind !== 'image' ? sourceStart + item.durationTicks : 0);
    originals.push({ ...baseRecipeClip(item.id, item.kind, item.atTicks, item.durationTicks), assetId: item.assetId,
      sourceStartTicks: sourceStart, sourceEndTicks: sourceEnd, rect: item.rect ?? { x: 0, y: 0, width: 1, height: 1 },
      rotationDegrees: item.rotationDegrees ?? 0, fit: item.fit ?? 'contain', opacity: item.opacity ?? 1, gain: item.gain ?? 1,
      fadeInTicks: item.fadeInTicks ?? 0, fadeOutTicks: item.fadeOutTicks ?? 0, effect: item.effect ?? 'natural', grade: item.grade, text: item.text });
  }
  try {
    const recipe = compileStudioRecipe({ kind, takes: [], editing });
    issues.push(...validateStudioRecipe(recipe));
    const storedIssues = validateStudioRecipe({ ...recipe, assets: editing.assets, clips: originals });
    // Anchored elements use source times until compilation. Their actual decoder
    // overlap is checked above after resolving all links, not on raw offsets.
    issues.push(...storedIssues.filter(issue => issue !== 'A montagem pode usar até dois vídeos ao mesmo tempo.'));
  } catch { issues.push('Um original da montagem precisa de recuperação.'); }
  return [...new Set(issues)];
}
export function withStudioStandardOutput(editing: StudioEditing): StudioEditing {
  const portrait = editing.canvas.aspectRatio === 'portrait', square = editing.canvas.aspectRatio === 'square';
  return { ...editing, output: { profile: 'standard', width: portrait || square ? 1080 : 1920, height: portrait ? 1920 : 1080,
    frameRateNumerator: 30, frameRateDenominator: 1, colorSpace: 'rec709' } };
}
export function createStudioTextItem(options: { id: string; content?: string; atTicks?: number; durationTicks?: number; clipId?: string; kind?: 'text' | 'caption' }): StudioLayerItem {
  return { id: options.id, kind: options.kind ?? 'text', atTicks: options.atTicks ?? 0, durationTicks: options.durationTicks ?? studioTicks(3),
    ...(options.clipId ? { anchor: { clipId: options.clipId, offsetTicks: 0 } } : {}),
    rect: { x: 0.08, y: 0.72, width: 0.84, height: 0.2 },
    text: { content: options.content ?? 'Seu título', fontFamily: 'System', fontSize: 0.06, color: '#FFFFFF', backgroundColor: '#00000000', alignment: 'center' } };
}
export function addStudioLayerItem(editing: StudioEditing, item: StudioLayerItem, layerId = `layer:${item.kind}`): StudioEditing {
  if (editing.main.some(clip => clip.id === item.id) || editing.layers.some(layer => layer.items.some(existing => existing.id === item.id))) throw new Error('A camada precisa de uma identificação nova.');
  const existing = editing.layers.find(layer => layer.id === layerId);
  if (existing && existing.kind !== item.kind) throw new Error('O tipo desta camada não é compatível.');
  return { ...editing, layers: existing ? editing.layers.map(layer => layer.id === layerId ? { ...layer, items: [...layer.items, { ...item }] } : layer)
    : [...editing.layers, { id: layerId, kind: item.kind, items: [{ ...item }] }] };
}
export type StudioLayerPatch = Partial<Omit<StudioLayerItem, 'text' | 'rect'>> & { text?: Partial<StudioTextStyle>; rect?: Partial<StudioRect> };
export function patchStudioLayerItem(editing: StudioEditing, id: string, patch: StudioLayerPatch): StudioEditing {
  let found = false;
  const layers = editing.layers.map(layer => ({ ...layer, items: layer.items.map(item => {
    if (item.id !== id) return item;
    const { rect, text, ...rest } = patch;
    found = true; return { ...item, ...rest, id: item.id, kind: item.kind,
      ...(rect ? { rect: { ...(item.rect ?? { x: 0, y: 0, width: 1, height: 1 }), ...rect } } : {}),
      ...(text ? { text: { ...(item.text ?? createStudioTextItem({ id }).text!), ...text } } : {}) };
  }) }));
  if (!found) throw new Error('Este elemento não está mais na montagem.');
  return { ...editing, layers };
}
export function removeStudioLayerItem(editing: StudioEditing, id: string): StudioEditing {
  if (!editing.layers.some(layer => layer.items.some(item => item.id === id))) throw new Error('Este elemento não está mais na montagem.');
  return { ...editing, layers: editing.layers.map(layer => ({ ...layer, items: layer.items.filter(item => item.id !== id) })) };
}
export function patchStudioClipGrade(editing: StudioEditing, id: string, patch: Partial<StudioGrade>): StudioEditing {
  const clip = editing.main.find(item => item.id === id);
  if (clip) return { ...editing, main: editing.main.map(item => item.id === id ? { ...item, grade: { ...studioGrade(item.effect), ...item.grade, ...patch } } : item) };
  const item = editing.layers.flatMap(layer => layer.items).find(item => item.id === id);
  if (!item) throw new Error('Este clip não está mais na montagem.');
  return patchStudioLayerItem(editing, id, { grade: { ...studioGrade(item.effect), ...item.grade, ...patch } });
}

/** A pending destination is recovery data, never a command to reinterpret a layer as main media. */
export function validateStudioPendingTakes(pending: StudioProject['pendingTakes']): string[] {
  if (pending === undefined) return [];
  if (!Array.isArray(pending)) return ['O registro de arquivos pendentes precisa de recuperação.'];
  const ids = new Set<string>();
  for (const entry of pending) {
    if (!entry || !entry.id || ids.has(entry.id) || !entry.uri?.startsWith('file://') || typeof entry.name !== 'string') return ['O registro de arquivos pendentes precisa de recuperação.'];
    ids.add(entry.id);
    if (entry.layerId !== undefined && (typeof entry.layerId !== 'string' || !entry.layerId)) return ['O destino da camada pendente precisa de recuperação.'];
    if (entry.layerItem) {
      const item = entry.layerItem;
      if (!item.id || !['video', 'image', 'audio'].includes(item.kind) || item.assetId !== entry.id
        || entry.kind !== undefined && entry.kind !== item.kind || !isTicks(item.atTicks) || !isTicks(item.durationTicks)
        || [item.sourceStartTicks, item.sourceEndTicks, item.fadeInTicks, item.fadeOutTicks].some(value => value !== undefined && !isTicks(value))
        || item.anchor && (!item.anchor.clipId || item.anchor.offsetTicks !== undefined && !isTicks(item.anchor.offsetTicks)
          || item.anchor.sourceStartTicks !== undefined && (!isTicks(item.anchor.sourceStartTicks) || !isTicks(item.anchor.sourceEndTicks!)))
        || [item.opacity, item.gain, item.rotationDegrees].some(value => value !== undefined && !Number.isFinite(value))
        || item.rect && (![item.rect.x, item.rect.y, item.rect.width, item.rect.height].every(Number.isFinite) || item.rect.width <= 0 || item.rect.height <= 0)) return ['O destino da camada pendente precisa de recuperação.'];
    }
  }
  return [];
}
