import type { StudioPreviewDiagnosticEvent } from './StudioCompositionPreview';
import type { StudioPlaybackState } from './StudioPreview';
import type { StudioProject, StudioRenderRecipe } from './model';

let latestRun: string | null = null;
let writeQueue = Promise.resolve();
export function mayRunStudioPreviewDiagnostic(development: boolean, owner: string | undefined,
  project: StudioProject | undefined, focused: boolean, foreground: boolean) {
  return development && !!owner && project?.ownerId === owner && !!project.takes.length && focused && foreground;
}
const cleanMessage = (value: string) => value.replace(/(?:https?|wss?|file):\/\/\S+|Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gi, '[dado privado omitido]').slice(0, 500);
/** Metadata only: no source URI, image, recipe JSON or credentials cross this boundary. */
export function studioPreviewDiagnosticEvent(event: StudioPreviewDiagnosticEvent) {
  if (event.type === 'gate') return { type: event.type, native: event.native, missingTools: event.missingTools, missingTreatments: event.missingTreatments };
  if (event.type === 'recipe') return { type: event.type, revision: cleanMessage(event.revision), commandSequence: event.token,
    recipeVersion: event.recipeVersion, durationSeconds: event.durationSeconds, assetCount: event.assetCount, clipCount: event.clipCount, width: event.width, height: event.height,
    frameRateNumerator: event.frameRateNumerator, frameRateDenominator: event.frameRateDenominator };
  if (event.type === 'error') return { type: event.type, revision: cleanMessage(event.revision), commandSequence: event.token,
    code: event.code ? cleanMessage(event.code) : undefined, message: cleanMessage(event.message) };
  return { type: event.type, revision: cleanMessage(event.revision), commandSequence: event.token,
    positionSeconds: event.positionSeconds, sourcePositionSeconds: event.sourcePositionSeconds, playing: event.playing,
    loading: event.loading, hasClip: !!event.clipId };
}
export function studioPreviewDiagnosticRecipe(recipe: StudioRenderRecipe) {
  const assets = new Map(recipe.assets.map(asset => [asset.id, asset]));
  const scalarRecord = (value?: object) => value ? Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    !/uri|url|token|owner|title|content|path|image|credential|secret/i.test(key)
    && (item === null || typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean'
      || typeof item === 'string' && !/(?:https?|wss?|file):\/\//i.test(item)))) : null;
  return { version: recipe.version, requiredFeatures: recipe.requiredFeatures || [], timebase: recipe.timebase,
    durationTicks: recipe.durationTicks, mediaType: recipe.mediaType, canvas: scalarRecord(recipe.canvas), output: scalarRecord(recipe.output),
    clips: recipe.clips.map(clip => ({ kind: clip.kind, sourceKind: clip.assetId ? assets.get(clip.assetId)?.sourceKind || null : null,
      sourceStage: clip.assetId ? assets.get(clip.assetId)?.sourceStage || null : null,
      startTicks: clip.startTicks, durationTicks: clip.durationTicks, sourceStartTicks: clip.sourceStartTicks, sourceEndTicks: clip.sourceEndTicks,
      zIndex: clip.zIndex, effect: clip.effect, grade: scalarRecord(clip.grade), enhancement: scalarRecord(clip.enhancement),
      portrait: scalarRecord(clip.portrait), signature: scalarRecord(clip.signature), rect: scalarRecord(clip.rect), rotationDegrees: clip.rotationDegrees,
      fit: clip.fit, opacity: clip.opacity, gain: clip.gain, playbackRate: clip.playbackRate ?? 1,
      sourceWidth: clip.assetId ? assets.get(clip.assetId)?.width || null : null,
      sourceHeight: clip.assetId ? assets.get(clip.assetId)?.height || null : null,
      sourceFrameRate: clip.assetId ? assets.get(clip.assetId)?.frameRate || null : null })) };
}
export function createStudioPreviewDiagnosticReport(options: {
  runId: string; metadata: Record<string, unknown>; write: (report: string) => Promise<void>;
}) {
  latestRun = options.runId;
  let report: Record<string, unknown> = { reportSchema: 'classfy-studio-preview-diagnostic', reportVersion: 1,
    runId: options.runId, ...options.metadata, events: [] as Record<string, unknown>[], lastStage: 'created',
    limits: ['Estados e erros vêm do player de produção. Este diagnóstico não confirma pixels nem grava um take.'] };
  return {
    event(stage: string, value: Record<string, unknown> = {}) {
      const entry = { at: new Date().toISOString(), stage, ...value };
      const events = (report.events as Record<string, unknown>[]).slice(-199);
      report = { ...report, events: [...events, entry], lastStage: stage, reportedAt: entry.at,
        ...(stage === 'native-diagnostics' ? { lastNativeDiagnostics: value } : {}),
        ...(stage === 'playback' ? { lastPlayback: value } : {}),
        ...(stage === 'native-error' || stage === 'timeout' ? { error: value.message } : {}) };
      const snapshot = JSON.stringify(report);
      writeQueue = writeQueue.catch(() => undefined).then(async () => {
        if (latestRun === options.runId) await options.write(snapshot);
      }).catch(() => undefined);
      return writeQueue;
    },
    snapshot: () => report,
    flush: () => writeQueue,
  };
}

/** Playback-only, bounded probe; no imports of camera, recording or project writes. */
export function createStudioPreviewPlaybackProbe(options: {
  automatic: boolean; current: () => boolean; play: () => void; pause: () => void;
  report: (stage: string, value?: Record<string, unknown>) => void;
}) {
  let stage: 'priming' | 'ready' | 'starting' | 'playing' | 'finished' | 'cancelled' | 'failed' = 'priming';
  let alive = true, timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  const current = () => alive && options.current();
  const deadline = (milliseconds: number, message: string) => {
    clear(); timer = setTimeout(() => {
      timer = null; if (!current()) return;
      stage = 'failed'; options.pause(); options.report('timeout', { message });
    }, milliseconds);
  };
  deadline(20_000, 'O player não confirmou preparação em 20 segundos. Nenhuma captura foi iniciada.');
  options.report('priming');
  return {
    playback(value: StudioPlaybackState) {
      if (!current()) return;
      if (stage === 'priming' && !value.loading && !value.playing && value.takeId) {
        clear(); stage = 'ready'; options.report('ready', { positionSeconds: value.position });
        if (options.automatic) {
          stage = 'starting'; options.report('play-requested'); options.play();
          deadline(8000, 'A reprodução solicitada não foi confirmada em 8 segundos.');
        }
      } else if (stage === 'starting' && value.playing) {
        clear(); stage = 'playing'; options.report('playing-confirmed', { positionSeconds: value.position });
        timer = setTimeout(() => {
          timer = null; if (!current()) return;
          stage = 'finished'; options.pause(); options.report('paused-after-one-second');
        }, 1000);
      }
    },
    nativeError() { if (!current()) return; clear(); stage = 'failed'; options.pause(); },
    dispose() { alive = false; clear(); stage = 'cancelled'; options.pause(); },
    stage: () => stage,
  };
}
