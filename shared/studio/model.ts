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
  /** Reversible clip treatment; the original asset always remains unprocessed. */
  grade?: StudioGrade;
  enhancement?: StudioEnhancement; portrait?: StudioPortrait; signature?: StudioSignature;
  playbackRate?: number;
  flipHorizontal?: boolean; flipVertical?: boolean;
  gain?: number; opacity?: number; fadeInTicks?: number; fadeOutTicks?: number;
  motion?: StudioClipMotion; motionOffsetTicks?: number; motionDurationTicks?: number;
  hasAudio?: boolean;
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
  pendingTakes?: StudioPendingTake[];
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
  return takes.reduce((sum, take) => sum + studioTakeDuration(take), 0);
}
export function studioTakeDuration(take: Pick<StudioTake, 'start' | 'end' | 'playbackRate'>) {
  return studioSeconds(Math.round(studioTicks(Math.max(0, take.end - take.start)) / studioPlaybackRate(take.playbackRate)));
}
// Project schema and renderer are independent. Legacy artifacts are adopted only
// when their old signature proves the unchanged sequential render.
export const STUDIO_RENDER_VERSION = 6;
export function timelineSignature(project: Pick<StudioProject, 'kind' | 'takes'> & Partial<StudioProject>) {
  if (!project.editing && !project.takes.some(take => normalizeStudioCaptureGrade(take.grade)
    || (take.enhancement?.strength ?? 0) > 0 || (take.portrait?.strength ?? 0) > 0 || (take.signature?.strength ?? 0) > 0
    || (take.playbackRate ?? 1) !== 1 || take.flipHorizontal || take.flipVertical || (take.gain ?? 1) !== 1
    || (take.opacity ?? 1) !== 1 || take.fadeInTicks || take.fadeOutTicks || take.motion && take.motion !== 'none')) return legacyTimelineSignature(project);
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
  if (project.takes.some(t => !Number.isFinite(t.duration) || !Number.isFinite(t.start) || !Number.isFinite(t.end) || t.start < 0 || t.end > t.duration + 0.05
    || !validStudioPlaybackRate(t.playbackRate) || (t.end - t.start) / (t.playbackRate ?? 1) < 0.1 - 1e-6)) issues.push('Revise os cortes dos takes.');
  let duration = project.takes.reduce((sum, take) => sum + Math.max(0, take.end - take.start) / (validStudioPlaybackRate(take.playbackRate) ? take.playbackRate ?? 1 : 1), 0);
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
/** Reversible, bounded analysis result. No image, face landmarks or external service state is persisted. */
export type StudioEnhancement = { version: 1; strength: number; exposure: number; contrast: number; saturation: number;
  temperature: number; tint: number; shadows: number; highlights: number; analyzedFrames: number };
export type StudioPortrait = { version: 1 | 2; strength: number };
/** Person/background treatment. Geometry and segmentation masks remain transient in the renderer. */
export type StudioSignature = { version: 1; strength: number; subjectExposure: number; backgroundExposure: number;
  backgroundBlur: number; temperature: number };
export type StudioRenderFeature = 'enhancement-v1' | 'portrait-v1' | 'portrait-v2' | 'cinematic-signature-v1';
export type StudioPendingTake = {
  id: string; uri: string; name: string; sourceUri?: string; kind?: StudioAssetKind;
  sourceKind?: 'standard' | 'cinematic'; sourceStage?: StudioSourceStage; frameRate?: number; colorSpace?: string;
  /** Captured recipe snapshot, persisted before metadata work for recovery. */
  grade?: StudioGrade;
  layerItem?: StudioLayerItem; layerId?: string;
  /** Visual dimensions already read by the picker; recovery can avoid decoding twice. */
  imageSize?: { width: number; height: number };
};
export type StudioRect = { x: number; y: number; width: number; height: number };
export type StudioTextDecoration = 'none' | 'outline' | 'outline-inverse' | 'background' | 'background-inverse';
export type StudioTextVisualEffect = 'none' | 'shadow-soft' | 'shadow-strong' | 'block' | 'neon' | 'glow' | 'halo';
export type StudioTextAnimation = 'none' | 'typewriter' | 'pop' | 'bounce' | 'fade' | 'zoom' | 'slide-right';
export type StudioClipMotion = 'none' | 'fade-in' | 'fade-out' | 'zoom-in' | 'pulse' | 'blink';
export type StudioTextStyle = { content: string; fontFamily: string; fontSize: number; color: string; backgroundColor: string; alignment: 'left' | 'center' | 'right';
  decoration?: StudioTextDecoration; visualEffect?: StudioTextVisualEffect; animation?: StudioTextAnimation;
  secondaryColor?: string; gradientColors?: [string, string]; animationDurationTicks?: number };
export type StudioAsset = {
  id: string; kind: StudioAssetKind; uri: string; name: string; durationTicks: number;
  width?: number; height?: number; frameRate?: number; thumbnailUri?: string;
  sourceKind?: 'standard' | 'cinematic'; sourceStage?: StudioSourceStage; colorSpace?: string;
  hasAudio?: boolean;
};
export type StudioMainClip = {
  id: string; assetId: string; name?: string; sourceStartTicks: number; sourceEndTicks: number;
  /** Still image hold; temporal originals derive duration from their source range. */
  durationTicks?: number; effect?: StudioEffect; grade?: StudioGrade; gain?: number;
  enhancement?: StudioEnhancement; portrait?: StudioPortrait; signature?: StudioSignature;
  /** Reversible framing of the original within the lesson canvas. */
  rect?: StudioRect; fit?: 'contain' | 'cover'; rotationDegrees?: number;
  playbackRate?: number; flipHorizontal?: boolean; flipVertical?: boolean; opacity?: number;
  fadeInTicks?: number; fadeOutTicks?: number; motion?: StudioClipMotion;
  motionOffsetTicks?: number; motionDurationTicks?: number;
};
export type StudioLayerKind = StudioAssetKind | 'text' | 'caption';
export type StudioLayerAnchor = { clipId: string; offsetTicks?: number; sourceStartTicks?: number; sourceEndTicks?: number };
export type StudioLayerItem = {
  id: string; kind: StudioLayerKind; assetId?: string; atTicks: number; durationTicks: number;
  sourceStartTicks?: number; sourceEndTicks?: number; anchor?: StudioLayerAnchor;
  rect?: StudioRect; rotationDegrees?: number; fit?: 'contain' | 'cover'; opacity?: number;
  gain?: number; fadeInTicks?: number; fadeOutTicks?: number; effect?: StudioEffect; grade?: StudioGrade; text?: StudioTextStyle;
  enhancement?: StudioEnhancement; portrait?: StudioPortrait; signature?: StudioSignature;
  playbackRate?: number; flipHorizontal?: boolean; flipVertical?: boolean; motion?: StudioClipMotion;
  /** Elapsed animation/motion time before the visible range; never a source time. */
  animationOffsetTicks?: number; motionOffsetTicks?: number; motionDurationTicks?: number;
};
export type StudioLayer = {
  id: string; kind: StudioLayerKind; items: StudioLayerItem[];
  /** Reversible track switches; source opacity and gain stay on each item. */
  hidden?: boolean; muted?: boolean;
};
export type StudioOutputSelection = { resolution: 'original' | '720p' | 'hd' | '2k' | '4k'; frameRate: 'original' | 24 | 30 | 60 };
export type StudioOutputWarning = { code: 'upscale' | 'downscale' | 'fps-conversion' | 'sdr-conversion' | 'unknown-source'; message: string; assetIds: string[] };
/** Structural bridge contract; old binaries expose only their proven 1080p30 profile. */
export type StudioOutputCapabilities = {
  version: number; available: boolean; colorSpace: 'rec709'; minimumDimension: number; maximumDimension: number; maximumShortDimension: number; maximumPixels: number; arbitraryEvenDimensions: boolean;
  resolutions: readonly { id: '720p' | 'hd' | '2k' | '4k'; width: number; height: number; codec: 'h264' | 'hevc' }[];
  frameRates: readonly { numerator: number; denominator: number }[]; supportsHEVC: boolean;
};
export type StudioOutputProfile = {
  profile: 'standard' | 'legacy-source'; width: number; height: number;
  frameRateNumerator: number; frameRateDenominator: number; colorSpace: 'rec709' | 'source';
  /** Absent on existing documents: their effective output remains unchanged. */
  selection?: StudioOutputSelection;
};
export type StudioEditing = {
  version: 2; timebase: typeof STUDIO_TIMEBASE; assets: StudioAsset[]; main: StudioMainClip[]; layers: StudioLayer[];
  canvas: { aspectRatio: 'landscape' | 'portrait' | 'square'; backgroundColor: string }; output: StudioOutputProfile;
  /** Mute the complete main sequence without replacing clip gains. */
  mainMuted?: boolean;
};
export type StudioRecipeClip = {
  id: string; kind: StudioLayerKind; assetId?: string; startTicks: number; durationTicks: number;
  sourceStartTicks: number; sourceEndTicks: number; zIndex: number; rect: StudioRect;
  rotationDegrees: number; fit: 'contain' | 'cover'; opacity: number; gain: number;
  fadeInTicks: number; fadeOutTicks: number; effect: StudioEffect; grade?: StudioGrade; text?: StudioTextStyle;
  enhancement?: StudioEnhancement; portrait?: StudioPortrait; signature?: StudioSignature;
  playbackRate?: number; flipHorizontal?: boolean; flipVertical?: boolean; motion?: StudioClipMotion;
  animationOffsetTicks?: number; motionOffsetTicks?: number; motionDurationTicks?: number;
};
export type StudioRenderRecipe = {
  /** Version 3 is required only for active magic effects; old native renderers reject it instead of ignoring an effect. */
  version: 2 | 3; timebase: typeof STUDIO_TIMEBASE; durationTicks: number; mediaType: 'video' | 'audio';
  requiredFeatures?: StudioRenderFeature[];
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
export function validateStudioGrade(value: unknown): string[] {
  const grade = value as StudioGrade | null | undefined;
  if (!grade || !['natural', 'studio', 'cinematic'].includes(grade.preset)
    || ![grade.intensity, grade.exposure, grade.contrast, grade.saturation, grade.temperature].every(Number.isFinite)
    || grade.intensity < 0 || grade.intensity > 1 || Math.abs(grade.exposure) > 2
    || [grade.contrast, grade.saturation, grade.temperature].some(value => Math.abs(value) > 1)) return ['Revise os ajustes de cor do clip.'];
  return [];
}
const enhancementKeys = ['version', 'strength', 'exposure', 'contrast', 'saturation', 'temperature', 'tint', 'shadows', 'highlights', 'analyzedFrames'];
export function validateStudioEnhancement(value: unknown): string[] {
  const enhancement = value as StudioEnhancement | null | undefined;
  if (!enhancement || typeof enhancement !== 'object' || Array.isArray(enhancement)
    || Object.keys(enhancement).some(key => !enhancementKeys.includes(key)) || enhancement.version !== 1
    || ![enhancement.strength, enhancement.exposure, enhancement.contrast, enhancement.saturation, enhancement.temperature,
      enhancement.tint, enhancement.shadows, enhancement.highlights].every(Number.isFinite)
    || enhancement.strength < 0 || enhancement.strength > 1 || Math.abs(enhancement.exposure) > 2
    || [enhancement.contrast, enhancement.saturation, enhancement.temperature, enhancement.tint, enhancement.shadows, enhancement.highlights].some(number => Math.abs(number) > 1)
    || !Number.isSafeInteger(enhancement.analyzedFrames) || enhancement.analyzedFrames < 1 || enhancement.analyzedFrames > 24) return ['Revise a melhoria automática do clip.'];
  return [];
}
export function validateStudioPortrait(value: unknown): string[] {
  const portrait = value as StudioPortrait | null | undefined;
  if (!portrait || typeof portrait !== 'object' || Array.isArray(portrait)
    || Object.keys(portrait).some(key => !['version', 'strength'].includes(key)) || ![1, 2].includes(portrait.version)
    || !Number.isFinite(portrait.strength) || portrait.strength < 0 || portrait.strength > 1) return ['Revise o retoque facial do clip.'];
  return [];
}
export function validateStudioSignature(value: unknown): string[] {
  const signature = value as StudioSignature | null | undefined;
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)
    || Object.keys(signature).some(key => !['version', 'strength', 'subjectExposure', 'backgroundExposure', 'backgroundBlur', 'temperature'].includes(key))
    || signature.version !== 1
    || ![signature.strength, signature.subjectExposure, signature.backgroundExposure, signature.backgroundBlur, signature.temperature].every(Number.isFinite)
    || signature.strength < 0 || signature.strength > 1 || signature.subjectExposure < -.5 || signature.subjectExposure > 1
    || signature.backgroundExposure < -2 || signature.backgroundExposure > 0 || signature.backgroundBlur < 0 || signature.backgroundBlur > 1
    || Math.abs(signature.temperature) > 1) return ['Revise a assinatura cinematográfica do clip.'];
  return [];
}
type StudioVisualTreatment = Pick<Partial<StudioMainClip>, 'enhancement' | 'portrait' | 'signature'>;
function studioTreatmentProperties(clip: StudioVisualTreatment): StudioVisualTreatment {
  return { ...(clip.enhancement !== undefined ? { enhancement: { ...clip.enhancement } } : {}),
    ...(clip.portrait !== undefined ? { portrait: { ...clip.portrait } } : {}),
    ...(clip.signature !== undefined ? { signature: { ...clip.signature } } : {}) };
}
/** Ordered requirements derive from active fields, never from user-supplied capability declarations. */
export function studioRequiredFeatures(value: StudioEditing | Pick<StudioRenderRecipe, 'clips'>): StudioRenderFeature[] {
  const clips = 'clips' in value ? value.clips : [...value.main, ...value.layers.flatMap(layer => layer.items)];
  return [...(clips.some(clip => (clip.enhancement?.strength ?? 0) > 0) ? ['enhancement-v1' as const] : []),
    ...(clips.some(clip => clip.portrait?.version === 1 && clip.portrait.strength > 0) ? ['portrait-v1' as const] : []),
    ...(clips.some(clip => clip.portrait?.version === 2 && clip.portrait.strength > 0) ? ['portrait-v2' as const] : []),
    ...(clips.some(clip => (clip.signature?.strength ?? 0) > 0) ? ['cinematic-signature-v1' as const] : [])];
}
/** Call before handing a recipe to a platform renderer; missing support may never produce an untreated export. */
export function assertStudioRenderFeatures(recipe: StudioRenderRecipe, supported: readonly StudioRenderFeature[]): void {
  const issues = validateStudioRecipe(recipe);
  if (issues.length) throw new Error(issues[0]);
  if (studioRequiredFeatures(recipe).some(feature => !supported.includes(feature))) throw new Error('Este renderizador não oferece os efeitos desta montagem. Atualize o app ou remova os efeitos antes de exportar.');
}
/** Capture identity needs no recipe and must remain usable by legacy binaries. */
export function normalizeStudioCaptureGrade(value?: StudioGrade): StudioGrade | undefined {
  if (value === undefined) return undefined;
  const issues = validateStudioGrade(value);
  if (issues.length) throw new Error(issues[0]);
  const { preset, intensity, exposure, contrast, saturation, temperature } = value;
  if (preset === 'natural' && exposure === 0 && contrast === 0 && saturation === 0 && temperature === 0) return undefined;
  return { preset, intensity, exposure, contrast, saturation, temperature };
}
export function emptyStudioEditing(kind: StudioKind, legacy = false): StudioEditing {
  const portrait = kind === 'short';
  return { version: 2, timebase: STUDIO_TIMEBASE, assets: [], main: [], layers: [],
    canvas: { aspectRatio: portrait ? 'portrait' : 'landscape', backgroundColor: '#000000' },
    output: { profile: legacy ? 'legacy-source' : 'standard', width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080,
      frameRateNumerator: 30, frameRateDenominator: 1, colorSpace: legacy ? 'source' : 'rec709',
      ...(!legacy ? { selection: { resolution: 'original' as const, frameRate: 'original' as const } } : {}) } };
}
/** The path of an immutable original identifies it locally, independently of the iOS container. */
function stableStudioPath(uri: string) {
  const at = uri.indexOf('/classfy-studio/');
  return at >= 0 ? uri.slice(at) : uri;
}
function sourceIdentity(take: StudioTake) { return stableStudioPath(take.uri); }
export function validStudioPlaybackRate(value?: number) { return value === undefined || Number.isFinite(value) && value >= 0.25 && value <= 4; }
export function studioPlaybackRate(value?: number) {
  if (!validStudioPlaybackRate(value)) throw new Error('Escolha uma velocidade entre 0,25× e 4×.');
  return value ?? 1;
}
export function studioClipDurationTicks(clip: Pick<Partial<StudioMainClip>, 'sourceStartTicks' | 'sourceEndTicks' | 'durationTicks' | 'playbackRate'> & { kind?: StudioLayerKind }, asset?: StudioAsset) {
  if (asset?.kind === 'image' || clip.kind === 'image' || clip.kind === 'text' || clip.kind === 'caption') return clip.durationTicks ?? 0;
  const rate = studioPlaybackRate(clip.playbackRate), start = clip.sourceStartTicks ?? 0;
  return Math.round(((clip.sourceEndTicks ?? start + Math.round((clip.durationTicks ?? 0) * rate)) - start) / rate);
}
const mainDuration = studioClipDurationTicks;
const studioPropertyKeys = ['playbackRate', 'flipHorizontal', 'flipVertical', 'gain', 'opacity', 'fadeInTicks', 'fadeOutTicks',
  'motion', 'motionOffsetTicks', 'motionDurationTicks'] as const;
function studioClipProperties(clip: Partial<StudioMainClip>) {
  const result: Partial<StudioMainClip> = {};
  for (const key of studioPropertyKeys) if (clip[key] !== undefined) Object.assign(result, { [key]: clip[key] });
  return result;
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
      sourceKind: asset.sourceKind, sourceStage: asset.sourceStage, frameRate: asset.frameRate, colorSpace: asset.colorSpace,
      grade: clip.grade ? { ...clip.grade } : undefined, hasAudio: asset.hasAudio,
      ...studioTreatmentProperties(clip),
      ...studioClipProperties(clip) };
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
        thumbnailUri: take.thumbnailUri, frameRate: take.frameRate, sourceKind: take.sourceKind, sourceStage: take.sourceStage, colorSpace: take.colorSpace,
        ...(take.hasAudio !== undefined ? { hasAudio: take.hasAudio } : {}) };
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
    // Existing canonical clips retain their edits. A newly captured clip may
    // obtain its recipe from the journal if an older caller omitted the adapter
    // field; neither path writes treatment into the immutable original asset.
    const pending = !sameClip ? project.pendingTakes?.find(item => !item.layerItem && item.id === take.id && item.uri === take.uri) : undefined;
    const grade = !sameClip ? normalizeStudioCaptureGrade(pending?.grade ?? take.grade) : undefined;
    const properties = studioClipProperties(take);
    const excluded = origin ? Math.round((start - origin.sourceStartTicks) / studioPlaybackRate(origin.playbackRate)) : 0;
    const duration = asset.kind === 'image' ? studioTicks(take.end - take.start) : Math.round((end - start) / studioPlaybackRate(take.playbackRate ?? origin?.playbackRate));
    return { ...(origin ?? {}), ...properties, ...studioTreatmentProperties(take), id: take.id, assetId: asset.id, name: take.name,
      ...(grade ? { grade } : {}),
      ...(origin?.motion && origin.motion !== 'none' ? { motionOffsetTicks: properties.motionOffsetTicks !== undefined && properties.motionOffsetTicks !== origin.motionOffsetTicks
        ? properties.motionOffsetTicks : Math.max(0, (origin.motionOffsetTicks ?? 0) + excluded),
        motionDurationTicks: properties.motionDurationTicks ?? origin.motionDurationTicks ?? mainDuration(origin, asset) } : {}),
      ...(origin?.fadeInTicks !== undefined || take.fadeInTicks !== undefined ? { fadeInTicks: Math.min(properties.fadeInTicks ?? origin?.fadeInTicks ?? 0, duration) } : {}),
      ...(origin?.fadeOutTicks !== undefined || take.fadeOutTicks !== undefined ? { fadeOutTicks: Math.min(properties.fadeOutTicks ?? origin?.fadeOutTicks ?? 0,
        Math.max(0, duration - Math.min(properties.fadeInTicks ?? origin?.fadeInTicks ?? 0, duration))) } : {}),
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
      const oldRate = studioPlaybackRate(old.playbackRate), rate = studioPlaybackRate(clip.playbackRate);
      const sourceStart = sourceBased ? item.anchor!.sourceStartTicks! : old.sourceStartTicks + Math.round((item.anchor!.offsetTicks ?? 0) * oldRate);
      const sourceEnd = sourceBased ? item.anchor!.sourceEndTicks! : sourceStart + Math.round(item.durationTicks * oldRate);
      const image = byAsset.get(old.assetId)?.kind === 'image';
      const start = image ? sourceStart : Math.max(sourceStart, clip.sourceStartTicks);
      const end = image ? Math.min(sourceEnd, mainDuration(clip, byAsset.get(clip.assetId))) : Math.min(sourceEnd, clip.sourceEndTicks);
      if (end <= start) return [];
      const media = item.assetId ? byAsset.get(item.assetId) : undefined;
      const duration = Math.round((end - start) / rate), excluded = Math.round((start - sourceStart) / oldRate), itemRate = studioPlaybackRate(item.playbackRate);
      const shiftedSource = media && media.kind !== 'image' ? (item.sourceStartTicks ?? 0) + Math.round(excluded * itemRate) : undefined;
      return [{ ...item, ...studioTreatmentProperties(item), id: `${item.id}~${clip.id}`, durationTicks: duration,
        ...(shiftedSource !== undefined ? { sourceStartTicks: shiftedSource, sourceEndTicks: shiftedSource + Math.round(duration * itemRate) } : {}),
        ...(item.text?.animation && item.text.animation !== 'none' ? { animationOffsetTicks: (item.animationOffsetTicks ?? 0) + excluded } : {}),
        ...(item.motion && item.motion !== 'none' ? { motionOffsetTicks: (item.motionOffsetTicks ?? 0) + excluded,
          motionDurationTicks: item.motionDurationTicks ?? item.durationTicks } : {}),
        fadeInTicks: Math.min(item.fadeInTicks ?? 0, duration),
        fadeOutTicks: Math.min(item.fadeOutTicks ?? 0, Math.max(0, duration - Math.min(item.fadeInTicks ?? 0, duration))),
        anchor: sourceBased ? { clipId: clip.id, sourceStartTicks: start, sourceEndTicks: end }
          : { clipId: clip.id, offsetTicks: Math.round((start - clip.sourceStartTicks) / rate) } }];
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
  // Sequential legacy signatures never described a capture treatment. Do not
  // certify an untreated artifact as a render of the newly restored recipe.
  const treatment = migrated.editing!.main.some(clip => clip.grade || (clip.gain ?? 1) !== 1) || requiresStudioEditorTools(migrated.editing!);
  if (!treatment && project.exportedSignature === oldSignature) migrated.exportedSignature = signature;
  if (!treatment && project.uploadSignature === oldSignature) migrated.uploadSignature = signature;
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
      sourceStartTicks: clip.sourceStartTicks, sourceEndTicks: clip.sourceEndTicks, effect: clip.effect ?? 'natural', grade: clip.grade,
      ...studioTreatmentProperties(clip),
      rect: clip.rect ?? { x: 0, y: 0, width: 1, height: 1 }, fit: clip.fit ?? 'contain', rotationDegrees: clip.rotationDegrees ?? 0,
      ...studioClipProperties(clip), gain: editing.mainMuted === true ? 0 : clip.gain ?? 1, opacity: clip.opacity ?? 1,
      fadeInTicks: Math.min(clip.fadeInTicks ?? 0, duration), fadeOutTicks: Math.min(clip.fadeOutTicks ?? 0, Math.max(0, duration - Math.min(clip.fadeInTicks ?? 0, duration))) });
    cursor += duration;
  }
  for (let layerIndex = 0; layerIndex < editing.layers.length; layerIndex++) {
    const layer = editing.layers[layerIndex];
    for (const item of layer.items) {
      let start = item.atTicks, duration = item.durationTicks;
      const rate = studioPlaybackRate(item.playbackRate);
      let sourceStart = item.sourceStartTicks ?? 0;
      let sourceEnd = item.sourceEndTicks ?? (item.assetId && assets.get(item.assetId)?.kind !== 'image' ? sourceStart + Math.round(duration * rate) : 0);
      let excluded = 0;
      if (item.anchor) {
        const host = mainStarts.get(item.anchor.clipId);
        if (!host) continue;
        const sourceAnchor = item.anchor.sourceStartTicks !== undefined;
        const hostRate = studioPlaybackRate(host.clip.playbackRate);
        const offset = sourceAnchor ? Math.round((item.anchor.sourceStartTicks! - host.clip.sourceStartTicks) / hostRate) : item.anchor.offsetTicks ?? 0;
        const anchoredDuration = sourceAnchor ? Math.round((item.anchor.sourceEndTicks! - item.anchor.sourceStartTicks!) / hostRate) : duration;
        const visibleStart = Math.max(0, offset), visibleEnd = Math.min(host.duration, offset + anchoredDuration);
        if (visibleEnd <= visibleStart) continue;
        start = host.start + visibleStart; duration = visibleEnd - visibleStart;
        excluded = visibleStart - offset;
        if (item.assetId && assets.get(item.assetId)?.kind !== 'image') {
          sourceStart += Math.round(excluded * rate);
          duration = Math.min(duration, Math.max(0, Math.round((sourceEnd - sourceStart) / rate)));
          if (duration <= 0) continue;
          sourceEnd = sourceStart + Math.round(duration * rate);
        }
      }
      clips.push({ ...baseRecipeClip(item.id, item.kind, start, duration), assetId: item.assetId,
        sourceStartTicks: sourceStart, sourceEndTicks: sourceEnd, zIndex: layerIndex + 1,
        rect: item.rect ?? { x: 0, y: 0, width: 1, height: 1 }, rotationDegrees: item.rotationDegrees ?? 0, fit: item.fit ?? 'contain',
        effect: item.effect ?? 'natural', grade: item.grade, text: item.text,
        ...studioTreatmentProperties(item),
        ...studioClipProperties(item), opacity: layer.hidden === true ? 0 : item.opacity ?? 1, gain: layer.muted === true ? 0 : item.gain ?? 1,
        fadeInTicks: Math.min(item.fadeInTicks ?? 0, duration), fadeOutTicks: Math.min(item.fadeOutTicks ?? 0, Math.max(0, duration - Math.min(item.fadeInTicks ?? 0, duration))),
        ...(item.text?.animation && item.text.animation !== 'none' ? { animationOffsetTicks: (item.animationOffsetTicks ?? 0) + excluded } : {}),
        ...(item.motion && item.motion !== 'none' ? { motionOffsetTicks: (item.motionOffsetTicks ?? 0) + excluded,
          motionDurationTicks: item.motionDurationTicks ?? item.durationTicks } : {}) });
    }
  }
  const referenced = new Set(clips.map(clip => clip.assetId).filter(Boolean));
  const requiredFeatures = studioRequiredFeatures({ clips });
  return { version: requiredFeatures.length ? 3 : 2, ...(requiredFeatures.length ? { requiredFeatures } : {}), timebase: STUDIO_TIMEBASE, mediaType: project.kind === 'podcast' ? 'audio' : 'video',
    durationTicks: Math.max(cursor, ...clips.map(clip => clip.startTicks + clip.durationTicks), 0),
    canvas: { ...editing.canvas }, output: resolveStudioOutput(editing, editing.assets.filter(asset => referenced.has(asset.id))),
    assets: editing.assets.filter(asset => referenced.has(asset.id)).map(asset => ({ ...asset })).sort((a, b) => a.id.localeCompare(b.id)),
    clips: clips.sort((a, b) => a.startTicks - b.startTicks || a.zIndex - b.zIndex || a.id.localeCompare(b.id)) };
}
function isTicks(value: number) { return Number.isSafeInteger(value) && value >= 0; }
const effects: StudioEffect[] = ['natural', 'studio', 'cinematic'];
const textDecorations: StudioTextDecoration[] = ['none', 'outline', 'outline-inverse', 'background', 'background-inverse'];
const textVisualEffects: StudioTextVisualEffect[] = ['none', 'shadow-soft', 'shadow-strong', 'block', 'neon', 'glow', 'halo'];
const textAnimations: StudioTextAnimation[] = ['none', 'typewriter', 'pop', 'bounce', 'fade', 'zoom', 'slide-right'];
const clipMotions: StudioClipMotion[] = ['none', 'fade-in', 'fade-out', 'zoom-in', 'pulse', 'blink'];
const studioColor = (value: string) => typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
export function validateStudioRecipe(recipe: StudioRenderRecipe): string[] {
  const issues: string[] = [];
  const push = (message: string) => { if (!issues.includes(message)) issues.push(message); };
  if (![2, 3].includes(recipe.version) || recipe.timebase !== STUDIO_TIMEBASE || !isTicks(recipe.durationTicks)) push('A versão ou o tempo da montagem não é válido.');
  const requiredFeatures = studioRequiredFeatures(recipe), declared = recipe.requiredFeatures ?? [];
  if (recipe.requiredFeatures !== undefined && !Array.isArray(recipe.requiredFeatures)
    || !Array.isArray(declared) || declared.length !== requiredFeatures.length || requiredFeatures.some(feature => !declared.includes(feature))
    || new Set(declared).size !== declared.length || recipe.version !== (requiredFeatures.length ? 3 : 2)) push('A versão e os recursos de renderização da montagem não correspondem aos efeitos.');
  if (!recipe.canvas || !['landscape', 'portrait', 'square'].includes(recipe.canvas.aspectRatio) || !studioColor(recipe.canvas.backgroundColor)) push('O enquadramento da montagem não é válido.');
  const assets = new Map<string, StudioAsset>();
  for (const asset of recipe.assets) {
    if (!asset.id || assets.has(asset.id) || !['image', 'video', 'audio'].includes(asset.kind) || !asset.uri?.startsWith('file://')
      || typeof asset.name !== 'string' || !isTicks(asset.durationTicks) || (asset.kind === 'image' ? asset.durationTicks !== 0 : asset.durationTicks === 0)
      || [asset.width, asset.height].some(value => value !== undefined && (!Number.isFinite(value) || (asset.kind === 'audio' ? value < 0 : value <= 0)))
      || asset.frameRate !== undefined && (!Number.isFinite(asset.frameRate) || asset.frameRate < 0)
      || asset.sourceKind !== undefined && !['standard', 'cinematic'].includes(asset.sourceKind)
      || asset.hasAudio !== undefined && typeof asset.hasAudio !== 'boolean'
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
    if (['video', 'image', 'audio'].includes(clip.kind) && (!asset || asset.kind !== clip.kind && !(clip.kind === 'audio' && asset.kind === 'video' && asset.hasAudio === true))) push('Um original da montagem precisa de recuperação.');
    if (!validStudioPlaybackRate(clip.playbackRate) || clip.playbackRate !== undefined && !['video', 'audio'].includes(clip.kind)) push('Escolha uma velocidade entre 0,25× e 4× para vídeo ou áudio.');
    if (asset && asset.kind !== 'image' && (!validStudioPlaybackRate(clip.playbackRate) || Math.round((clip.sourceEndTicks - clip.sourceStartTicks) / (clip.playbackRate ?? 1)) !== clip.durationTicks
      || clip.sourceEndTicks > asset.durationTicks + studioTicks(0.05))) push('Revise os cortes dos takes.');
    if (clip.kind === 'video') { edges.push({ tick: clip.startTicks, delta: 1 }, { tick: clip.startTicks + clip.durationTicks, delta: -1 }); }
    const { rect } = clip;
    if (!rect || ![rect.x, rect.y, rect.width, rect.height, clip.rotationDegrees, clip.opacity, clip.gain].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0 || rect.width > 10 || rect.height > 10 || Math.abs(rect.x) > 10 || Math.abs(rect.y) > 10
      || clip.opacity < 0 || clip.opacity > 1 || clip.gain < 0 || clip.gain > 4 || !['contain', 'cover'].includes(clip.fit)) push('Revise o enquadramento e o volume das camadas.');
    if (!isTicks(clip.fadeInTicks) || !isTicks(clip.fadeOutTicks) || clip.fadeInTicks + clip.fadeOutTicks > clip.durationTicks) push('Revise os fades de áudio.');
    if ([clip.flipHorizontal, clip.flipVertical].some(value => value !== undefined && typeof value !== 'boolean')
      || clip.motion !== undefined && !clipMotions.includes(clip.motion)
      || [clip.animationOffsetTicks, clip.motionOffsetTicks].some(value => value !== undefined && !isTicks(value))
      || clip.motionDurationTicks !== undefined && (!isTicks(clip.motionDurationTicks) || clip.motionDurationTicks <= 0)) push('Revise os efeitos e o espelhamento do clip.');
    if (!effects.includes(clip.effect)) push('O efeito deste clip não é suportado.');
    if (clip.grade !== undefined && validateStudioGrade(clip.grade).length) push('Revise os ajustes de cor do clip.');
    if (clip.enhancement !== undefined && validateStudioEnhancement(clip.enhancement).length) push('Revise a melhoria automática do clip.');
    if (clip.portrait !== undefined && validateStudioPortrait(clip.portrait).length) push('Revise o retoque facial do clip.');
    if (clip.signature !== undefined && validateStudioSignature(clip.signature).length) push('Revise a assinatura cinematográfica do clip.');
    if ((clip.enhancement !== undefined || clip.portrait !== undefined || clip.signature !== undefined) && !['video', 'image'].includes(clip.kind)) push('A melhoria, o retoque e a assinatura cinematográfica só podem ser aplicados em imagem ou vídeo.');
    if (['text', 'caption'].includes(clip.kind) && (!clip.text || !clip.text.content.trim() || !Number.isFinite(clip.text.fontSize)
      || clip.text.fontSize <= 0 || clip.text.fontSize > 1 || typeof clip.text.fontFamily !== 'string' || !clip.text.fontFamily.trim()
      || !studioColor(clip.text.color) || !studioColor(clip.text.backgroundColor) || !['left', 'center', 'right'].includes(clip.text.alignment))) push('Revise os textos e as legendas.');
    const text = clip.text;
    if (text && (text.decoration !== undefined && !textDecorations.includes(text.decoration)
      || text.visualEffect !== undefined && !textVisualEffects.includes(text.visualEffect)
      || text.animation !== undefined && !textAnimations.includes(text.animation)
      || text.secondaryColor !== undefined && !studioColor(text.secondaryColor)
      || text.gradientColors !== undefined && (!Array.isArray(text.gradientColors) || text.gradientColors.length !== 2 || !text.gradientColors.every(studioColor))
      || text.animationDurationTicks !== undefined && (!isTicks(text.animationDurationTicks) || text.animationDurationTicks <= 0))) push('Revise o estilo e a animação do texto.');
  }
  let streams = 0;
  for (const edge of edges.sort((a, b) => a.tick - b.tick || a.delta - b.delta)) { streams += edge.delta; if (streams > 2) push('A montagem pode usar até dois vídeos ao mesmo tempo.'); }
  const output = recipe.output;
  if (!output || !['standard', 'legacy-source'].includes(output.profile) || !Number.isFinite(output.width) || !Number.isFinite(output.height)
    || output.width <= 0 || output.height <= 0 || !Number.isSafeInteger(output.frameRateNumerator) || output.frameRateNumerator <= 0
    || !Number.isSafeInteger(output.frameRateDenominator) || output.frameRateDenominator <= 0) push('O perfil de exportação não é válido.');
  if (output?.profile === 'standard' && (!validStudioOutputDimensions(output, recipe.canvas.aspectRatio)
    || !studioOutputRates.some(rate => rate.numerator === output.frameRateNumerator && rate.denominator === output.frameRateDenominator)
    || output.colorSpace !== 'rec709' || output.selection !== undefined && !validStudioOutputSelection(output.selection))) push('Escolha uma saída válida até 4K, 60 FPS e SDR.');
  return issues;
}
export function validateStudioEditing(editing: StudioEditing, kind: StudioKind): string[] {
  const issues: string[] = [];
  if (editing.version !== 2 || editing.timebase !== STUDIO_TIMEBASE) issues.push('A edição precisa de recuperação.');
  if (editing.mainMuted !== undefined && typeof editing.mainMuted !== 'boolean'
    || editing.layers.some(layer => layer.hidden !== undefined && typeof layer.hidden !== 'boolean'
      || layer.muted !== undefined && typeof layer.muted !== 'boolean')) issues.push('Revise os controles das faixas.');
  const assetIds = editing.assets.map(asset => asset.id), clipIds = editing.main.map(clip => clip.id), layerIds = editing.layers.map(layer => layer.id);
  const allItemIds = [...clipIds, ...editing.layers.flatMap(layer => layer.items.map(item => item.id))];
  if (new Set(allItemIds).size !== allItemIds.length || allItemIds.some(id => !id)
    || new Set(assetIds).size !== assetIds.length || new Set(layerIds).size !== layerIds.length || layerIds.some(id => !id)) issues.push('A identificação da edição precisa de recuperação.');
  const assets = new Map(editing.assets.map(asset => [asset.id, asset]));
  for (const clip of editing.main) {
    const asset = assets.get(clip.assetId);
    if (!asset || !validStudioPlaybackRate(clip.playbackRate) || !isTicks(clip.sourceStartTicks) || !isTicks(clip.sourceEndTicks) || validStudioPlaybackRate(clip.playbackRate) && mainDuration(clip, asset) < STUDIO_TIMEBASE / 10
      || asset.kind === 'image' && (clip.sourceStartTicks !== 0 || clip.sourceEndTicks !== 0 || !isTicks(clip.durationTicks!))) issues.push('Revise os cortes dos takes.');
    // A track mute must not mask corrupt gain stored on an original clip.
    if (clip.gain !== undefined && (!Number.isFinite(clip.gain) || clip.gain < 0 || clip.gain > 4)) issues.push('Revise o enquadramento e o volume das camadas.');
    if ([clip.fadeInTicks, clip.fadeOutTicks].some(value => value !== undefined && !isTicks(value))
      || (clip.fadeInTicks ?? 0) + (clip.fadeOutTicks ?? 0) > (asset && validStudioPlaybackRate(clip.playbackRate) ? mainDuration(clip, asset) : 0)) issues.push('Revise os fades de áudio.');
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
    const sourceEnd = item.sourceEndTicks ?? (item.assetId && assets.get(item.assetId)?.kind !== 'image' ? sourceStart + Math.round(item.durationTicks * (validStudioPlaybackRate(item.playbackRate) ? item.playbackRate ?? 1 : 1)) : 0);
    originals.push({ ...baseRecipeClip(item.id, item.kind, item.atTicks, item.durationTicks), assetId: item.assetId,
      sourceStartTicks: sourceStart, sourceEndTicks: sourceEnd, rect: item.rect ?? { x: 0, y: 0, width: 1, height: 1 },
      rotationDegrees: item.rotationDegrees ?? 0, fit: item.fit ?? 'contain', opacity: item.opacity ?? 1, gain: item.gain ?? 1,
      fadeInTicks: item.fadeInTicks ?? 0, fadeOutTicks: item.fadeOutTicks ?? 0, effect: item.effect ?? 'natural', grade: item.grade, text: item.text,
      ...studioTreatmentProperties(item),
      ...studioClipProperties(item), animationOffsetTicks: item.animationOffsetTicks });
  }
  try {
    const recipe = compileStudioRecipe({ kind, takes: [], editing });
    issues.push(...validateStudioRecipe(recipe));
    const storedFeatures = studioRequiredFeatures({ clips: originals });
    const storedIssues = validateStudioRecipe({ ...recipe, version: storedFeatures.length ? 3 : 2,
      requiredFeatures: storedFeatures.length ? storedFeatures : undefined, assets: editing.assets, clips: originals });
    // Anchored elements use source times until compilation. Their actual decoder
    // overlap is checked above after resolving all links, not on raw offsets.
    issues.push(...storedIssues.filter(issue => issue !== 'A montagem pode usar até dois vídeos ao mesmo tempo.'));
  } catch { issues.push('Um original da montagem precisa de recuperação.'); }
  return [...new Set(issues)];
}
export function withStudioStandardOutput(editing: StudioEditing): StudioEditing {
  // Existing standard documents keep their explicit effective profile. Crossing
  // from source rendering to composition must never silently lower 4K/60.
  return editing.output.profile === 'standard' ? editing : withStudioOutputSelection(editing, { resolution: 'original', frameRate: 'original' });
}
const studioOutputRates = [
  { numerator: 24, denominator: 1 }, { numerator: 25, denominator: 1 }, { numerator: 30, denominator: 1 },
  { numerator: 50, denominator: 1 }, { numerator: 60, denominator: 1 },
  { numerator: 24000, denominator: 1001 }, { numerator: 30000, denominator: 1001 }, { numerator: 60000, denominator: 1001 },
] as const;
function validStudioOutputSelection(value: StudioOutputSelection) {
  return !!value && ['original', '720p', 'hd', '2k', '4k'].includes(value.resolution)
    && (value.frameRate === 'original' || [24, 30, 60].includes(value.frameRate));
}
function validStudioOutputDimensions(output: StudioOutputProfile, aspect: StudioEditing['canvas']['aspectRatio']) {
  const { width, height } = output;
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 64 && value % 2 === 0)
    || Math.max(width, height) > 3840 || Math.min(width, height) > 2160 || width * height > 3840 * 2160) return false;
  return aspect === 'square' ? width === height : aspect === 'portrait' ? Math.abs(height - width * 16 / 9) <= 2 : Math.abs(width - height * 16 / 9) <= 2;
}
function studioRate(rate: number) {
  const fraction = studioOutputRates.find(value => value.denominator === 1001 && Math.abs(rate - value.numerator / value.denominator) < 0.02);
  if (fraction) return fraction;
  const integer = studioOutputRates.find(value => value.denominator === 1 && Math.abs(rate - value.numerator) < 0.005);
  return integer ?? (rate > 30 ? studioOutputRates[4] : studioOutputRates[2]);
}
function resolveStudioOutput(editing: StudioEditing, activeAssets: readonly StudioAsset[]): StudioOutputProfile {
  const stored = editing.output;
  if (stored.profile !== 'standard' || !stored.selection) return { ...stored };
  if (!validStudioOutputSelection(stored.selection)) throw new Error('A escolha de resolução ou FPS precisa de recuperação.');
  const { resolution, frameRate } = stored.selection;
  const visual = activeAssets.filter(asset => asset.kind !== 'audio');
  const edges = visual.filter(asset => asset.width && asset.height).map(asset => editing.canvas.aspectRatio === 'portrait'
    ? Math.max(asset.width!, asset.height! * 9 / 16) : editing.canvas.aspectRatio === 'square'
      ? Math.max(asset.width!, asset.height!) : Math.max(asset.height!, asset.width! * 9 / 16)).filter(value => Number.isFinite(value) && value > 0);
  const shortEdge = resolution === 'original' ? Math.max(64, Math.min(2160, Math.ceil((edges.length ? Math.max(...edges) : 1080) / 2) * 2))
    : resolution === '4k' ? 2160 : resolution === '2k' ? 1440 : resolution === '720p' ? 720 : 1080;
  const longEdge = Math.min(3840, Math.round(shortEdge * 16 / 9 / 2) * 2);
  const portrait = editing.canvas.aspectRatio === 'portrait', square = editing.canvas.aspectRatio === 'square';
  const sources = activeAssets.filter(asset => asset.kind === 'video').map(asset => asset.frameRate ?? 0).filter(value => Number.isFinite(value) && value > 0);
  const rate = studioRate(frameRate === 'original' ? Math.min(60, sources.length ? Math.max(...sources) : 30) : frameRate);
  return { profile: 'standard', width: portrait || square ? shortEdge : longEdge, height: portrait ? longEdge : shortEdge,
    frameRateNumerator: rate.numerator, frameRateDenominator: rate.denominator, colorSpace: 'rec709', selection: { ...stored.selection } };
}
export function withStudioOutputSelection(editing: StudioEditing, selection: StudioOutputSelection): StudioEditing {
  if (!validStudioOutputSelection(selection)) throw new Error('Escolha uma resolução e um FPS válidos.');
  const next: StudioEditing = { ...editing, output: { ...editing.output, profile: 'standard', colorSpace: 'rec709', selection: { ...selection } } };
  return { ...next, output: studioEffectiveOutput(next) };
}
export function studioEffectiveOutput(editing: StudioEditing): StudioOutputProfile {
  return compileStudioRecipe({ kind: 'aula', takes: [], editing }).output;
}
export function studioSourceSummary(editing: StudioEditing) {
  const assets = compileStudioRecipe({ kind: 'aula', takes: [], editing }).assets;
  const visual = assets.filter(asset => asset.kind !== 'audio'), video = assets.filter(asset => asset.kind === 'video');
  const largest = visual.filter(asset => asset.width && asset.height).sort((a, b) => b.width! * b.height! - a.width! * a.height!)[0];
  return { width: largest?.width ?? 0, height: largest?.height ?? 0,
    frameRates: [...new Set(video.map(asset => asset.frameRate).filter((value): value is number => !!value && Number.isFinite(value)))].sort((a, b) => a - b),
    unknownDimensions: visual.some(asset => !asset.width || !asset.height), unknownFrameRates: video.some(asset => !asset.frameRate) };
}
export function studioOutputLabel(editing: StudioEditing): string {
  if (editing.output.profile === 'legacy-source') return 'Original da captura';
  const output = studioEffectiveOutput(editing), fps = output.frameRateNumerator / output.frameRateDenominator;
  const short = Math.min(output.width, output.height);
  const label = short === 2160 ? '4K' : short === 1440 ? '2K' : short === 1080 ? 'HD' : `${short}p`;
  return `${label} · ${Number.isInteger(fps) ? fps : fps.toFixed(3).replace(/0+$/, '')} FPS · SDR`;
}
export function studioOutputSupported(output: StudioOutputProfile, capabilities: StudioOutputCapabilities): boolean {
  if (!capabilities?.available || output.profile !== 'standard' || output.colorSpace !== capabilities.colorSpace
    || ![output.width, output.height].every(value => Number.isSafeInteger(value) && value % 2 === 0 && value >= capabilities.minimumDimension)
    || Math.max(output.width, output.height) > capabilities.maximumDimension
    || Math.min(output.width, output.height) > capabilities.maximumShortDimension || output.width * output.height > capabilities.maximumPixels
    || !capabilities.frameRates.some(rate => rate.numerator === output.frameRateNumerator && rate.denominator === output.frameRateDenominator)) return false;
  return capabilities.arbitraryEvenDimensions || capabilities.resolutions.some(value =>
    output.width === value.width && output.height === value.height || output.width === value.height && output.height === value.width || output.width === output.height && output.width === Math.min(value.width, value.height));
}
export function studioOutputWarnings(editing: StudioEditing): StudioOutputWarning[] {
  const recipe = compileStudioRecipe({ kind: 'aula', takes: [], editing }), output = recipe.output;
  if (output.profile !== 'standard') return [];
  const warnings: StudioOutputWarning[] = [];
  const add = (code: StudioOutputWarning['code'], message: string, assetId: string) => {
    const found = warnings.find(value => value.code === code);
    if (found) found.assetIds.push(assetId); else warnings.push({ code, message, assetIds: [assetId] });
  };
  const fps = output.frameRateNumerator / output.frameRateDenominator;
  for (const asset of recipe.assets) {
    if (asset.kind === 'audio') continue;
    if (!asset.width || !asset.height || asset.kind === 'video' && !asset.frameRate) add('unknown-source', 'Parte dos metadados dos originais está indisponível. Confira a resolução e o FPS efetivos antes de exportar.', asset.id);
    if (asset.width && asset.height) {
      const scale = Math.min(output.width / asset.width, output.height / asset.height);
      if (scale > 1.01) add('upscale', 'Esta saída amplia originais menores; isso não cria novos detalhes na imagem.', asset.id);
      if (scale < 0.99) add('downscale', 'Esta saída reduz a resolução de parte dos originais para caber no canvas escolhido.', asset.id);
    }
    if (asset.kind === 'video' && asset.frameRate && Math.abs(asset.frameRate - fps) > 0.005) add('fps-conversion', 'Originais com FPS diferente serão convertidos para o FPS da saída; quadros podem ser repetidos ou descartados.', asset.id);
    if (asset.colorSpace && /2020|2100|hlg|pq|hdr/i.test(asset.colorSpace)) add('sdr-conversion', 'Originais HDR serão convertidos para SDR (Rec.709); cores e luminosidade podem mudar.', asset.id);
  }
  return warnings;
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
function setStudioLayerSwitch(editing: StudioEditing, id: string, key: 'hidden' | 'muted', enabled: boolean): StudioEditing {
  if (typeof enabled !== 'boolean') throw new Error('O controle da faixa precisa ser verdadeiro ou falso.');
  const layer = editing.layers.find(value => value.id === id);
  if (!layer) throw new Error('Esta faixa não está mais na montagem.');
  if ((layer[key] === true) === enabled) return editing;
  const next = { ...layer };
  if (enabled) next[key] = true;
  else delete next[key];
  return { ...editing, layers: editing.layers.map(value => value.id === id ? next : value) };
}
export function setStudioLayerHidden(editing: StudioEditing, layerId: string, hidden: boolean): StudioEditing {
  return setStudioLayerSwitch(editing, layerId, 'hidden', hidden);
}
export function setStudioLayerMuted(editing: StudioEditing, layerId: string, muted: boolean): StudioEditing {
  return setStudioLayerSwitch(editing, layerId, 'muted', muted);
}
export function setStudioMainMuted(editing: StudioEditing, muted: boolean): StudioEditing {
  if (typeof muted !== 'boolean') throw new Error('O controle da faixa precisa ser verdadeiro ou falso.');
  if ((editing.mainMuted === true) === muted) return editing;
  if (muted) return { ...editing, mainMuted: true };
  const { mainMuted: _mainMuted, ...next } = editing;
  return next;
}
/** Move one element to a final, one-based lane without moving grouped siblings. */
export function moveStudioLayerItemToLane(editing: StudioEditing, id: string, targetZIndex: number): StudioEditing {
  if (!Number.isSafeInteger(targetZIndex)) throw new Error('A posição da camada não é válida.');
  const sourceIndex = editing.layers.findIndex(layer => layer.items.some(item => item.id === id));
  if (sourceIndex < 0) throw new Error('Este elemento não está mais na montagem.');
  const source = editing.layers[sourceIndex];
  const target = Math.max(1, Math.min(editing.layers.length + (source.items.length > 1 ? 1 : 0), targetZIndex));
  if (target === sourceIndex + 1) return editing;
  const item = source.items.find(item => item.id === id)!;
  let moved: StudioLayer;
  let layers: StudioLayer[];
  if (source.items.length === 1) {
    moved = source;
    layers = editing.layers.filter((_, index) => index !== sourceIndex);
  } else {
    const baseId = `layer:item:${id}`;
    const existingIds = new Set(editing.layers.map(layer => layer.id));
    let layerId = baseId, suffix = 1;
    while (existingIds.has(layerId)) layerId = `${baseId}:${suffix++}`;
    moved = { ...source, id: layerId, items: [item] };
    layers = editing.layers.map((layer, index) => index === sourceIndex
      ? { ...layer, items: layer.items.filter(value => value.id !== id) } : layer);
  }
  layers.splice(target - 1, 0, moved);
  return { ...editing, layers };
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
function patchStudioVisualTreatment(editing: StudioEditing, id: string, key: 'enhancement' | 'portrait' | 'signature', value: StudioEnhancement | StudioPortrait | StudioSignature | null): StudioEditing {
  const main = editing.main.find(clip => clip.id === id), layer = editing.layers.flatMap(track => track.items).find(item => item.id === id);
  const target = main ?? layer;
  if (!target) throw new Error('Este clip não está mais na montagem.');
  if (value !== null) {
    const issues = key === 'enhancement' ? validateStudioEnhancement(value) : key === 'portrait' ? validateStudioPortrait(value) : validateStudioSignature(value);
    if (issues.length) throw new Error(issues[0]);
    const kind = layer?.kind ?? editing.assets.find(asset => asset.id === main?.assetId)?.kind;
    if (kind !== 'image' && kind !== 'video') throw new Error('A melhoria, o retoque e a assinatura cinematográfica só podem ser aplicados em imagem ou vídeo.');
  }
  const current = target[key];
  if (value === null ? current === undefined : current !== undefined
    && (key === 'enhancement' ? validateStudioEnhancement(current) : key === 'portrait' ? validateStudioPortrait(current) : validateStudioSignature(current)).length === 0
    && Object.entries(value).every(([field, item]) => (current as unknown as Record<string, unknown>)[field] === item)) return editing;
  if (main) {
    const updated = { ...main };
    if (value === null) delete updated[key]; else Object.assign(updated, { [key]: { ...value } });
    return validatedStudioEdit({ ...editing, main: editing.main.map(clip => clip.id === id ? updated : clip) });
  }
  const updated = { ...layer! };
  if (value === null) delete updated[key]; else Object.assign(updated, { [key]: { ...value } });
  return validatedStudioEdit({ ...editing, layers: editing.layers.map(track => ({ ...track, items: track.items.map(item => item.id === id ? updated : item) })) });
}
/** Complete, versioned values are applied atomically; null removes a reversible treatment. */
export function patchStudioClipEnhancement(editing: StudioEditing, id: string, value: StudioEnhancement | null): StudioEditing {
  return patchStudioVisualTreatment(editing, id, 'enhancement', value);
}
export function patchStudioClipPortrait(editing: StudioEditing, id: string, value: StudioPortrait | null): StudioEditing {
  return patchStudioVisualTreatment(editing, id, 'portrait', value);
}
export function patchStudioClipSignature(editing: StudioEditing, id: string, value: StudioSignature | null): StudioEditing {
  return patchStudioVisualTreatment(editing, id, 'signature', value);
}

export type StudioClipPropertiesPatch = Partial<Pick<StudioMainClip,
  'playbackRate' | 'flipHorizontal' | 'flipVertical' | 'opacity' | 'gain' | 'fadeInTicks' | 'fadeOutTicks' | 'motion' | 'fit' | 'rotationDegrees'>>;
function validatedStudioEdit(editing: StudioEditing) {
  const issues = validateStudioEditing(editing, 'aula');
  if (issues.length) throw new Error(issues[0]);
  return editing;
}
/** Source ranges stay immutable; speed changes the main ripple or one layer's extent. */
export function setStudioClipPlaybackRate(editing: StudioEditing, id: string, playbackRate: number): StudioEditing {
  studioPlaybackRate(playbackRate);
  const main = editing.main.find(clip => clip.id === id), item = editing.layers.flatMap(layer => layer.items).find(clip => clip.id === id);
  const target = main ?? item;
  if (!target) throw new Error('Este clip não está mais na montagem.');
  const asset = editing.assets.find(value => value.id === target.assetId);
  if (!asset || !['video', 'audio'].includes(asset.kind) || item && !['video', 'audio'].includes(item.kind)) throw new Error('A velocidade só pode ser alterada em vídeo ou áudio.');
  const previousRate = studioPlaybackRate(target.playbackRate);
  if (previousRate === playbackRate) return editing;
  const normalized = playbackRate === 1 ? undefined : playbackRate;
  if (main) {
    const duration = Math.round((main.sourceEndTicks - main.sourceStartTicks) / playbackRate);
    const updated = { ...main, playbackRate: normalized, fadeInTicks: Math.min(main.fadeInTicks ?? 0, duration),
      fadeOutTicks: Math.min(main.fadeOutTicks ?? 0, Math.max(0, duration - Math.min(main.fadeInTicks ?? 0, duration))) };
    if (updated.playbackRate === undefined) delete updated.playbackRate;
    // Turn older timeline-offset links into source anchors before changing the
    // host's rate. Existing source-anchored subtitles remain on the same frames.
    const layers = editing.layers.map(layer => ({ ...layer, items: layer.items.map(value => value.anchor?.clipId === id && value.anchor.sourceStartTicks === undefined
      ? { ...value, anchor: { clipId: id, sourceStartTicks: main.sourceStartTicks + Math.round((value.anchor.offsetTicks ?? 0) * previousRate),
        sourceEndTicks: main.sourceStartTicks + Math.round(((value.anchor.offsetTicks ?? 0) + value.durationTicks) * previousRate) } } : value) }));
    return validatedStudioEdit({ ...editing, main: editing.main.map(clip => clip.id === id ? updated : clip), layers });
  }
  const original = item!, sourceStartTicks = original.sourceStartTicks ?? 0;
  const sourceEndTicks = original.sourceEndTicks ?? sourceStartTicks + Math.round(original.durationTicks * previousRate);
  const durationTicks = Math.round((sourceEndTicks - sourceStartTicks) / playbackRate);
  let anchor = original.anchor;
  if (anchor?.sourceStartTicks !== undefined) {
    const host = editing.main.find(clip => clip.id === anchor!.clipId)!;
    anchor = { ...anchor, sourceEndTicks: anchor.sourceStartTicks + Math.round(durationTicks * studioPlaybackRate(host.playbackRate)) };
  }
  return validatedStudioEdit(patchStudioLayerItem(editing, id, { playbackRate: normalized, durationTicks, sourceStartTicks, sourceEndTicks, anchor,
    fadeInTicks: Math.min(original.fadeInTicks ?? 0, durationTicks),
    fadeOutTicks: Math.min(original.fadeOutTicks ?? 0, Math.max(0, durationTicks - Math.min(original.fadeInTicks ?? 0, durationTicks))) }));
}
/** One targeted patch; it cannot replace sources, other items or metadata. */
export function patchStudioClipProperties(editing: StudioEditing, id: string, patch: StudioClipPropertiesPatch): StudioEditing {
  const allowed = [...studioPropertyKeys, 'fit', 'rotationDegrees'];
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Esta propriedade não pode alterar o clip.');
  let next = patch.playbackRate !== undefined ? setStudioClipPlaybackRate(editing, id, patch.playbackRate) : editing;
  const { playbackRate: _rate, ...properties } = patch;
  const clip = next.main.find(value => value.id === id);
  if (clip) {
    const updated = { ...clip, ...properties };
    if (properties.motion !== undefined && properties.motion !== clip.motion) {
      updated.motionOffsetTicks = 0;
      updated.motionDurationTicks = mainDuration(clip, next.assets.find(asset => asset.id === clip.assetId));
    }
    next = { ...next, main: next.main.map(value => value.id === id ? updated : value) };
  } else {
    const item = next.layers.flatMap(layer => layer.items).find(value => value.id === id);
    if (!item) throw new Error('Este elemento não está mais na montagem.');
    next = patchStudioLayerItem(next, id, { ...properties, ...(properties.motion !== undefined && properties.motion !== item.motion
      ? { motionOffsetTicks: 0, motionDurationTicks: item.durationTicks } : {}) });
  }
  return JSON.stringify(next) === JSON.stringify(editing) ? editing : validatedStudioEdit(next);
}
/** Binary feature gate, separate from persisted/export profile selection. */
export function requiresStudioEditorTools(value: StudioEditing | StudioRenderRecipe): boolean {
  const clips = 'clips' in value ? value.clips : compileStudioRecipe({ kind: 'aula', takes: [], editing: value }).clips;
  const assets = new Map(value.assets.map(asset => [asset.id, asset]));
  return studioRequiredFeatures({ clips }).length > 0 || clips.some(clip => clip.kind === 'audio' && assets.get(clip.assetId!)?.kind === 'video' || (clip.playbackRate ?? 1) !== 1 || clip.flipHorizontal === true || clip.flipVertical === true
    || !!clip.motion && clip.motion !== 'none' || clip.zIndex === 0 && ((clip.fadeInTicks ?? 0) > 0 || (clip.fadeOutTicks ?? 0) > 0 || clip.opacity !== 1)
    || !!clip.text && (clip.text.decoration !== undefined && clip.text.decoration !== 'none'
      || clip.text.visualEffect !== undefined && clip.text.visualEffect !== 'none' || clip.text.animation !== undefined && clip.text.animation !== 'none'
      || clip.text.gradientColors !== undefined));
}

/** A pending destination is recovery data, never a command to reinterpret a layer as main media. */
export function validateStudioPendingTakes(pending: StudioProject['pendingTakes']): string[] {
  if (pending === undefined) return [];
  if (!Array.isArray(pending)) return ['O registro de arquivos pendentes precisa de recuperação.'];
  const ids = new Set<string>();
  for (const entry of pending) {
    if (!entry || !entry.id || ids.has(entry.id) || !entry.uri?.startsWith('file://') || typeof entry.name !== 'string') return ['O registro de arquivos pendentes precisa de recuperação.'];
    ids.add(entry.id);
    if (entry.grade !== undefined && validateStudioGrade(entry.grade).length) return ['O tratamento da captura pendente precisa de recuperação.'];
    if (entry.sourceKind !== undefined && !['standard', 'cinematic'].includes(entry.sourceKind)
      || entry.sourceStage !== undefined && !['standard', 'cinematicRaw', 'cinematicRendered'].includes(entry.sourceStage)
      || entry.frameRate !== undefined && (!Number.isFinite(entry.frameRate) || entry.frameRate < 0)
      || entry.colorSpace !== undefined && typeof entry.colorSpace !== 'string') return ['Os metadados da captura pendente precisam de recuperação.'];
    if (entry.layerId !== undefined && (typeof entry.layerId !== 'string' || !entry.layerId)) return ['O destino da camada pendente precisa de recuperação.'];
    if (entry.imageSize !== undefined && (entry.kind !== 'image' || !entry.imageSize
      || ![entry.imageSize.width, entry.imageSize.height].every(value => Number.isFinite(value) && value > 0))) return ['As dimensões da imagem pendente precisam de recuperação.'];
    if (entry.layerItem) {
      const item = entry.layerItem;
      if (entry.grade !== undefined || item.grade !== undefined && validateStudioGrade(item.grade).length
        || item.enhancement !== undefined && validateStudioEnhancement(item.enhancement).length
        || item.portrait !== undefined && validateStudioPortrait(item.portrait).length
        || item.signature !== undefined && validateStudioSignature(item.signature).length
        || (item.enhancement !== undefined || item.portrait !== undefined || item.signature !== undefined) && !['video', 'image'].includes(item.kind)
        || !item.id || !['video', 'image', 'audio'].includes(item.kind) || item.assetId !== entry.id
        || entry.kind !== undefined && entry.kind !== item.kind || !isTicks(item.atTicks) || !isTicks(item.durationTicks)
        || [item.sourceStartTicks, item.sourceEndTicks, item.fadeInTicks, item.fadeOutTicks, item.animationOffsetTicks, item.motionOffsetTicks].some(value => value !== undefined && !isTicks(value))
        || !validStudioPlaybackRate(item.playbackRate) || item.playbackRate !== undefined && !['video', 'audio'].includes(item.kind)
        || [item.flipHorizontal, item.flipVertical].some(value => value !== undefined && typeof value !== 'boolean')
        || item.motion !== undefined && !clipMotions.includes(item.motion)
        || item.motionDurationTicks !== undefined && (!isTicks(item.motionDurationTicks) || item.motionDurationTicks <= 0)
        || item.anchor && (!item.anchor.clipId || item.anchor.offsetTicks !== undefined && !isTicks(item.anchor.offsetTicks)
          || item.anchor.sourceStartTicks !== undefined && (!isTicks(item.anchor.sourceStartTicks) || !isTicks(item.anchor.sourceEndTicks!)))
        || [item.opacity, item.gain, item.rotationDegrees].some(value => value !== undefined && !Number.isFinite(value))
        || item.rect && (![item.rect.x, item.rect.y, item.rect.width, item.rect.height].every(Number.isFinite) || item.rect.width <= 0 || item.rect.height <= 0)) return ['O destino da camada pendente precisa de recuperação.'];
    }
  }
  return [];
}
